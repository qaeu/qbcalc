import { describe, it, expect } from 'vitest';

import { RANKS, type Rank } from '#utils/ev/cards';
import type { TagValues } from '#utils/ev/composition';
import { hiLoCountScale } from '#utils/bankroll';
import { baseComposition } from '#utils/ev/composition';
import { DEFAULT_RULE_SET, type PlayerAction } from '#utils/ev/rules';
import {
	applyAction,
	createGame,
	legalActions,
	resolveInsurance,
	startRound,
} from '#utils/play/game';
import { HI_LO_TAGS, tagsForSystem } from '#utils/countingSystems';
import { ILLUSTRIOUS_18, indexAction } from '#utils/sim/indices';

import { scriptedShoe } from '../play/scriptedShoe';

/**
 * A round dealt to order, stopped at the player's first decision -- which is
 * where every index row fires. Deal order is player, upcard, player, hole.
 */
function firstDecision(
	player: [Rank, Rank],
	upcard: Rank,
	hole: Rank = '7'
): { state: ReturnType<typeof startRound>; legal: PlayerAction[] } {
	const shoe = scriptedShoe([player[0], upcard, player[1], hole, ...RANKS, ...RANKS]);
	const dealt = startRound(createGame(DEFAULT_RULE_SET, shoe), 10);
	// An ace up opens the round on the insurance offer, which has to be answered
	// before there is a playing decision for a row to fire on.
	const state = dealt.phase === 'insurance' ? resolveInsurance(dealt, false) : dealt;
	return { state, legal: legalActions(state) };
}

function actionAt(
	player: [Rank, Rank],
	upcard: Rank,
	hiLoTrueCount: number
): PlayerAction | null {
	const { state, legal } = firstDecision(player, upcard);
	return indexAction(state, legal, hiLoTrueCount);
}

describe('the Illustrious 18 as data', () => {
	it('carries the seventeen playing rows, insurance apart', () => {
		expect(ILLUSTRIOUS_18).toHaveLength(17);
	});

	it('never names an upcard or an action the game has no word for', () => {
		for (const row of ILLUSTRIOUS_18) {
			expect(RANKS).toContain(row.upcard);
			expect(['H', 'S', 'D', 'P', 'R']).toContain(row.action);
		}
	});
});

describe('indexAction', () => {
	describe('rows that fire on a rising count', () => {
		it('stands 16 against a ten at 0 and not a half-count below', () => {
			// The most valuable index there is, and the one whose trigger sits
			// exactly on zero -- so it is also the one a half-count either way is
			// most likely to catch out.
			expect(actionAt(['T', '6'], 'T', 0)).toBe('S');
			expect(actionAt(['T', '6'], 'T', 0.5)).toBe('S');
			expect(actionAt(['T', '6'], 'T', -0.5)).toBeNull();
		});

		it('stands 15 against a ten only from +4', () => {
			expect(actionAt(['T', '5'], 'T', 3.5)).toBeNull();
			expect(actionAt(['T', '5'], 'T', 4)).toBe('S');
		});

		it('doubles 11 against an ace from +1', () => {
			expect(actionAt(['9', '2'], 'A', 0.5)).toBeNull();
			expect(actionAt(['9', '2'], 'A', 1)).toBe('D');
		});

		it('splits tens against a six from +4, and against a five from +5', () => {
			expect(actionAt(['T', 'T'], '6', 3.5)).toBeNull();
			expect(actionAt(['T', 'T'], '6', 4)).toBe('P');
			expect(actionAt(['T', 'T'], '5', 4)).toBeNull();
			expect(actionAt(['T', 'T'], '5', 5)).toBe('P');
		});
	});

	describe('rows that fire on a falling count', () => {
		it('hits 12 against a four below zero, and stands at it', () => {
			expect(actionAt(['T', '2'], '4', 0)).toBeNull();
			expect(actionAt(['T', '2'], '4', -0.5)).toBe('H');
		});

		it('hits 13 against a two below −1', () => {
			expect(actionAt(['T', '3'], '2', -1)).toBeNull();
			expect(actionAt(['T', '3'], '2', -1.5)).toBe('H');
		});
	});

	describe('what it declines to answer', () => {
		it('has nothing to say about a hand outside the eighteen', () => {
			expect(actionAt(['T', '8'], '9', 6)).toBeNull();
			expect(actionAt(['T', '7'], '4', -6)).toBeNull();
		});

		it('reads a splittable pair as a pair, not as its total', () => {
			// 8,8 totals 16, and 16 against a ten is the first row of the table --
			// but a hand that may still be split is looked up in the splits grid,
			// so the hard row must not reach it.
			expect(actionAt(['8', '8'], 'T', 4)).toBeNull();
		});

		it('never returns an action the table will not allow', () => {
			// 2,3 against a two, hit to a hard 12: the 12-against-a-two row would
			// stand it at +3, and standing is legal -- but the 9-against-a-two row
			// below wants a double the drawn hand can no longer take.
			const { state } = firstDecision(['2', '7'], '2');
			const drawn = applyAction(state, 'H');
			expect(drawn.hands[0].total).toBe(11);
			expect(legalActions(drawn)).not.toContain('D');
			expect(indexAction(drawn, legalActions(drawn), 6)).toBeNull();
		});
	});

	describe('the Hi-Lo axis', () => {
		it('moves the trigger under a level-two system', () => {
			// The rows are Hi-Lo-denominated, so a caller converts its own count
			// through `hiLoCountScale` before asking. Zen runs on well over Hi-Lo's
			// axis, so a counter reading Zen +4 is standing at a shoe barely past
			// Hi-Lo +2 -- and 15 against a ten does not stand until +4. Asking with
			// the raw count would take the deviation two counts early.
			const zen = tagsForSystem('zen') as TagValues;
			const scale = hiLoCountScale(baseComposition(DEFAULT_RULE_SET), zen);
			expect(scale).toBeGreaterThan(1.5);

			const zenCount = 4;
			expect(actionAt(['T', '5'], 'T', zenCount)).toBe('S');
			expect(actionAt(['T', '5'], 'T', zenCount / scale)).toBeNull();
		});

		it('leaves a Hi-Lo count where it is', () => {
			const scale = hiLoCountScale(baseComposition(DEFAULT_RULE_SET), HI_LO_TAGS);
			expect(scale).toBeCloseTo(1, 10);
		});
	});
});
