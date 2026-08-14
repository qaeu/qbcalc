import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';

import EvTable from '#c/EvTable';
import { DEFAULT_RULE_SET, computeAllEvTables } from '#utils/blackjackEv';
import type { EvWorkerResult } from '#utils/evWorkerProtocol';

// Real (not mocked) exact-enumeration result, computed once and reused as a
// fixture -- deterministic, and keeps these tests independent of the worker.
const SAMPLE_RESULT: EvWorkerResult = computeAllEvTables(DEFAULT_RULE_SET, 1);

// A count high enough to move some hard totals off basic strategy, which is
// what the deviation ring marks. At +1 the hard grid has a single deviation;
// this one has several, in more than one direction.
const DEVIATION_RESULT: EvWorkerResult = computeAllEvTables(DEFAULT_RULE_SET, 15);

// The HoverCard content isn't unmounted while closed (it's hidden via the
// `hidden` attribute instead), so look it up by the id HoverCard pairs with
// the trigger rather than trusting DOM order across the whole 10x10 grid.
function popoverFor(trigger: Element): HTMLElement {
	const contentId = trigger.id.replace(/:trigger$/, ':content');
	const content = document.getElementById(contentId);
	if (!content) throw new Error(`No popover content found for trigger #${trigger.id}`);
	return content;
}

describe('EvTable', () => {
	it('renders hard totals, soft totals, and splits grids for the given result', () => {
		render(() => (
			<EvTable
				result={() => SAMPLE_RESULT}
				isComputing={() => false}
				error={() => null}
			/>
		));

		expect(screen.getByText('Hard totals')).toBeDefined();
		expect(screen.getByText('Soft totals')).toBeDefined();
		expect(screen.getByText('Pairs')).toBeDefined();

		const tables = screen.getAllByRole('table');
		expect(tables).toHaveLength(3);
		// 10 hard totals (8-17) as rows, plus 10 dealer upcards as columns.
		expect(within(tables[0]).getAllByRole('row')).toHaveLength(11);
		// 8 soft totals (A,2-A,9) as rows.
		expect(within(tables[1]).getAllByRole('row')).toHaveLength(9);
		// 10 splittable pairs (2,2-A,A) as rows.
		expect(within(tables[2]).getAllByRole('row')).toHaveLength(11);
	});

	it('shows an error instead of a table when given an error', () => {
		render(() => (
			<EvTable
				result={() => null}
				isComputing={() => false}
				error={() => 'Count too extreme for this shoe'}
			/>
		));

		expect(screen.getByText(/too extreme/i)).toBeDefined();
		expect(screen.queryAllByRole('table')).toHaveLength(0);
	});

	it('shows a loading placeholder in cells while computing', () => {
		render(() => (
			<EvTable result={() => null} isComputing={() => true} error={() => null} />
		));

		const tables = screen.getAllByRole('table');
		const firstDataCell = within(tables[0])
			.getAllByRole('row')[1]
			.querySelectorAll('td')[0];

		expect(firstDataCell.classList.contains('is-loading')).toBe(true);
	});

	// The background-colour transition between one calculation and the next only
	// runs if the cell is the same element throughout: a `<td>` swapped out for a
	// separate skeleton cell would mount at its final colour with nothing to
	// animate from.
	it('reuses the same cell element across the loading state', async () => {
		const [isComputing, setIsComputing] = createSignal(false);
		const [result, setResult] = createSignal<EvWorkerResult | null>(SAMPLE_RESULT);

		render(() => (
			<EvTable result={result} isComputing={isComputing} error={() => null} />
		));

		const firstDataCell = () =>
			within(screen.getAllByRole('table')[0])
				.getAllByRole('row')[1]
				.querySelectorAll('td')[0];

		const before = firstDataCell();
		expect(before.textContent).toMatch(/^[HSD]$/);

		setIsComputing(true);
		setResult(null);
		await waitFor(() => {
			expect(firstDataCell().classList.contains('is-loading')).toBe(true);
		});
		expect(firstDataCell()).toBe(before);

		setResult(SAMPLE_RESULT);
		setIsComputing(false);
		await waitFor(() => {
			expect(firstDataCell().classList.contains('is-loading')).toBe(false);
		});
		expect(firstDataCell()).toBe(before);
		expect(before.textContent).toMatch(/^[HSD]$/);
	});

	it('rings only the cells whose action the count has moved, in the baseline action colour', () => {
		render(() => (
			<EvTable
				result={() => DEVIATION_RESULT}
				isComputing={() => false}
				error={() => null}
			/>
		));

		const baseActionClass: Record<string, string> = {
			H: 'was-hit',
			S: 'was-stand',
			D: 'was-double',
			P: 'was-split',
			R: 'was-surrender',
		};

		const rows = within(screen.getAllByRole('table')[0]).getAllByRole('row').slice(1);
		const upcards = DEVIATION_RESULT.hard.upcards;
		let deviations = 0;

		DEVIATION_RESULT.hard.totals.forEach((total, rowIndex) => {
			const cells = rows[rowIndex].querySelectorAll('td');
			upcards.forEach((upcard, colIndex) => {
				const row = DEVIATION_RESULT.hard.rows.find(
					(candidate) => candidate.total === total && candidate.upcard === upcard
				)!;
				const classes = [...cells[colIndex].classList].filter((name) =>
					name.startsWith('was-')
				);
				if (row.baseAction === row.optimalAction) {
					expect(classes).toEqual([]);
				} else {
					expect(classes).toEqual([baseActionClass[row.baseAction]]);
					deviations += 1;
				}
			});
		});

		expect(deviations).toBeGreaterThan(0);
	});

	it('shows the optimal play as a single letter, and EV, delta, and bust odds when hovered', async () => {
		render(() => (
			<EvTable
				result={() => SAMPLE_RESULT}
				isComputing={() => false}
				error={() => null}
			/>
		));

		const tables = screen.getAllByRole('table');
		const firstDataCell = () =>
			within(tables[0]).getAllByRole('row')[1].querySelectorAll('td')[0];

		expect(firstDataCell().textContent).toMatch(/^[HSD]$/);

		fireEvent.pointerEnter(firstDataCell());

		const popover = popoverFor(firstDataCell());
		await waitFor(() => {
			expect(popover.hidden).toBe(false);
		});

		expect(popover.textContent).toMatch(/EV/);
		expect(popover.textContent).toMatch(/Δ/);
		expect(popover.textContent).not.toMatch(/Optimal play:/);
		expect(popover.textContent).toMatch(/Hit bust%\d+\.\d%/);
		expect(popover.textContent).toMatch(/Dealer bust%\d+\.\d%/);
	});

	it('keeps the popover open when the pointer moves onto it, and hides it once the pointer leaves both', async () => {
		render(() => (
			<EvTable
				result={() => SAMPLE_RESULT}
				isComputing={() => false}
				error={() => null}
			/>
		));

		const tables = screen.getAllByRole('table');
		const firstDataCell = () =>
			within(tables[0]).getAllByRole('row')[1].querySelectorAll('td')[0];

		fireEvent.pointerEnter(firstDataCell());

		const popover = popoverFor(firstDataCell());
		await waitFor(() => {
			expect(popover.hidden).toBe(false);
		});

		fireEvent.pointerLeave(firstDataCell());
		fireEvent.pointerEnter(popover);

		expect(popover.hidden).toBe(false);

		fireEvent.pointerLeave(popover);

		await waitFor(() => {
			expect(popover.hidden).toBe(true);
		});
	});
});
