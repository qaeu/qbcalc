/**
 * Shoe compositions and the counting systems that adjust them: building a full
 * shoe from a rule set, and collapsing a true count into a composition.
 */

import { RANKS, RANK_INDEX, type Rank } from './cards';
import { DEFAULT_RULE_SET, type RuleSet } from './rules';

/** Shoe composition in half-card units, indexed by `RANK_INDEX`. */
export type Composition = readonly number[];

/** A counting system's point value ("tag") for each rank. */
export type TagValues = Record<Rank, number>;

/** The Ace-Five count: +1 per five seen, -1 per ace seen, every other rank neutral. */
export const ACE_FIVE_TAGS: TagValues = {
	'2': 0,
	'3': 0,
	'4': 0,
	'5': 1,
	'6': 0,
	'7': 0,
	'8': 0,
	'9': 0,
	T: 0,
	A: -1,
};

export interface CalculatorParams extends RuleSet {
	trueCount: number;
	tags: TagValues;
}

export const DEFAULT_PARAMS: CalculatorParams = {
	...DEFAULT_RULE_SET,
	trueCount: 0,
	tags: ACE_FIVE_TAGS,
};

/** Cards in one deck -- the divisor that turns a running count into a true count. */
export const CARDS_PER_DECK = 52;

/**
 * Rounds a vector of fractional deltas to integers while preserving its sum
 * (largest-remainder method): floor every entry, then hand the leftover units to
 * the entries with the largest fractional parts.
 */
function roundPreservingSum(deltas: readonly number[]): number[] {
	const floors = deltas.map(Math.floor);
	const total = Math.round(deltas.reduce((sum, d) => sum + d, 0));
	let remaining = total - floors.reduce((sum, d) => sum + d, 0);

	const byRemainder = deltas
		.map((delta, index) => ({ index, remainder: delta - Math.floor(delta) }))
		.sort((a, b) => b.remainder - a.remainder);

	for (const { index } of byRemainder) {
		if (remaining <= 0) break;
		floors[index] += 1;
		remaining -= 1;
	}
	return floors;
}

export function baseComposition(ruleSet: RuleSet): Composition {
	const comp = new Array(10).fill(0);
	for (const rank of ['2', '3', '4', '5', '6', '7', '8', '9'] as Rank[]) {
		comp[RANK_INDEX[rank]] = 4 * ruleSet.decks * 2;
	}
	comp[RANK_INDEX.T] = 16 * ruleSet.decks * 2;
	comp[RANK_INDEX.A] = 4 * ruleSet.decks * 2;
	return comp;
}

/**
 * How much counting information a tag vector carries over a whole shoe:
 * `Σ w_r · t_r · (t_r − t̄)`, the frequency-weighted variance of the tags, with
 * `w_r` the cards of rank `r` and `t̄` the frequency-weighted mean tag.
 *
 * Equivalently `N · σ_t²` for a shoe of `N` cards, which is the form the
 * count-frequency model wants (docs/bankroll-model.md); `applyTrueCountToComposition`
 * below wants it as the divisor that turns a count into per-rank removals. Zero
 * -- to floating-point tolerance -- means the system cannot distinguish any rank
 * from any other, and no count value has any meaning under it.
 */
export function tagSpread(comp: Composition, tags: TagValues): number {
	const weights = comp.map((halfCards) => halfCards / 2);
	const totalCards = weights.reduce((sum, w) => sum + w, 0);
	const meanTag =
		weights.reduce((sum, w, index) => sum + w * tags[RANKS[index]], 0) / totalCards;
	return weights.reduce(
		(sum, w, index) => sum + w * tags[RANKS[index]] * (tags[RANKS[index]] - meanTag),
		0
	);
}

/**
 * Adjusts a composition to represent a given true count under an arbitrary
 * counting system.
 *
 * The count is what a player actually plays off, and a true count is the form of
 * it that means the same thing at every depth: it is a density, so the shoe it
 * describes does not depend on how many decks are left to divide by. The running
 * count it implies over the whole shoe -- `N = tc · decks` -- is what the removals
 * below are sized to.
 *
 * That count value `N` is spread across every rank at once: each rank is shifted in
 * proportion to how many of it the shoe holds (`w_r`) and to how far its tag sits
 * from the frequency-weighted mean tag (`t̄`), i.e. `d_r = -λ · w_r · (t_r - t̄)`
 * in real cards, with `λ` picked so the removals really do produce a running count
 * of `N`. Subtracting `t̄` keeps the shoe size fixed (`Σ d_r = 0`) and makes
 * unbalanced systems read their count relative to the system's own pivot. For the
 * Ace-Five tags this reduces exactly to `N/2` fewer real fives and `N/2` more real
 * aces, whatever the deck count. See docs/ev-model.md §Simplifications (3).
 *
 * `trueCount` need not be a whole number -- a fractional count is carried straight
 * into `λ`. Only the resulting per-rank deltas are rounded, in half-card units and
 * preserving their sum, since rank counts index the memo key and must stay whole.
 *
 * A count too extreme for the shoe is extrapolated rather than refused: the
 * removals stay linear in the count and a rank may pass below zero. The shoe that
 * comes back is then a fiction, but a continuous one, which is what lets callers
 * fit a curve through counts without the fit falling off a cliff at the edge of
 * what a real shoe could hold.
 */
export function applyTrueCountToComposition(
	comp: Composition,
	tags: TagValues,
	trueCount: number
): Composition {
	const weights = comp.map((halfCards) => halfCards / 2);
	const totalCards = weights.reduce((sum, w) => sum + w, 0);
	const meanTag =
		weights.reduce((sum, w, index) => sum + w * tags[RANKS[index]], 0) / totalCards;

	const spread = tagSpread(comp, tags);
	if (Math.abs(spread) < 1e-9) {
		if (trueCount === 0) return comp.slice();
		throw new Error('Tag values give the count no effect (all ranks weighted equally).');
	}

	const lambda = (trueCount * (totalCards / CARDS_PER_DECK)) / spread;
	const halfCardDeltas = weights.map(
		(w, index) => -2 * lambda * w * (tags[RANKS[index]] - meanTag)
	);

	const next = comp.slice();
	const rounded = roundPreservingSum(halfCardDeltas);
	for (let index = 0; index < next.length; index += 1) {
		next[index] += rounded[index];
	}
	return next;
}
