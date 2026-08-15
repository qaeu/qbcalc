/**
 * Card vocabulary and hand arithmetic: the rank set, its lookup tables, and the
 * packed (total, soft) representation every draw in the engine goes through.
 */

export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'A';

export const RANKS: readonly Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'A'];

export const RANK_INDEX: Record<Rank, number> = Object.fromEntries(
	RANKS.map((rank, index) => [rank, index])
) as Record<Rank, number>;

/** Hard value of each rank, indexed by `RANK_INDEX` (an ace counts as 11). */
export const RANK_VALUE = Int32Array.from([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
export const ACE_INDEX = RANKS.length - 1;

/**
 * One *card* is two units, so drawing a card subtracts 2. A count adjustment can
 * leave a rank on an odd number of units, so every draw loop guards on
 * `n >= CARD_UNITS` rather than `n > 0`: the leftover half-unit is not a card
 * anyone can be dealt. See docs/ev-model.md §Method.
 */
export const CARD_UNITS = 2;

/**
 * Place value per rank for the memo key: a node is identified by which cards have
 * been removed from the root composition, and a child's key is its parent's plus
 * one place value. See docs/ev-model.md §Performance notes for the bit budget.
 */
export const KEY_MULT = Float64Array.from({ length: 10 }, (_, index) => 32 ** index);

/**
 * Adds one card to a (total, soft) hand state, demoting aces from 11 to 1 only as
 * far as is needed to stay at or under 21. Returned packed as
 * `(total << 1) | soft` so that a draw -- the innermost operation in the whole
 * engine -- allocates nothing.
 *
 * `soft` means "exactly one ace in this hand is currently counted as 11" -- two
 * aces can never both be 11 (22 busts), so a single flag is enough. A soft hand
 * that draws an ace therefore holds *two* demotable aces for the duration of this
 * call: the new one is demoted first, and only if the hand is still over 21 does
 * the original follow it down. That second ace is what the hand keeps: soft 12 + T
 * is hard 12, but A,A stays soft 12, and A,7,A stays soft 19.
 */
export function addPacked(total: number, soft: boolean, rankIndex: number): number {
	let newTotal = total + RANK_VALUE[rankIndex];
	let acesAsEleven = (soft ? 1 : 0) + (rankIndex === ACE_INDEX ? 1 : 0);
	while (newTotal > 21 && acesAsEleven > 0) {
		newTotal -= 10;
		acesAsEleven -= 1;
	}
	return (newTotal << 1) | (acesAsEleven > 0 ? 1 : 0);
}

/** `addPacked` unpacked, for the callers that aren't on the hot path. */
export function addValue(total: number, soft: boolean, rank: Rank): [number, boolean] {
	const packed = addPacked(total, soft, RANK_INDEX[rank]);
	return [packed >> 1, (packed & 1) === 1];
}

/**
 * The two-card hard/soft total of a pair, e.g. 8,8 -> hard 16; A,A -> soft 12 (the
 * second ace drops to 1, but the first still counts as 11, so the hand cannot bust
 * on the next card).
 */
export function pairTotal(rank: Rank): [number, boolean] {
	const [afterFirst, softAfterFirst] = addValue(0, false, rank);
	return addValue(afterFirst, softAfterFirst, rank);
}

/**
 * The hole card that would complete a dealer blackjack, or null for an upcard that
 * cannot make one.
 */
export function blackjackHoleRank(upcard: Rank): Rank | null {
	if (upcard === 'A') return 'T';
	if (upcard === 'T') return 'A';
	return null;
}
