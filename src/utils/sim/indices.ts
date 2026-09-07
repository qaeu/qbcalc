/**
 * The Illustrious 18 as data: the eighteen departures from basic strategy that
 * carry most of what index play is worth, plus the insurance index that is
 * usually counted alongside them.
 *
 * **The indices are Hi-Lo-denominated**, like the bet ramp
 * (docs/bankroll-model.md §The ramp's count axis) and `countRounds.ts`'s buckets.
 * A caller converts the system's own true count through `hiLoCountScale` before
 * asking, so the same eighteen rows mean the same *shoes* under Zen or KO as they
 * do under Hi-Lo. See docs/sim-model.md §Deviation modes.
 */

import type { Rank } from '../ev/cards';
import type { PlayerAction } from '../ev/rules';
import type { GameState } from '../play/game';

/** Which of the three grids a row's hand belongs to, matching `cellFor`. */
type IndexHand =
	| { kind: 'hard'; total: number }
	| { kind: 'soft'; total: number }
	| { kind: 'pair'; rank: Rank };

export interface IndexRow {
	hand: IndexHand;
	upcard: Rank;
	/** The action the row calls for once its index is reached. */
	action: PlayerAction;
	/**
	 * The Hi-Lo-equivalent true count the row fires at. `atOrAbove` rows take the
	 * action from that count upwards; `below` rows take it strictly beneath it --
	 * the two halves of the table, since a departure can be a stand a rising count
	 * buys or a hit a falling one forces.
	 */
	hiLoIndex: number;
	direction: 'atOrAbove' | 'below';
}

/**
 * The Hi-Lo count at which insurance is a fair bet and above which it is a good
 * one -- the first of the eighteen as Wong's list numbers them. It is a side bet
 * rather than a playing decision, so it lives here as a bare index and `policy.ts`
 * applies it; `ILLUSTRIOUS_18` below holds the seventeen playing rows.
 */
export const INSURANCE_HI_LO_INDEX = 3;

/**
 * A row that fires from `hiLoIndex` upwards -- a stand or a double a rising
 * count buys. Written as a call rather than an object literal so the table below
 * stays a table: one row a line, in the order a strategy card prints them.
 */
function from(
	hand: IndexHand,
	upcard: Rank,
	action: PlayerAction,
	hiLoIndex: number
): IndexRow {
	return { hand, upcard, action, hiLoIndex, direction: 'atOrAbove' };
}

/** And one that fires strictly beneath it -- a hit a falling count forces. */
function under(
	hand: IndexHand,
	upcard: Rank,
	action: PlayerAction,
	hiLoIndex: number
): IndexRow {
	return { hand, upcard, action, hiLoIndex, direction: 'below' };
}

const hard = (total: number): IndexHand => ({ kind: 'hard', total });
const pair = (rank: Rank): IndexHand => ({ kind: 'pair', rank });

/**
 * The seventeen playing departures, in the order they are usually ranked by
 * value. Standing and doubling rows fire on a *rising* count, the five low-total
 * hitting rows on a falling one.
 */
export const ILLUSTRIOUS_18: readonly IndexRow[] = [
	from(hard(16), 'T', 'S', 0),
	from(hard(15), 'T', 'S', 4),
	from(pair('T'), '5', 'P', 5),
	from(pair('T'), '6', 'P', 4),
	from(hard(10), 'T', 'D', 4),
	from(hard(12), '3', 'S', 2),
	from(hard(12), '2', 'S', 3),
	from(hard(11), 'A', 'D', 1),
	from(hard(9), '2', 'D', 1),
	from(hard(10), 'A', 'D', 4),
	from(hard(9), '7', 'D', 3),
	from(hard(16), '9', 'S', 5),
	under(hard(13), '2', 'H', -1),
	under(hard(12), '4', 'H', 0),
	under(hard(12), '5', 'H', -2),
	under(hard(12), '6', 'H', -1),
	under(hard(13), '3', 'H', -2),
];

/** Whether a row fires at this count. */
function fires(row: IndexRow, hiLoTrueCount: number): boolean {
	return row.direction === 'atOrAbove' ?
			hiLoTrueCount >= row.hiLoIndex
		:	hiLoTrueCount < row.hiLoIndex;
}

/**
 * Which of the three hand shapes the active hand is, read exactly as
 * `play/coach.ts`'s `cellFor` reads it: a pair the player may still split is a
 * pair, and anything else is its total. A hand that has drawn past two cards can
 * no longer be a pair row, which is what keeps 8,8 against a ten out of the hard
 * 16 row while it is still splittable.
 */
function handShape(state: GameState, legal: readonly PlayerAction[]): IndexHand {
	const hand = state.hands[state.activeHandIndex];
	if (legal.includes('P')) return { kind: 'pair', rank: hand.cards[0] };
	return { kind: hand.soft ? 'soft' : 'hard', total: hand.total };
}

function sameHand(a: IndexHand, b: IndexHand): boolean {
	if (a.kind !== b.kind) return false;
	if (a.kind === 'pair') return a.rank === (b as { rank: Rank }).rank;
	return a.total === (b as { total: number }).total;
}

/**
 * The index play for the hand in front of the player at this Hi-Lo-equivalent
 * true count, or `null` where the eighteen have nothing to say about it -- which
 * is the overwhelming majority of hands, and where basic strategy stands.
 *
 * An index whose action the table will not allow right now (a double on three
 * cards, a surrender already refused) is dropped rather than forced: a departure
 * you cannot make is not a departure.
 */
export function indexAction(
	state: GameState,
	legal: readonly PlayerAction[],
	hiLoTrueCount: number
): PlayerAction | null {
	if (state.phase !== 'act' || legal.length === 0) return null;
	const shape = handShape(state, legal);
	const upcard = state.dealer.cards[0];
	for (const row of ILLUSTRIOUS_18) {
		if (row.upcard !== upcard || !sameHand(row.hand, shape)) continue;
		if (!fires(row, hiLoTrueCount) || !legal.includes(row.action)) continue;
		return row.action;
	}
	return null;
}
