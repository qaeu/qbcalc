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
};

/**
 * The smallest expectation `avOverEv` will divide by. A session's EV starts at
 * zero and crosses it freely -- the house edge is a fraction of a percent of the
 * money staked -- so a ratio taken too early is a number with no information in
 * it at all, and the card says "not yet" instead.
 */
export const AV_OVER_EV_MIN_EV = 1;

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
	return {
		...stats,
		// The EV of the hand *as actually played*, so a misplay lands in `evLost`
		// below rather than quietly widening the gap AV/EV is meant to read.
		ev: stats.ev + (wager * grading.chosenEvPercent) / 100,
		decisions: stats.decisions + 1,
		optimalDecisions: stats.optimalDecisions + (optimal ? 1 : 0),
		basicErrors: stats.basicErrors + (grading.basicError ? 1 : 0),
		deviationErrors: stats.deviationErrors + (grading.deviationError ? 1 : 0),
		// `evLostPercent` is zero or negative; the record keeps the loss positive.
		evLost: stats.evLost - (wager * grading.evLostPercent) / 100,
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

/** av / ev, or null when |ev| is below `AV_OVER_EV_MIN_EV`. */
export function avOverEv(stats: PlayStats): number | null {
	if (Math.abs(stats.ev) < AV_OVER_EV_MIN_EV) return null;
	return stats.av / stats.ev;
}
