import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';

import EvTable from '#c/EvTable';
import { DEFAULT_RULE_SET, computeAllEvTables } from '#utils/blackjackEv';
import type { EvWorkerResult } from '#utils/evWorkerProtocol';

// Real (not mocked) exact-enumeration result, computed once and reused as a
// fixture -- deterministic, and keeps these tests independent of the worker.
const SAMPLE_RESULT: EvWorkerResult = computeAllEvTables(DEFAULT_RULE_SET, 1);

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
