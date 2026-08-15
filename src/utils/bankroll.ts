/**
 * Bet sizing and risk: how often each true count comes up, what a bet ramp wins
 * across that distribution, and what it risks. Pure and free of SolidJS, like
 * `ev/`. The method and its assumptions are in docs/bankroll-model.md.
 */

import { baseComposition, tagSpread, type TagValues } from './ev/composition';
import type { RuleSet } from './ev/rules';

/** Cards in one deck -- the divisor that turns a running count into a true count. */
const CARDS_PER_DECK = 52;

/**
 * The true counts the bet ramp is indexed by. The first bucket catches every
 * count at or below it and the last every count at or above, so the ramp covers
 * the whole line with a fixed seven entries -- which is what keeps both the
 * stored shape and the editor grid simple.
 */
export const RAMP_TRUE_COUNTS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];

/** Column headings for the ramp, matching `RAMP_TRUE_COUNTS`' open-ended ends. */
export const RAMP_LABELS: readonly string[] = ['≤0', '+1', '+2', '+3', '+4', '+5', '≥+6'];

/** How often one true-count bucket comes up, as a fraction of rounds played. */
export interface CountFrequency {
	/** The bucket's label, read against `RAMP_TRUE_COUNTS`' open ends. */
	trueCount: number;
	frequency: number;
	/**
	 * The average true count actually seen inside the bucket, which is what the
	 * edge is priced at. It is not the label: the two end buckets are open, so
	 * the bottom one averages well below zero however it is labelled, and pricing
	 * it at its label would quietly forgive the whole negative half of the shoe.
	 */
	meanTrueCount: number;
}

export interface BankrollInputs {
	/** Total bankroll, in the same currency as `unit`. */
	bankroll: number;
	/** What one betting unit is worth. */
	unit: number;
	roundsPerHour: number;
	/** Units wagered in each `RAMP_TRUE_COUNTS` bucket. */
	ramp: readonly number[];
	/** Player edge at a true count of zero, in percent -- `average.baseEvPercent`. */
	baseEvPercent: number;
	/** Percentage points of edge per unit of true count. */
	edgeSlopePointsPerTrueCount: number;
	/** Variance of one flat-bet round, in units² -- `average.variancePerRound`. */
	variancePerRound: number;
}

export interface BankrollAnalysis {
	/**
	 * The player's edge over a whole shoe, in percent of each unit wagered: every
	 * count's edge averaged under how often that count comes up and how much the
	 * ramp bets into it.
	 *
	 * This is the figure that answers "what is this game worth to me", where the
	 * grids' own EV answers "what is this spot worth right now". Under a flat bet
	 * it comes back to exactly the count-zero edge, since the count is mean-zero;
	 * a spread is what pulls it positive, by putting more money on the counts
	 * that are worth more.
	 */
	edgePercent: number;
	/** Mean units wagered per round, i.e. the spread the ramp actually achieves. */
	averageBetUnits: number;
	/** Expected win per round, in units. */
	evUnitsPerRound: number;
	/** Variance of one round's result under the ramp, in units². */
	varianceUnitsPerRound: number;
	winRatePerHour: number;
	sdPerHour: number;
	/**
	 * Rounds until the expected win is one standard deviation -- the usual
	 * "how long before the edge outruns the noise" yardstick. `Infinity` at a
	 * non-positive edge, which never outruns it.
	 */
	n0Rounds: number;
	/** The unit size at which this ramp would be betting full Kelly. */
	kellyUnit: number;
	/** Chance of losing the whole bankroll, as a fraction of 1. */
	riskOfRuin: number;
	/** The distribution the figures above were summed over. */
	frequencies: readonly CountFrequency[];
}

/**
 * How many depth slices the shoe is cut into when averaging the count
 * distribution over the deal. The distribution widens smoothly with depth, so
 * this is well past the point where more slices change a displayed figure.
 */
const DEPTH_SLICES = 128;

/**
 * Standard normal CDF, via the Abramowitz & Stegun 7.1.26 error-function
 * approximation (absolute error under 1.5e-7 -- far below anything a percentage
 * on screen would show).
 */
