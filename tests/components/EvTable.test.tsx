import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';

import type { CountEvProfile } from '#c/CountEvGraph';
import EvTable from '#c/EvTable';
import { analyzeBankroll, hiLoCountScale, type BankrollAnalysis } from '#utils/bankroll';
import { simulateRoundFrequency } from '#utils/countRounds';
import { baseComposition, DEFAULT_PARAMS } from '#utils/ev/composition';
import { DEFAULT_RULE_SET } from '#utils/ev/rules';
import { DEFAULT_BANKROLL_CONFIG } from '#utils/storage';
import { computeAllEvTables } from '#utils/ev/tables';
import { formatEvPercent } from '#utils/format';
import type { EvWorkerResult } from '#utils/evWorkerProtocol';

// Real (not mocked) exact-enumeration result, computed once and reused as a
// fixture -- deterministic, and keeps these tests independent of the worker.
// The edge curve only feeds the bankroll figures, which these tests pass in
// directly, so fixed stand-ins keep the fixtures a complete `EvWorkerResult`.
const EDGE_SLOPE = 0.7;
const EDGE_CURVATURE = 0.005;

const SAMPLE_RESULT: EvWorkerResult = {
	...computeAllEvTables(DEFAULT_RULE_SET, 1),
	edgeSlopePointsPerTrueCount: EDGE_SLOPE,
	edgeCurvaturePointsPerTrueCountSquared: EDGE_CURVATURE,
};

// A count high enough to move some hard totals off basic strategy, which is
// what the deviation ring marks. At +1 the hard grid has a single deviation;
// this one has several, in more than one direction.
const DEVIATION_RESULT: EvWorkerResult = {
	...computeAllEvTables(DEFAULT_RULE_SET, 2.5),
	edgeSlopePointsPerTrueCount: EDGE_SLOPE,
	edgeCurvaturePointsPerTrueCountSquared: EDGE_CURVATURE,
};

// A real analysis of the default spread against the same rules, so the summary
// cards are exercised with figures that actually agree with each other.
const SAMPLE_BANKROLL: BankrollAnalysis = analyzeBankroll(
	DEFAULT_RULE_SET,
	DEFAULT_PARAMS.tags,
	{
		...DEFAULT_BANKROLL_CONFIG,
		baseEvPercent: SAMPLE_RESULT.average.baseEvPercent,
		edgeSlopePointsPerTrueCount: EDGE_SLOPE,
		edgeCurvaturePointsPerTrueCountSquared: EDGE_CURVATURE,
		variancePerRound: SAMPLE_RESULT.average.variancePerRound,
	}
);

