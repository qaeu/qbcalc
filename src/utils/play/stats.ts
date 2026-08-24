/**
 * Lifetime training statistics: what the player actually won, what the hands
 * they played were worth, and what their mistakes cost. Every figure is an
 * accumulator folded one decision or one round at a time, so the whole record is
 * a plain object the storage layer can write out. See docs/play-model.md
 * §What the stats measure.
 */

import type { Grading } from './coach';

export interface PlayStats {
	/** Actual money won or lost, in the sidebar's currency. */
	av: number;
	/** Sum of bet x EV of the action actually chosen. */
	ev: number;
	hands: number;
	rounds: number;
	decisions: number;
	optimalDecisions: number;
	basicErrors: number;
	deviationErrors: number;
	/** Money of EV given up to misplays, positive. */
	evLost: number;
	/**
	 * Running variance of the money on each graded decision, in currency².
	 * Summed as if decisions were independent -- the same simplification `ev`
	 * already makes by folding in every decision of a hand rather than just its
	 * first. See `evDeviation`.
	 */
	variance: number;
}

export const EMPTY_PLAY_STATS: PlayStats = {
	av: 0,
	ev: 0,
	hands: 0,
	rounds: 0,
	decisions: 0,
	optimalDecisions: 0,
	basicErrors: 0,
	deviationErrors: 0,
	evLost: 0,
	variance: 0,
};

/**
 * Folds one graded decision in. `wager` is the money on the hand, which is what
 * turns the grid's percentages into the currency the rest of the record is in.
 */
export function recordDecision(
	stats: PlayStats,
	grading: Grading,
	wager: number
): PlayStats {
	// The best play available at this shoe, which is the count-adjusted one --
	// a correctly taken deviation is an optimal decision even though it departs
	// from basic strategy. See docs/play-model.md §What the stats measure.
	const optimal = grading.chosen === grading.countAction;
	// `chosenSecondMoment` is E[X²] per unit wagered; Var(money) = wager² x
	// (E[X²] - E[X]²) for this one decision, and the record sums those as if
	// every graded decision were independent -- see `PlayStats.variance`.
	const chosenEvFraction = grading.chosenEvPercent / 100;
	const decisionVariance =
		wager * wager * (grading.chosenSecondMoment - chosenEvFraction * chosenEvFraction);
	return {
		...stats,
		// The EV of the hand *as actually played*, so a misplay lands in `evLost`
		// below rather than quietly widening the gap `evDeviation` is meant to read.
		ev: stats.ev + (wager * grading.chosenEvPercent) / 100,
		decisions: stats.decisions + 1,
		optimalDecisions: stats.optimalDecisions + (optimal ? 1 : 0),
		basicErrors: stats.basicErrors + (grading.basicError ? 1 : 0),
		deviationErrors: stats.deviationErrors + (grading.deviationError ? 1 : 0),
		// `evLostPercent` is zero or negative; the record keeps the loss positive.
		evLost: stats.evLost - (wager * grading.evLostPercent) / 100,
		variance: stats.variance + decisionVariance,
	};
}

/** Folds a settled round in: its net money and its hand count. */
export function recordRound(stats: PlayStats, net: number, hands: number): PlayStats {
	return {
		...stats,
		av: stats.av + net,
		rounds: stats.rounds + 1,
		hands: stats.hands + hands,
	};
}

/** optimalDecisions / decisions x 100, or null when no decisions yet. */
export function optimalPlayPercent(stats: PlayStats): number | null {
	if (stats.decisions === 0) return null;
	return (stats.optimalDecisions / stats.decisions) * 100;
}

/**
 * `(av - ev) / sigma`: how far the money actually won sits from what the hands
 * played were worth, in standard deviations. Null before the first graded
 * decision, since `sigma` is zero and the ratio has nothing to divide by.
 */
export function evDeviation(stats: PlayStats): number | null {
	if (stats.variance <= 0) return null;
	return (stats.av - stats.ev) / Math.sqrt(stats.variance);
}