function normalCdf(z: number): number {
	const sign = z < 0 ? -1 : 1;
	const x = Math.abs(z) / Math.SQRT2;
	const t = 1 / (1 + 0.3275911 * x);
	const poly =
		t
		* (0.254829592
			+ t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
	const erf = 1 - poly * Math.exp(-x * x);
	return 0.5 * (1 + sign * erf);
}

/** Standard normal density. */
function normalPdf(z: number): number {
	return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

/**
 * `E[X · 1{X ≤ x}]` for a mean-zero normal of spread `sd`, i.e. the partial
 * expectation up to a cut. Differencing two of these gives the count mass a
 * bucket holds, which is what turns a bucket into the true count it is priced at.
 */
function partialExpectationBelow(cut: number, sd: number): number {
	return -sd * normalPdf(cut / sd);
}

/**
 * Splits one normal true-count distribution of the given spread across the ramp's
 * buckets, adding both the probability and the count mass into `weights` and
 * `moments`. Integer buckets take the half-open unit interval around them; the
 * two end buckets take everything past their edge.
 */
function accumulateBuckets(
	sd: number,
	weight: number,
	weights: number[],
	moments: number[]
): void {
	const last = RAMP_TRUE_COUNTS.length - 1;
	// A shoe barely dealt into cannot have moved: all of it sits at zero.
	if (sd <= 0) {
		weights[0] += weight;
		return;
	}

	let belowP = normalCdf((RAMP_TRUE_COUNTS[0] + 0.5) / sd);
	let belowE = partialExpectationBelow(RAMP_TRUE_COUNTS[0] + 0.5, sd);
	weights[0] += weight * belowP;
	moments[0] += weight * belowE;

	for (let index = 1; index < last; index += 1) {
		const cut = RAMP_TRUE_COUNTS[index] + 0.5;
		const upperP = normalCdf(cut / sd);
		const upperE = partialExpectationBelow(cut, sd);
		weights[index] += weight * (upperP - belowP);
		moments[index] += weight * (upperE - belowE);
		belowP = upperP;
		belowE = upperE;
	}

	weights[last] += weight * (1 - belowP);
	// The whole distribution has mean zero, so what is left above the last cut is
	// exactly what the cuts below it did not take.
	moments[last] += weight * -belowE;
}

/**
 * How often each ramp bucket comes up over a shoe dealt to `penetrationPercent`.
 *
 * The running count after `n` of `N` cards is a sum drawn without replacement, so
 * `Var(RC) = n·σ_t²·(N−n)/(N−1)`; dividing by the `(N−n)/52` decks left gives the
 * true count's spread at that depth. Depth is then averaged uniformly over the
 * dealt portion. See docs/bankroll-model.md §How often a count comes up.
 */
export function trueCountFrequencies(
	ruleSet: RuleSet,
	tags: TagValues
): CountFrequency[] {
	const comp = baseComposition(ruleSet);
	const totalCards = ruleSet.decks * CARDS_PER_DECK;
	// `tagSpread` is N·σ_t² over the full shoe, centred on the system's own pivot
	// -- which is what lets an unbalanced count still be read as mean-zero.
	const tagSd = Math.sqrt(Math.max(0, tagSpread(comp, tags)) / totalCards);
	const dealtCards = totalCards * (ruleSet.penetrationPercent / 100);

	const weights = new Array<number>(RAMP_TRUE_COUNTS.length).fill(0);
	const moments = new Array<number>(RAMP_TRUE_COUNTS.length).fill(0);
	const sliceWeight = 1 / DEPTH_SLICES;
	for (let slice = 0; slice < DEPTH_SLICES; slice += 1) {
		// Slice midpoints, so neither an undealt shoe nor an exhausted one -- where
		// the decks-remaining divisor goes to zero -- is ever evaluated.
		const seen = ((slice + 0.5) / DEPTH_SLICES) * dealtCards;
		const remaining = totalCards - seen;
		const sd =
			(CARDS_PER_DECK * tagSd * Math.sqrt(seen))
			/ Math.sqrt((totalCards - 1) * remaining);
		accumulateBuckets(sd, sliceWeight, weights, moments);
	}

	return RAMP_TRUE_COUNTS.map((trueCount, index) => ({
		trueCount,
		frequency: weights[index],
		meanTrueCount: weights[index] > 0 ? moments[index] / weights[index] : trueCount,
	}));
}

export function analyzeBankroll(
	ruleSet: RuleSet,
	tags: TagValues,
	inputs: BankrollInputs
): BankrollAnalysis {
	const frequencies = trueCountFrequencies(ruleSet, tags);

	let averageBetUnits = 0;
	let evUnitsPerRound = 0;
	let secondMoment = 0;
	frequencies.forEach(({ meanTrueCount, frequency }, index) => {
		const bet = inputs.ramp[index] ?? 0;
		// Priced at the bucket's mean count, not its label. The edge is linear in
		// the true count, so this makes the sum exact rather than approximate --
		// and a flat bet then earns precisely the count-zero edge.
		const edge =
			(inputs.baseEvPercent + inputs.edgeSlopePointsPerTrueCount * meanTrueCount) / 100;
		averageBetUnits += frequency * bet;
		evUnitsPerRound += frequency * bet * edge;
		// The round's own variance scales with the square of the bet; the spread of
		// the bet across counts adds its own term, hence the second moment rather
		// than a bet-weighted average of `variancePerRound`.
		secondMoment += frequency * bet * bet * (inputs.variancePerRound + edge * edge);
	});

	const varianceUnitsPerRound = Math.max(
		0,
		secondMoment - evUnitsPerRound * evUnitsPerRound
	);

	const bankrollUnits = inputs.unit > 0 ? inputs.bankroll / inputs.unit : 0;
	const positiveEdge = evUnitsPerRound > 0 && varianceUnitsPerRound > 0;

	return {
		// Per unit wagered, not per round: dividing the round's EV by the round's
		// average bet is what makes this a weighted mean of the per-count edges,
		// under weights of frequency times bet.
		edgePercent: averageBetUnits > 0 ? (evUnitsPerRound / averageBetUnits) * 100 : 0,
		averageBetUnits,
		evUnitsPerRound,
		varianceUnitsPerRound,
		winRatePerHour: evUnitsPerRound * inputs.roundsPerHour * inputs.unit,
		sdPerHour: Math.sqrt(inputs.roundsPerHour * varianceUnitsPerRound) * inputs.unit,
		n0Rounds:
			positiveEdge ?
				varianceUnitsPerRound / (evUnitsPerRound * evUnitsPerRound)
			:	Infinity,
		kellyUnit:
			varianceUnitsPerRound > 0 ?
				(inputs.bankroll * evUnitsPerRound) / varianceUnitsPerRound
			:	0,
		// A game with no edge is lost eventually with certainty, however deep the
		// bankroll -- the exponential below only describes a winning one.
		riskOfRuin:
			positiveEdge ?
				Math.min(
					1,
					Math.exp((-2 * bankrollUnits * evUnitsPerRound) / varianceUnitsPerRound)
				)
			:	1,
		frequencies,
	};
}