// What the weighted-EV graph draws, on the same rules and the same edge curve
// as the summary cards above it.
const SAMPLE_COUNT_EV: CountEvProfile = {
	rounds: simulateRoundFrequency(DEFAULT_RULE_SET, DEFAULT_PARAMS.tags),
	edge: {
		baseEvPercent: SAMPLE_RESULT.average.baseEvPercent,
		edgeSlopePointsPerTrueCount: EDGE_SLOPE,
		edgeCurvaturePointsPerTrueCountSquared: EDGE_CURVATURE,
	},
	ramp: DEFAULT_BANKROLL_CONFIG.ramp,
	countScale: hiLoCountScale(baseComposition(DEFAULT_RULE_SET), DEFAULT_PARAMS.tags),
	decks: DEFAULT_RULE_SET.decks,
	penetrationPercent: DEFAULT_RULE_SET.penetrationPercent,
	systemLabel: 'Ace-Five',
};

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
	// The cell display mode is persisted, so one test's cycling would otherwise
	// be the next test's starting mode.
	beforeEach(() => {
		localStorage.clear();
	});

	it('renders hard totals, soft totals, and splits grids for the given result', () => {
		render(() => (
			<EvTable
				result={() => SAMPLE_RESULT}
				isComputing={() => false}
				isSummaryComputing={() => false}
				error={() => null}
				bankroll={() => undefined}
				countEv={() => SAMPLE_COUNT_EV}
				trueCount={() => 1}
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

	it('heads the grids with the shoe-wide edge, and names the true count', () => {
		render(() => (
			<EvTable
				result={() => SAMPLE_RESULT}
				isComputing={() => false}
				isSummaryComputing={() => false}
				error={() => null}
				bankroll={() => SAMPLE_BANKROLL}
				countEv={() => SAMPLE_COUNT_EV}
				trueCount={() => 1}
			/>
		));

		const cards = document.querySelectorAll('.ev-summary__card');
		expect(cards).toHaveLength(5);

		// The edge over the whole shoe under the bet spread, not the EV at the
		// count on screen -- the cells already answer that question.
		expect(cards[0].textContent).toContain('Player Edge');
		expect(cards[0].querySelector('.ev-summary__value')?.textContent).toBe(
			`${formatEvPercent(SAMPLE_BANKROLL.edgePercent)}%`
		);
		expect(cards[0].textContent).not.toContain(
			formatEvPercent(SAMPLE_RESULT.average.countEvPercent)
		);

		// The count has no field in the sidebar any more, so the line above the
		// grids is where it is read off.
		expect(document.querySelector('.ev-table__mode')?.textContent).toContain(
			'True count +1'
		);
	});

	it('leaves the edge card empty until there is a bankroll analysis', () => {
		render(() => (
			<EvTable
				result={() => SAMPLE_RESULT}
				isComputing={() => false}
				isSummaryComputing={() => false}
				error={() => null}
				bankroll={() => undefined}
				countEv={() => SAMPLE_COUNT_EV}
				trueCount={() => 1}
			/>
		));

		// Every card is derived from the bankroll analysis, so without one there
		// is nothing to show anywhere along the row.
		const cards = document.querySelectorAll('.ev-summary__card');
		expect(cards[0].textContent).toContain('Player Edge');
		for (const card of cards) expect(card.querySelector('.ev-summary__value')).toBeNull();
	});

	it('shows a skeleton in place of the average while the summary is computing', () => {
		render(() => (
			<EvTable
				result={() => SAMPLE_RESULT}
				isComputing={() => true}
				isSummaryComputing={() => true}
				error={() => null}
				bankroll={() => undefined}
				countEv={() => SAMPLE_COUNT_EV}
				trueCount={() => 1}
			/>
		));

		// The previous result is still in hand, so the figure has to be withheld
		// deliberately rather than merely being absent.
		expect(document.querySelectorAll('.ev-summary__skeleton')).toHaveLength(5);
		expect(document.querySelectorAll('.ev-summary__value')).toHaveLength(0);
	});

	// A recalculation at a new true count redraws the grids but says nothing
	// new about the shoe as a whole, so the cards keep their figures rather than
	// blinking to skeletons on every press of an arrow key.
	it('keeps the summary figures while only the grids are computing', () => {
		render(() => (
			<EvTable
				result={() => SAMPLE_RESULT}
				isComputing={() => true}
				isSummaryComputing={() => false}
				error={() => null}
				bankroll={() => SAMPLE_BANKROLL}
				countEv={() => SAMPLE_COUNT_EV}
				trueCount={() => 1}
			/>
		));

		expect(document.querySelectorAll('.ev-summary__skeleton')).toHaveLength(0);
		expect(document.querySelectorAll('.ev-summary__value')).toHaveLength(5);
	});

	it('reports insurance EV in the ace column popovers, and nowhere else', async () => {
		render(() => (
			<EvTable
				result={() => SAMPLE_RESULT}
				isComputing={() => false}
				isSummaryComputing={() => false}
				error={() => null}
				bankroll={() => undefined}
				countEv={() => SAMPLE_COUNT_EV}
				trueCount={() => 1}
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
				isSummaryComputing={() => false}
				error={() => null}
				bankroll={() => undefined}
				countEv={() => SAMPLE_COUNT_EV}
				trueCount={() => 1}
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
				isSummaryComputing={() => false}
				error={() => 'Count too extreme for this shoe'}
				trueCount={() => 0}
				bankroll={() => undefined}
				countEv={() => SAMPLE_COUNT_EV}
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
				isSummaryComputing={() => true}
				error={() => null}
				bankroll={() => undefined}
				countEv={() => SAMPLE_COUNT_EV}
				trueCount={() => 0}
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
				isSummaryComputing={isComputing}
				error={() => null}
				bankroll={() => undefined}
				countEv={() => SAMPLE_COUNT_EV}
				trueCount={() => 1}
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
				isSummaryComputing={() => false}
				error={() => null}
				bankroll={() => undefined}
				countEv={() => SAMPLE_COUNT_EV}
				trueCount={() => 2.5}
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
				isSummaryComputing={() => false}
				error={() => null}
				bankroll={() => undefined}
				countEv={() => SAMPLE_COUNT_EV}
				trueCount={() => 1}
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
		// Two decimals: the rarest cells run to hundredths of a percent.
		expect(popover.textContent).toMatch(/Occurrence\d+\.\d\d%/);
	});

	it('hides the delta stat line when the count is zero', async () => {
		render(() => (
			<EvTable
				result={() => SAMPLE_RESULT}
				isComputing={() => false}
				isSummaryComputing={() => false}
				error={() => null}
				bankroll={() => undefined}
				countEv={() => SAMPLE_COUNT_EV}
				trueCount={() => 0}
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
				isSummaryComputing={() => false}
				error={() => null}
				bankroll={() => undefined}
				countEv={() => SAMPLE_COUNT_EV}
				trueCount={() => 1}
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
				isSummaryComputing={() => false}
				error={() => null}
				bankroll={() => undefined}
				countEv={() => SAMPLE_COUNT_EV}
				trueCount={() => 1}
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
				isSummaryComputing={() => false}
				error={() => null}
				bankroll={() => undefined}
				countEv={() => SAMPLE_COUNT_EV}
				trueCount={() => 1}
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
				isSummaryComputing={() => false}
				error={() => null}
				bankroll={() => undefined}
				countEv={() => SAMPLE_COUNT_EV}
				trueCount={() => 1}
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

	describe('cell display mode', () => {
		function renderTable() {
			render(() => (
				<EvTable
					result={() => DEVIATION_RESULT}
					isComputing={() => false}
					isSummaryComputing={() => false}
					error={() => null}
					bankroll={() => undefined}
					countEv={() => SAMPLE_COUNT_EV}
					trueCount={() => 2.5}
				/>
			));

			return () =>
				within(screen.getAllByRole('table')[0])
					.getAllByRole('row')[1]
					.querySelectorAll('td')[0];
		}

		const cycle = () => fireEvent.keyDown(document.body, { key: ' ' });

		it('cycles the cells through action, EV and occurrence on space', () => {
			const firstDataCell = renderTable();
			const mode = () => document.querySelector('.ev-table__mode-name')?.textContent;

			expect(firstDataCell().textContent).toMatch(/^[HSDPR]$/);
			expect(mode()).toBe('Optimal action');

			cycle();
			// Signed, to one decimal -- three would not fit the cell.
			expect(firstDataCell().textContent).toMatch(/^[+-]\d+\.\d$/);
			expect(mode()).toBe('EV %');

			cycle();
			expect(firstDataCell().textContent).toMatch(/^\d+\.\d\d$/);
			expect(mode()).toBe('Occurrence %');

			cycle();
			expect(firstDataCell().textContent).toMatch(/^[HSDPR]$/);
			expect(mode()).toBe('Optimal action');
		});

		it('colours the cells by action, then by heat ramp', () => {
			const firstDataCell = renderTable();

			expect([...firstDataCell().classList]).toContain('is-hit');

			cycle();
			const evClasses = [...firstDataCell().classList];
			expect(evClasses).toContain('is-numeric');
			expect(
				evClasses.some((name) => /^is-ev-(neg|pos)-\d+$|^is-ev-zero$/.test(name))
			).toBe(true);

			cycle();
			expect(
				[...firstDataCell().classList].some((name) => /^is-freq-\d+$/.test(name))
			).toBe(true);
		});

		// The ring is an inset shadow rather than a fill, so it survives the heat
		// colours -- and which cells the count has moved is worth as much while
		// reading their numbers as while reading their letters.
		// The ring marks a change of letter, which is dressing with no meaning on
		// top of the EV and occurrence heat ramps -- so it belongs to the action
		// mode alone.
		it('drops the deviation ring outside the action mode', () => {
			renderTable();

			const ringed = () => document.querySelectorAll('td[class*="was-"]').length;
			const inActionMode = ringed();
			expect(inActionMode).toBeGreaterThan(0);

			cycle();
			expect(ringed()).toBe(0);
			cycle();
			expect(ringed()).toBe(0);

			// And comes back on the way round, rather than being spent once.
			cycle();
			expect(ringed()).toBe(inActionMode);
		});

		// Space is the select's own key for opening its list, and the Calculate
		// button's for pressing it.
		it('leaves space alone inside a control that has its own use for it', () => {
			const firstDataCell = renderTable();

			const button = document.createElement('button');
			document.body.append(button);
			fireEvent.keyDown(button, { key: ' ' });
			expect(firstDataCell().textContent).toMatch(/^[HSDPR]$/);
			button.remove();

			const combobox = document.createElement('div');
			combobox.setAttribute('role', 'combobox');
			document.body.append(combobox);
			fireEvent.keyDown(combobox, { key: ' ' });
			expect(firstDataCell().textContent).toMatch(/^[HSDPR]$/);
			combobox.remove();
		});

		// The cell keeps Enter for its drill-down; space belongs to the cycle,
		// which stays available with a cell focused.
		it('cycles from a focused cell, and still opens its dialog on enter', async () => {
			const firstDataCell = renderTable();

			fireEvent.keyDown(firstDataCell(), { key: ' ' });
			expect(firstDataCell().textContent).toMatch(/^[+-]\d+\.\d$/);
			expect(screen.queryByRole('dialog')).toBeNull();

			fireEvent.keyDown(firstDataCell(), { key: 'Enter' });
			await screen.findByRole('dialog');
			await closeDialog();
		});

		it('restores the mode a previous session left the table in', () => {
			localStorage.setItem('qbcalc:cell-display-mode', 'occurrence');
			const firstDataCell = renderTable();

			expect(firstDataCell().textContent).toMatch(/^\d+\.\d\d$/);
		});

		it('ignores a stored mode it does not recognise', () => {
			localStorage.setItem('qbcalc:cell-display-mode', 'nonsense');
			const firstDataCell = renderTable();

			expect(firstDataCell().textContent).toMatch(/^[HSDPR]$/);
		});
	});

	it('keeps the popover open when the pointer moves onto it, and hides it once the pointer leaves both', async () => {
		render(() => (
			<EvTable
				result={() => SAMPLE_RESULT}
				isComputing={() => false}
				isSummaryComputing={() => false}
				error={() => null}
				bankroll={() => undefined}
				countEv={() => SAMPLE_COUNT_EV}
				trueCount={() => 1}
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
