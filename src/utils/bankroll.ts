/**
 * Bet sizing and risk: how often each true count comes up, what a bet ramp wins
 * across that distribution, and what it risks. Pure and free of SolidJS, like
 * `ev/`. The method and its assumptions are in docs/bankroll-model.md.
 */

import {
	baseComposition,
	CARDS_PER_DECK,
	type Composition,
	tagSpread,
	type TagValues,
} from './ev/composition';
import type { RuleSet } from './ev/rules';
import { HI_LO_TAGS } from './countingSystems';

/**
 * The true counts the bet ramp is indexed by, in Hi-Lo-equivalent units -- see
 * `hiLoCountScale`. The first bucket catches every count at or below it and the
 * last every count at or above, so the ramp covers the whole line with a fixed
 * seven entries -- which is what keeps both the stored shape and the editor grid
 * simple.
 */
export const RAMP_TRUE_COUNTS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];

/** Column headings for the ramp, matching `RAMP_TRUE_COUNTS`' open-ended ends. */
export const RAMP_LABELS: readonly string[] = ['≤0', '+1', '+2', '+3', '+4', '+5', '≥+6'];

/**
 * Units the ramp bets at one Hi-Lo-equivalent true count: the bucket whose label
 * the count rounds to, with the two open ends catching everything past them.
 *
 * `analyzeBankroll` never needs this -- it walks the ramp's own buckets, which
 * `accumulateBuckets` has already split the distribution across on the same
 * half-unit cuts. It is for reading the spread off at a count that came from
 * somewhere else, as the weighted-EV graph's simulated buckets do.
 */
export function betAtCount(ramp: readonly number[], hiLoTrueCount: number): number {
	const index = Math.min(
		RAMP_TRUE_COUNTS.length - 1,
		Math.max(0, Math.round(hiLoTrueCount))
	);
	return ramp[index] ?? 0;
}

/** How often one true-count bucket comes up, as a fraction of rounds played. */
export interface CountFrequency {
	/** The bucket's label, read against `RAMP_TRUE_COUNTS`' open ends. */
	trueCount: number;
	frequency: number;
	/**
	 * The average Hi-Lo-equivalent true count actually seen inside the bucket,
	 * which is what the edge is priced at. It is not the label: the two end
	 * buckets are open, so the bottom one averages well below zero however it is
	 * labelled, and pricing it at its label would quietly forgive the whole
	 * negative half of the shoe.
	 */
	meanTrueCount: number;
	/**
	 * The mean *square* of the same count, which the edge curve's squared term is
	 * priced against. Always at least `meanTrueCount²`, and much more in the open
	 * end buckets, where the counts inside are spread widely about their mean.
	 */
	meanSquaredTrueCount: number;
}

/**
 * The player's edge as a quadratic in the true count, in the units the selected
 * counting system keeps it in -- the fit `evWorkerProtocol.ts` produces and the
 * one every count-averaged figure in the app is priced from. See
 * docs/bankroll-model.md §The edge curve.
 */
export interface EdgeCurve {
	/** Player edge at a true count of zero, in percent -- `average.baseEvPercent`. */
	baseEvPercent: number;
	/**
	 * Percentage points of edge per unit of true count, in the counting system's
	 * own units -- not the ramp's Hi-Lo-equivalent ones, which `hiLoCountScale`
	 * converts between.
	 */
	edgeSlopePointsPerTrueCount: number;
	/**
	 * Percentage points of edge per squared unit of the system's own true count:
	 * the edge curve's squared term. Positive for every real system -- the curve
	 * bends upwards, since a shoe is played better the more the count says about
	 * it -- and a straight line is the special case of passing zero.
	 */
	edgeCurvaturePointsPerTrueCountSquared: number;
}

/**
 * The edge, in percent, over a set of counts described by their mean and mean
 * square rather than by a single count.
 *
 * Taking each term against its own moment is what makes a bucket's edge exact
 * instead of a curve read off at an average count: the squared term over an
 * open-ended bucket, whose counts run far past their own mean, is much the
 * larger of the two readings. Both moments are in the system's own count units.
 */
