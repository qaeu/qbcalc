import { describe, it, expect } from 'vitest';

import { RANKS, type Rank } from '#utils/ev/cards';
import { baseComposition, applyTrueCountToComposition } from '#utils/ev/composition';
import type { ActionAnalysis } from '#utils/ev/outcome';
import type { PlayCell, PlayGrids } from '#utils/ev/playGrids';
import { gridKey, splitGridKey } from '#utils/ev/engine';
import { DEFAULT_RULE_SET, type PlayerAction } from '#utils/ev/rules';
import { HI_LO_TAGS } from '#utils/settings/countingSystems';
import {
	createGame,
	legalActions,
	resolveInsurance,
	startRound,
	type GameState,
} from '#utils/play/game';
import { decideAction, decideInsurance } from '#utils/sim/policy';

import { scriptedShoe } from '../play/scriptedShoe';

/**
 * A cell priced to order: `base` is what the unadjusted grids say and `count`
 * what the count-adjusted ones do, each as action → EV in percent. Everything
 * the policy reads is one of those two lists, so a scripted grid is enough to
 * drive all three modes without pricing a shoe.
 */
function cell(
	base: Partial<Record<PlayerAction, number>>,
	count: Partial<Record<PlayerAction, number>> = base
): PlayCell {
	const priced = (evs: Partial<Record<PlayerAction, number>>): ActionAnalysis[] =>
		(Object.entries(evs) as [PlayerAction, number][]).map(([action, evPercent]) => ({
			action,
			evPercent,
			outcome: { winPercent: 40, pushPercent: 8, losePercent: 52 },
		}));
	return { baseActions: priced(base), actions: priced(count) };
}

function grids(entries: {
	hard?: Record<string, PlayCell>;
	split?: Record<string, PlayCell>;
}): PlayGrids {
	return {
		hard: new Map(Object.entries(entries.hard ?? {})),
		soft: new Map(),
		split: new Map(Object.entries(entries.split ?? {})),
	};
}

/** A round dealt to order, stopped at the player's first decision. */
function dealt(player: [Rank, Rank], upcard: Rank, hole: Rank = '7'): GameState {
	const shoe = scriptedShoe([player[0], upcard, player[1], hole, ...RANKS, ...RANKS]);
	const state = startRound(createGame(DEFAULT_RULE_SET, shoe), 10);
	return state.phase === 'insurance' ? resolveInsurance(state, false) : state;
}

describe('decideAction', () => {
	/**
	 * Hard 16 against a ten: basic strategy hits it and the count stands it,
	 * which is the first row of the Illustrious 18 and so exercises all three
	 * modes over one cell.
	 */
	const sixteenVsTen = grids({
		hard: { [gridKey(16, 'T')]: cell({ H: -53, S: -54 }, { H: -53, S: -50 }) },
	});

	it('never deviates in basic mode, however high the count', () => {
		const state = dealt(['T', '6'], 'T');
		const legal = legalActions(state);
		for (const count of [-8, 0, 4, 12]) {
			expect(decideAction(state, legal, sixteenVsTen, 'basic', count)).toBe('H');
		}
	});

	it('takes the count action in full mode, whatever the count says', () => {
		const state = dealt(['T', '6'], 'T');
		const legal = legalActions(state);
		// Full mode reads the count-adjusted list outright, so it stands at every
		// count -- the grids it is handed are already the count's own.
		for (const count of [-8, 0, 12]) {
			expect(decideAction(state, legal, sixteenVsTen, 'full', count)).toBe('S');
		}
	});

	it('takes exactly the eighteen in i18 mode', () => {
		const state = dealt(['T', '6'], 'T');
		const legal = legalActions(state);
		// The row stands 16 against a ten from zero up, and basic strategy below.
		expect(decideAction(state, legal, sixteenVsTen, 'i18', -1)).toBe('H');
		expect(decideAction(state, legal, sixteenVsTen, 'i18', 0)).toBe('S');
	});

	it('leaves a hand the eighteen do not cover on basic strategy', () => {
		// Hard 16 against a *nine* is not one of the rows until +5, and 17 against
		// a nine is not a row at all -- so however the count-adjusted prices are
		// scripted, i18 plays the base list.
		const state = dealt(['T', '7'], '9');
		const legal = legalActions(state);
		const scripted = grids({
			hard: { [gridKey(17, '9')]: cell({ H: -42, S: -40 }, { H: -10, S: -40 }) },
		});
		expect(decideAction(state, legal, scripted, 'i18', 9)).toBe('S');
		// Full mode, reading the same count list, goes the other way -- which is
		// what makes the two modes distinguishable at all.
		expect(decideAction(state, legal, scripted, 'full', 9)).toBe('H');
	});

	describe('legality', () => {
		it('never chooses an action the table has not offered', () => {
			// The scripted cell prices a surrender best; the table offers none, so
			// no mode may take it.
			const state = dealt(['T', '6'], 'T');
			const legal = legalActions(state);
			expect(legal).not.toContain('R');
			const withSurrender = grids({
				hard: { [gridKey(16, 'T')]: cell({ H: -53, S: -54, R: -50 }) },
			});
			for (const mode of ['basic', 'i18', 'full'] as const) {
				for (const count of [-6, 0, 6]) {
					expect(decideAction(state, legal, withSurrender, mode, count)).not.toBe('R');
				}
			}
		});

		it('plays a pair out of the splits grid', () => {
			const state = dealt(['8', '8'], '6');
			const legal = legalActions(state);
			expect(legal).toContain('P');
			const scripted = grids({
				split: { [splitGridKey('8', '6')]: cell({ H: -20, S: -15, P: 12 }) },
			});
			expect(decideAction(state, legal, scripted, 'basic', 0)).toBe('P');
		});

		it('falls back to a legal action for a hand the grids do not price', () => {
			const state = dealt(['T', '6'], 'T');
			const legal = legalActions(state);
			const empty = grids({});
			expect(legal).toContain(decideAction(state, legal, empty, 'full', 0));
		});
	});
});

describe('decideInsurance', () => {
	const base = baseComposition(DEFAULT_RULE_SET);
	const rich = applyTrueCountToComposition(base, HI_LO_TAGS, 6);

	it('never insures on basic strategy', () => {
		expect(decideInsurance('basic', rich, 12)).toBe(false);
	});

	it('insures from Hi-Lo +3 in i18 mode', () => {
		expect(decideInsurance('i18', base, 2.5)).toBe(false);
		expect(decideInsurance('i18', base, 3)).toBe(true);
	});

	it('insures on a positive bet in full mode, whatever the count reads', () => {
		// Priced off the composition rather than off a count index, so a shoe that
		// has not moved is declined and a ten-rich one is taken.
		expect(decideInsurance('full', base, 6)).toBe(false);
		expect(decideInsurance('full', rich, 0)).toBe(true);
	});
});
