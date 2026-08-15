import { describe, it, expect } from 'vitest';

import {
	CELL_DISPLAY_MODES,
	HEAT_STEPS,
	cellDisplayText,
	evHeatClass,
	isCellDisplayMode,
	nextCellDisplayMode,
	occurrenceHeatClass,
} from '#utils/cellDisplay';
import type { EvCellData } from '#utils/ev/tables';

/** Only the three fields the cell text reads; the rest never leaves the engine. */
function cell(fields: Partial<EvCellData>): EvCellData {
	return {
		baseEvPercent: 0,
		countEvPercent: 0,
		deltaPercentPoints: 0,
		optimalAction: 'H',
		baseAction: 'H',
		playerBustOnHitPercent: 0,
		dealerBustPercent: 0,
		occurrencePercent: 0,
		actions: [],
		baseActions: [],
		...fields,
	};
}

describe('cellDisplay', () => {
	describe('nextCellDisplayMode', () => {
		it('steps through every mode and wraps back to the first', () => {
			let mode = CELL_DISPLAY_MODES[0];
			const seen = [mode];
			for (let i = 0; i < CELL_DISPLAY_MODES.length - 1; i += 1) {
				mode = nextCellDisplayMode(mode);
				seen.push(mode);
			}
			expect(seen).toEqual([...CELL_DISPLAY_MODES]);
			expect(nextCellDisplayMode(mode)).toBe(CELL_DISPLAY_MODES[0]);
		});
	});

	describe('isCellDisplayMode', () => {
		it('accepts the modes and rejects anything else', () => {
			for (const mode of CELL_DISPLAY_MODES) expect(isCellDisplayMode(mode)).toBe(true);
			expect(isCellDisplayMode('actions')).toBe(false);
			expect(isCellDisplayMode(null)).toBe(false);
			expect(isCellDisplayMode(0)).toBe(false);
		});
	});

	describe('cellDisplayText', () => {
		const row = cell({
			optimalAction: 'D',
			countEvPercent: 12.3456,
			occurrencePercent: 0.0432,
		});

		it('shows the action letter, unadorned, in action mode', () => {
			expect(cellDisplayText(row, 'action')).toBe('D');
		});

		it('signs the EV and cuts it to one decimal, so it fits a cell', () => {
			expect(cellDisplayText(row, 'ev')).toBe('+12.3');
			expect(cellDisplayText(cell({ countEvPercent: -4.56 }), 'ev')).toBe('-4.6');
		});

		// Two decimals, or every pair cell would round to 0.00.
		it('shows occurrence to two decimals, without a unit', () => {
			expect(cellDisplayText(row, 'occurrence')).toBe('0.04');
		});
	});

	describe('evHeatClass', () => {
		it('pins zero to the neutral middle', () => {
			expect(evHeatClass(0, 50)).toBe('is-ev-zero');
		});

		it('sends both ends of the domain to the outermost steps', () => {
			expect(evHeatClass(50, 50)).toBe(`is-ev-pos-${HEAT_STEPS}`);
			expect(evHeatClass(-50, 50)).toBe(`is-ev-neg-${HEAT_STEPS}`);
		});

		it('clamps beyond the domain rather than running off the ramp', () => {
			expect(evHeatClass(999, 50)).toBe(`is-ev-pos-${HEAT_STEPS}`);
			expect(evHeatClass(-999, 50)).toBe(`is-ev-neg-${HEAT_STEPS}`);
		});

		it('keeps a value just off zero off the neutral step', () => {
			expect(evHeatClass(0.0001, 50)).toBe('is-ev-pos-1');
			expect(evHeatClass(-0.0001, 50)).toBe('is-ev-neg-1');
		});

		it('scales symmetrically between the two', () => {
			expect(evHeatClass(25, 50)).toBe(`is-ev-pos-${HEAT_STEPS / 2}`);
			expect(evHeatClass(-25, 50)).toBe(`is-ev-neg-${HEAT_STEPS / 2}`);
		});

		it('falls back to neutral when there is no domain to scale against', () => {
			expect(evHeatClass(4, 0)).toBe('is-ev-zero');
		});
	});

	describe('occurrenceHeatClass', () => {
		it('runs from the bare bottom step to the top of the ramp', () => {
			expect(occurrenceHeatClass(0, 4)).toBe('is-freq-0');
			expect(occurrenceHeatClass(4, 4)).toBe(`is-freq-${HEAT_STEPS}`);
			expect(occurrenceHeatClass(99, 4)).toBe(`is-freq-${HEAT_STEPS}`);
		});

		it('falls back to the bottom step when there is no domain', () => {
			expect(occurrenceHeatClass(4, 0)).toBe('is-freq-0');
		});

		// The distribution is heavily skewed -- a handful of common cells and a
		// long tail of rare ones -- so a linear ramp would put nearly everything
		// in the bottom step. The square root is what spreads the tail out.
		it('spreads the rare cells across steps a linear ramp would collapse', () => {
			const domain = 4;
			const rare = [0.04, 0.08, 0.16, 0.32].map((value) =>
				occurrenceHeatClass(value, domain)
			);
			expect(new Set(rare).size).toBeGreaterThan(1);
			// A quarter of the domain sits halfway up, not a quarter of the way.
			expect(occurrenceHeatClass(domain / 4, domain)).toBe(`is-freq-${HEAT_STEPS / 2}`);
		});
	});
});