export function edgeAtCount(
	curve: EdgeCurve,
	meanTrueCount: number,
	meanSquaredTrueCount: number
): number {
	return (
		curve.baseEvPercent
		+ curve.edgeSlopePointsPerTrueCount * meanTrueCount
		+ curve.edgeCurvaturePointsPerTrueCountSquared * meanSquaredTrueCount
	);
}

export interface BankrollInputs extends EdgeCurve {
	/** Total bankroll, in the same currency as `unit`. */
	bankroll: number;
	/** What one betting unit is worth. */
	unit: number;
	roundsPerHour: number;
	/** Units wagered in each `RAMP_TRUE_COUNTS` bucket. */
	ramp: readonly number[];
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
	 * it comes back to the count-zero edge plus the curve's bend over the count
	 * distribution -- the count being mean-zero leaves only that term -- and a
	 * spread is what pulls it positive, by putting more money on the counts that
	 * are worth more.
	 */
	edgePercent: number;
	/** Mean units wagered per round, i.e. the spread the ramp actually achieves. */
	averageBetUnits: number;
	/** `averageBetUnits` converted to currency, at the same unit size as `winRatePerHour`. */
	averageBetCurrency: number;
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
 * `E[X² · 1{X ≤ x}]` for the same distribution, which the edge curve's squared
 * term is priced against. Goes to `sd²` as the cut runs off to the right, the
 * whole distribution's second moment.
 */
function partialSecondMomentBelow(cut: number, sd: number): number {
	const z = cut / sd;
	return sd * sd * (normalCdf(z) - z * normalPdf(z));
}

/**
 * Splits one normal true-count distribution of the given spread across the ramp's
 * buckets, adding the probability and both count moments into `weights`,
 * `moments` and `squares`. Integer buckets take the half-open unit interval
 * around them; the two end buckets take everything past their edge.
 */
function accumulateBuckets(
	sd: number,
	weight: number,
	weights: number[],
	moments: number[],
	squares: number[]
): void {
	const last = RAMP_TRUE_COUNTS.length - 1;
	// A shoe barely dealt into cannot have moved: all of it sits at zero.
	if (sd <= 0) {
		weights[0] += weight;
		return;
	}

	let belowP = normalCdf((RAMP_TRUE_COUNTS[0] + 0.5) / sd);
	let belowE = partialExpectationBelow(RAMP_TRUE_COUNTS[0] + 0.5, sd);
	let belowS = partialSecondMomentBelow(RAMP_TRUE_COUNTS[0] + 0.5, sd);
	weights[0] += weight * belowP;
	moments[0] += weight * belowE;
	squares[0] += weight * belowS;

	for (let index = 1; index < last; index += 1) {
		const cut = RAMP_TRUE_COUNTS[index] + 0.5;
		const upperP = normalCdf(cut / sd);
		const upperE = partialExpectationBelow(cut, sd);
		const upperS = partialSecondMomentBelow(cut, sd);
		weights[index] += weight * (upperP - belowP);
		moments[index] += weight * (upperE - belowE);
		squares[index] += weight * (upperS - belowS);
		belowP = upperP;
		belowE = upperE;
		belowS = upperS;
	}

	weights[last] += weight * (1 - belowP);
	// The whole distribution has mean zero, so what is left above the last cut is
	// exactly what the cuts below it did not take -- and likewise its second
	// moment is the whole `sd²` less the part they took.
	moments[last] += weight * -belowE;
	squares[last] += weight * (sd * sd - belowS);
}

/**
 * How many of the system's own true counts one Hi-Lo true count is worth, i.e.
 * the ratio of the two tag vectors' per-card spreads.
 *
 * A true count means nothing until the tags it was kept with are named: doubling
 * every tag doubles every count without adding a scrap of information. Nothing
 * else in this file cares -- the edge slope falls as `1/tagSpread` exactly as
 * fast as the count's spread rises as `√tagSpread` -- but `RAMP_TRUE_COUNTS` is a
 * fixed set of integers, and a ramp indexed by a stretched count reaches its top
 * bets far more often for no better reason than the tags being bigger. So the
 * ramp is denominated in Hi-Lo counts and each system's own counts are converted
 * through this. See docs/bankroll-model.md §The ramp's count axis.
 *
 * Zero for a tag vector that distinguishes no rank from any other, whose count
 * carries no information to rescale.
 */
export function hiLoCountScale(comp: Composition, tags: TagValues): number {
	const spread = Math.max(0, tagSpread(comp, tags));
	return Math.sqrt(spread / tagSpread(comp, HI_LO_TAGS));
}

/**
 * How often each ramp bucket comes up over a shoe dealt to `penetrationPercent`.
 *
 * The running count after `n` of `N` cards is a sum drawn without replacement, so
 * `Var(RC) = n·σ_t²·(N−n)/(N−1)`; dividing by the `(N−n)/52` decks left gives the
 * true count's spread at that depth. Depth is then averaged uniformly over the
 * dealt portion. See docs/bankroll-model.md §How often a count comes up.
 *
 * The buckets are Hi-Lo-equivalent, so the spread is converted through
 * `hiLoCountScale` before it is bucketed -- which leaves this distribution the
 * same for every system, a function of the shoe and the penetration alone.
 */
export function trueCountFrequencies(
	ruleSet: RuleSet,
	tags: TagValues
): CountFrequency[] {
	const comp = baseComposition(ruleSet);
	const totalCards = ruleSet.decks * CARDS_PER_DECK;
	// `tagSpread` is N·σ_t² over the full shoe, centred on the system's own pivot
	// -- which is what lets an unbalanced count still be read as mean-zero.
	const scale = hiLoCountScale(comp, tags);
	const tagSd =
		scale > 0 ? Math.sqrt(Math.max(0, tagSpread(comp, tags)) / totalCards) / scale : 0;
	const dealtCards = totalCards * (ruleSet.penetrationPercent / 100);

	const weights = new Array<number>(RAMP_TRUE_COUNTS.length).fill(0);
	const moments = new Array<number>(RAMP_TRUE_COUNTS.length).fill(0);
	const squares = new Array<number>(RAMP_TRUE_COUNTS.length).fill(0);
	const sliceWeight = 1 / DEPTH_SLICES;
	for (let slice = 0; slice < DEPTH_SLICES; slice += 1) {
		// Slice midpoints, so neither an undealt shoe nor an exhausted one -- where
		// the decks-remaining divisor goes to zero -- is ever evaluated.
		const seen = ((slice + 0.5) / DEPTH_SLICES) * dealtCards;
		const remaining = totalCards - seen;
		const sd =
			(CARDS_PER_DECK * tagSd * Math.sqrt(seen))
			/ Math.sqrt((totalCards - 1) * remaining);
		accumulateBuckets(sd, sliceWeight, weights, moments, squares);
	}

	return RAMP_TRUE_COUNTS.map((trueCount, index) => ({
		trueCount,
		frequency: weights[index],
		meanTrueCount: weights[index] > 0 ? moments[index] / weights[index] : trueCount,
		meanSquaredTrueCount:
			weights[index] > 0 ? squares[index] / weights[index] : trueCount * trueCount,
	}));
}

export function analyzeBankroll(
	ruleSet: RuleSet,
	tags: TagValues,
	inputs: BankrollInputs
): BankrollAnalysis {
	const frequencies = trueCountFrequencies(ruleSet, tags);
	// The buckets are Hi-Lo-equivalent while the slope is per unit of the system's
	// own count, so the two meet here.
	const scale = hiLoCountScale(baseComposition(ruleSet), tags);

	let averageBetUnits = 0;
	let evUnitsPerRound = 0;
	let secondMoment = 0;
	frequencies.forEach(({ meanTrueCount, meanSquaredTrueCount, frequency }, index) => {
		const bet = inputs.ramp[index] ?? 0;
		// Priced at the bucket's own moments, not at its label: each term of the
		// curve is averaged over the counts the bucket actually holds, which makes
		// the sum exact rather than a curve read off at an average count. The
		// squared term is what keeps the open end buckets -- whose counts run far
		// past their own mean -- from being priced as though they all sat on it.
		const edge =
			edgeAtCount(inputs, scale * meanTrueCount, scale * scale * meanSquaredTrueCount)
			/ 100;
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
		averageBetCurrency: averageBetUnits * inputs.unit,
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
