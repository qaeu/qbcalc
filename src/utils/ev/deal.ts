/**
 * The opening deal: how likely each starting hand is against each upcard. This is
 * the weighting the average-EV figure sums the priced hands under -- see
 * docs/ev-model.md §The average hand.
 */

import { CARD_UNITS, RANKS } from './cards';
import type { Composition } from './composition';

const RANK_COUNT = RANKS.length;

/**
 * Probability of each (player pair, dealer upcard) opening, indexed by
 * `dealIndex`. The player's two cards are unordered, so only the `low <= high`
 * slots carry any weight and the rest stay zero.
 */
export type DealWeights = Float64Array;

export function dealIndex(low: number, high: number, upcard: number): number {
	return (low * RANK_COUNT + high) * RANK_COUNT + upcard;
}

/**
 * Probability of every opening the shoe can deal, over three cards drawn without
 * replacement -- unlike the EV recursion, which leaves the player's own cards in
 * the shoe (docs/ev-model.md §Simplifications (1)). Nothing here feeds that
 * recursion: these are only the weights its answers are averaged under, and the
 * chance of being dealt a hand is exactly the place where the player's own cards
 * are the whole question.
 *
 * Normalised at the end so the weights are a probability distribution even on a
 * shoe holding a rank in the half-card units a count adjustment can leave behind:
 * a lone half-unit is not a card anyone can be dealt, so it is skipped here just
 * as it is in every other draw loop.
 */
export function dealWeights(comp: Composition): DealWeights {
	const weights = new Float64Array(RANK_COUNT ** 3);
	const rest = Array.from(comp);
	let total = 0;
	for (let index = 0; index < RANK_COUNT; index += 1) total += rest[index];
	if (total < 3 * CARD_UNITS) return weights;

	let dealt = 0;
	for (let first = 0; first < RANK_COUNT; first += 1) {
		if (rest[first] < CARD_UNITS) continue;
		const pFirst = rest[first] / total;
		rest[first] -= CARD_UNITS;
		for (let second = 0; second < RANK_COUNT; second += 1) {
			if (rest[second] < CARD_UNITS) continue;
			const pSecond = rest[second] / (total - CARD_UNITS);
			rest[second] -= CARD_UNITS;
			for (let upcard = 0; upcard < RANK_COUNT; upcard += 1) {
				if (rest[upcard] < CARD_UNITS) continue;
				const weight = pFirst * pSecond * (rest[upcard] / (total - 2 * CARD_UNITS));
				// Both orders of the player's cards land in the one unordered slot.
				weights[dealIndex(Math.min(first, second), Math.max(first, second), upcard)] +=
					weight;
				dealt += weight;
			}
			rest[second] += CARD_UNITS;
		}
		rest[first] += CARD_UNITS;
	}

	if (dealt > 0 && dealt !== 1) {
		for (let index = 0; index < weights.length; index += 1) weights[index] /= dealt;
	}
	return weights;
}
