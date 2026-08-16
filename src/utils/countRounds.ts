/**
 * How a shoe's rounds are spread across the true count: the share of the rounds
 * dealt before the cut card that are played at each count. Pure and free of
 * SolidJS, like `ev/`. The method and its assumptions are in
 * docs/count-rounds-model.md.
 *
 * `bankroll.ts` answers the same question in closed form, from a normal
 * approximation at each depth, because it needs a smooth distribution to
 * integrate a bet ramp against. This module deals the shoe instead: the tag
 * supply is finite, so the count a shoe can actually reach is bounded by what is
 * in it, and the graph is drawn from what the deal does rather than from a curve
 * fitted over it.
 */

import { RANKS } from './ev/cards';
import { baseComposition, CARDS_PER_DECK, type TagValues } from './ev/composition';
import type { RuleSet } from './ev/rules';

/**
 * The buckets a round is filed under: every whole count from -6 to +6, with the
 * two outermost open, so a round dealt at +9 files under +6.
 *
 * The count is rounded to the nearest whole one, not truncated. Truncating would
 * be the closer description of what a player bets -- at +2.9 you are on the +2
 * step of the ramp -- but it gives the zero bucket everything from -1 to +1,
 * twice the width of every other bucket, and the graph is read as a shape. Every
 * bar is one count wide, so their heights compare.
 */
export const ROUND_TRUE_COUNTS: readonly number[] = [
	-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6,
];

/** How much of a shoe's play happens at one count. */
export interface CountShare {
	trueCount: number;
	/** Fraction of all rounds dealt. The buckets sum to one. */
	frequency: number;
}

export interface RoundFrequency {
	/** One entry per `ROUND_TRUE_COUNTS` bucket, in the same order. */
	rounds: CountShare[];
	/** Rounds a shoe deals before the cut card. */
	roundsPerShoe: number;
	/**
	 * Fraction of rounds filed under +1 or better, where the counter has the
	 * edge. Read off the buckets, so it is the sum of the bars the graph draws
	 * right of zero.
	 */
	advantageShare: number;
	/** Mean true count over the rounds dealt at +1 or better, or 0 if there are none. */
	meanAdvantageCount: number;
}

/**
 * Shoes dealt per graph. The figures are read to a tenth of a percent, and with
 * tens of rounds sampled from each shoe the worst standard error at this many
 * trials is well inside that.
 */
const TRIALS = 20000;

/**
 * Fixed, so the same settings always draw the same graph. A drifting seed would
 * twitch every bar by a fraction of a percent on each unrelated recalculation.
 */
const SEED = 0x9e3779b9;

/**
 * Cards dealt per round, which is where the count is read: a counter bets
 * between rounds, so a count that comes and goes inside one is never a count a
 * round is played at. Five is about a heads-up round -- two hands of a little
 * over two cards each.
 */
const CARDS_PER_ROUND = 5;

/** Mulberry32: small, fast, and seeded, which is all the shuffle needs. */
function randomSource(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * One entry per card in the shoe, holding that card's tag centred on the tag
 * vector's own frequency-weighted mean. Centring is what lets an unbalanced
 * system be dealt like a balanced one: the count is then mean-zero around the
 * system's pivot and comes back to zero as the last card is turned, which is the
 * same reading of an unbalanced count the EV engine takes (see `tagSpread` in
 * ev/composition.ts).
 */
function shoeTags(ruleSet: RuleSet, tags: TagValues): Float64Array {
	const comp = baseComposition(ruleSet);
	const cards = comp.reduce((sum, halfCards) => sum + halfCards / 2, 0);
	const meanTag =
		comp.reduce((sum, halfCards, index) => sum + (halfCards / 2) * tags[RANKS[index]], 0)
		/ cards;

	const shoe = new Float64Array(cards);
	let next = 0;
	comp.forEach((halfCards, index) => {
		const centred = tags[RANKS[index]] - meanTag;
		for (let card = 0; card < halfCards / 2; card += 1) {
			shoe[next] = centred;
			next += 1;
		}
	});
	return shoe;
}

/** Fisher-Yates, in place: the one shoe buffer is reshuffled for each trial. */
function shuffle(shoe: Float64Array, random: () => number): void {
	for (let index = shoe.length - 1; index > 0; index -= 1) {
		const swap = Math.floor(random() * (index + 1));
		const held = shoe[index];
		shoe[index] = shoe[swap];
		shoe[swap] = held;
	}
}

/**
 * The bucket a round's count is filed under: rounded to the nearest whole count
 * and held inside the drawn range, whose ends are open.
 */
function bucketOf(trueCount: number): number {
	const first = ROUND_TRUE_COUNTS[0];
	const last = ROUND_TRUE_COUNTS[ROUND_TRUE_COUNTS.length - 1];
	const held = Math.min(last, Math.max(first, Math.round(trueCount)));
	return held - first;
}

/**
 * How a shoe's rounds are spread across the true count, over `TRIALS` shuffled
 * shoes dealt to `penetrationPercent`.
 *
 * Every round of every shoe is filed, so the result is the share of a session's
 * play spent at each count rather than anything about individual shoes: a count
 * a shoe visits for one round out of sixty is one sixtieth of a shoe's worth of
 * play, and the graph says so.
 */
export function simulateRoundFrequency(
	ruleSet: RuleSet,
	tags: TagValues
): RoundFrequency {
	const shoe = shoeTags(ruleSet, tags);
	const cutCard = Math.floor((shoe.length * ruleSet.penetrationPercent) / 100);
	const random = randomSource(SEED);

	const counts = ROUND_TRUE_COUNTS.map(() => 0);
	let totalRounds = 0;
	let advantageRounds = 0;
	let advantageCount = 0;

	for (let trial = 0; trial < TRIALS; trial += 1) {
		shuffle(shoe, random);

		let runningCount = 0;
		for (let seen = 0; seen < cutCard; seen += CARDS_PER_ROUND) {
			// The count a round is played at is the one standing as it is dealt, so
			// the bucket is read before the round's own cards are turned.
			const decksLeft = (shoe.length - seen) / CARDS_PER_DECK;
			// A shoe dealt to its last card divides by nothing, and there is no
			// count to bet into where there is nothing left to deal.
			if (decksLeft <= 0) break;
			const trueCount = runningCount / decksLeft;
			const bucket = bucketOf(trueCount);
			counts[bucket] += 1;
			totalRounds += 1;
			// Counted by bucket rather than by the raw count, so the reading under
			// the graph adds up the bars the reader can see.
			if (ROUND_TRUE_COUNTS[bucket] >= 1) {
				advantageRounds += 1;
				advantageCount += trueCount;
			}

			const dealt = Math.min(CARDS_PER_ROUND, cutCard - seen);
			for (let card = 0; card < dealt; card += 1) runningCount += shoe[seen + card];
		}
	}

	return {
		rounds: ROUND_TRUE_COUNTS.map((trueCount, index) => ({
			trueCount,
			frequency: totalRounds > 0 ? counts[index] / totalRounds : 0,
		})),
		roundsPerShoe: totalRounds / TRIALS,
		advantageShare: totalRounds > 0 ? advantageRounds / totalRounds : 0,
		meanAdvantageCount: advantageRounds > 0 ? advantageCount / advantageRounds : 0,
	};
}
