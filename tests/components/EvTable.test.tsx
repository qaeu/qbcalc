import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';

import EvTable from '#c/EvTable';
import { DEFAULT_RULE_SET } from '#utils/ev/rules';
import { computeAllEvTables } from '#utils/ev/tables';
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

/**
 * Dismisses the open drill-down dialog with its close button.
 *
 * Not with Escape, even though the dialog answers it: Escape is handled by a
 * dismissable-layer stack that is shared module state, and the hover cards
 * these tests leave open register layers on it too, so which layer a key press
 * reaches depends on what ran before.
 */
async function closeDialog(): Promise<void> {
	fireEvent.click(screen.getByRole('button', { name: 'Close' }));
	await waitFor(() => {
		expect(screen.queryByRole('dialog')).toBeNull();
	});
}

describe('EvTable', () => {
	it('renders hard totals, soft totals, and splits grids for the given result', () => {
		render(() => (
			<EvTable
				result={() => SAMPLE_RESULT}
				isComputing={() => false}
				error={() => null}
				count={() => 1}
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

	it('reports insurance EV in the ace column popovers, and nowhere else', async () => {
		render(() => (
			<EvTable
				result={() => SAMPLE_RESULT}
				isComputing={() => false}
				error={() => null}
				count={() => 1}
			/>
		));

		const hardRow = within(screen.getAllByRole('table')[0]).getAllByRole('row')[1];
		const cells = hardRow.querySelectorAll('td');
		// The upcard columns run 2..T, A, so the ace is the last of the ten.
		const aceCell = cells[cells.length - 1];
		const twoCell = cells[0];

		fireEvent.pointerEnter(aceCell);
		const acePopover = popoverFor(aceCell);
		await waitFor(() => {
			expect(acePopover.hidden).toBe(false);
		});

		// A fresh six-deck shoe is a bit under a third tens, so the bet loses.
		expect(SAMPLE_RESULT.insurance.countEvPercent).toBeLessThan(0);
		expect(acePopover.textContent).toMatch(/Insurance EV-\d+\.\d+%/);

		expect(popoverFor(twoCell).textContent).not.toMatch(/Insurance/);
	});

	it('leaves insurance out of the popovers when the table does not offer it', async () => {
		const noInsurance: EvWorkerResult = {
			...SAMPLE_RESULT,
			insurance: { ...SAMPLE_RESULT.insurance, offered: false },
		};

		render(() => (
			<EvTable
				result={() => noInsurance}
				isComputing={() => false}
				error={() => null}
				count={() => 1}
			/>
		));

		const hardRow = within(screen.getAllByRole('table')[0]).getAllByRole('row')[1];
		const cells = hardRow.querySelectorAll('td');
		const aceCell = cells[cells.length - 1];

		fireEvent.pointerEnter(aceCell);
		const acePopover = popoverFor(aceCell);
		await waitFor(() => {
			expect(acePopover.hidden).toBe(false);
		});

		expect(acePopover.textContent).not.toMatch(/Insurance/);
	});

	it('shows an error instead of a table when given an error', () => {
		render(() => (
			<EvTable
				result={() => null}
				isComputing={() => false}
				error={() => 'Count too extreme for this shoe'}
				count={() => 0}
			/>
		));

		expect(screen.getByText(/too extreme/i)).toBeDefined();
		expect(screen.queryAllByRole('table')).toHaveLength(0);
	});

	it('shows a loading placeholder in cells while computing', () => {
		render(() => (
			<EvTable
				result={() => null}
				isComputing={() => true}
				error={() => null}
				count={() => 0}
			/>
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
			<EvTable
				result={result}
				isComputing={isComputing}
				error={() => null}
				count={() => 1}
			/>
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
				count={() => 15}
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
				count={() => 1}
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
		expect(popover.textContent).toMatch(/\+1Δ/);
		expect(popover.textContent).not.toMatch(/Optimal play:/);
		expect(popover.textContent).toMatch(/Hit bust%\d+\.\d%/);
		expect(popover.textContent).toMatch(/Dealer bust%\d+\.\d%/);
	});

	it('hides the delta stat line when the count is zero', async () => {
		render(() => (
			<EvTable
				result={() => SAMPLE_RESULT}
				isComputing={() => false}
				error={() => null}
				count={() => 0}
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

		expect(popover.textContent).toMatch(/EV/);
		expect(popover.textContent).not.toMatch(/Δ/);
	});

	it('opens a drill-down dialog pricing every action when a cell is clicked', async () => {
		render(() => (
			<EvTable
				result={() => SAMPLE_RESULT}
				isComputing={() => false}
				error={() => null}
				count={() => 1}
			/>
		));

		const tables = screen.getAllByRole('table');
		// Hard 8 against a dealer 2 -- the first data cell of the first grid.
		const cell = within(tables[0]).getAllByRole('row')[1].querySelectorAll('td')[0];

		expect(screen.queryByRole('dialog')).toBeNull();

		fireEvent.click(cell);

		const dialog = await screen.findByRole('dialog');
		expect(within(dialog).getByText('Hard 8 vs 2')).toBeDefined();

		// One row per action the table offers this hand (stand, double, hit),
		// plus the header row.
		const actionRows = within(dialog).getAllByRole('row');
		expect(actionRows).toHaveLength(4);
		expect(within(dialog).getByRole('rowheader', { name: 'Stand' })).toBeDefined();
		expect(within(dialog).getByRole('rowheader', { name: 'Double' })).toBeDefined();
		expect(within(dialog).getByRole('rowheader', { name: 'Hit' })).toBeDefined();

		// Ranked best first, and the top row is the play the grid recommends.
		const row = SAMPLE_RESULT.hard.rows.find((r) => r.total === 8 && r.upcard === '2')!;
		const [, best] = within(dialog).getAllByRole('row');
		expect(within(best).getByRole('rowheader').textContent).toBe(
			{ H: 'Hit', S: 'Stand', D: 'Double', P: 'Split', R: 'Surrender' }[row.optimalAction]
		);
		expect(best.classList.contains('is-optimal')).toBe(true);

		// Rank and deviation indicator first, then EV, then win/push/lose, all as
		// percentages.
		const cells = [...within(best).getAllByRole('cell')].map((td) => td.textContent);
		expect(cells).toHaveLength(6);
		const [rank, , ...figures] = cells;
		expect(rank).toBe('1');
		for (const figure of figures) expect(figure).toMatch(/^[+-]?\d+\.\d+%$/);

		await closeDialog();
	});

	// The pointer sits over the backdrop while the dialog is up, so nothing tells
	// the hover card to close on its own, and closing the dialog hands focus back
	// to the cell -- which the card would otherwise take as a cue to reopen over
	// a cell the pointer left long ago.
	it('drops the hover card when a cell opens its dialog, and leaves it down after', async () => {
		render(() => (
			<EvTable
				result={() => SAMPLE_RESULT}
				isComputing={() => false}
				error={() => null}
				count={() => 1}
			/>
		));

		const tables = screen.getAllByRole('table');
		const cell = within(tables[0]).getAllByRole('row')[1].querySelectorAll('td')[0];

		fireEvent.pointerEnter(cell);
		const popover = popoverFor(cell);
		await waitFor(() => {
			expect(popover.hidden).toBe(false);
		});

		fireEvent.click(cell);
		await screen.findByRole('dialog');
		await waitFor(() => {
			expect(popover.hidden).toBe(true);
		});

		await closeDialog();
		expect(popover.hidden).toBe(true);

		// Until the pointer arrives on the cell again, which is a fresh hover.
		fireEvent.pointerOver(cell);
		fireEvent.pointerEnter(cell);
		await waitFor(() => {
			expect(popover.hidden).toBe(false);
		});
	});

	it('closes the drill-down dialog from its close button', async () => {
		render(() => (
			<EvTable
				result={() => SAMPLE_RESULT}
				isComputing={() => false}
				error={() => null}
				count={() => 1}
			/>
		));

		const tables = screen.getAllByRole('table');
		const cell = within(tables[0]).getAllByRole('row')[1].querySelectorAll('td')[0];

		fireEvent.click(cell);
		await screen.findByRole('dialog');

		await closeDialog();
	});

	it('adds a split row and its per-hand caveat for a pairs cell', async () => {
		render(() => (
			<EvTable
				result={() => SAMPLE_RESULT}
				isComputing={() => false}
				error={() => null}
				count={() => 1}
			/>
		));

		// 8,8 against a dealer 2: the seventh pair row of the splits grid.
		const pairsGrid = screen.getAllByRole('table')[2];
		const cell = within(pairsGrid).getAllByRole('row')[7].querySelectorAll('td')[0];

		fireEvent.click(cell);

		const dialog = await screen.findByRole('dialog');
		expect(within(dialog).getByText('8,8 vs 2')).toBeDefined();
		expect(within(dialog).getByRole('rowheader', { name: 'Split' })).toBeDefined();
		expect(dialog.textContent).toMatch(/EV covers both hands/);

		await closeDialog();
	});

	it('keeps the popover open when the pointer moves onto it, and hides it once the pointer leaves both', async () => {
		render(() => (
			<EvTable
				result={() => SAMPLE_RESULT}
				isComputing={() => false}
				error={() => null}
				count={() => 1}
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
