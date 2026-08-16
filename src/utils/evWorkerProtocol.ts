/**
 * Message protocol shared between `blackjackEv.worker.ts` (the real Worker,
 * used in the browser) and the `Worker` stub tests install in
 * `setupTests.ts` (jsdom has no Worker implementation, so tests run this
 * same request/response logic synchronously instead of on a real thread).
 */

import {
	applyTrueCountToComposition,
	baseComposition,
	type Composition,
	type TagValues,
} from './ev/composition';
import { computeEvGrids, type EvGrids } from './ev/engine';
import { analyzeInsurance } from './ev/insurance';
import { ruleSetKey, type RuleSet } from './ev/rules';
import { averageEvPercent, combineEvTables, type EvTables } from './ev/tables';

export interface EvWorkerRequest {
	/**
	 * Echoed back on the response. A Worker is a shared message bus, not a
	 * per-call promise -- every listener sees every message -- so the caller
	 * needs this to tell a response for the latest request apart from one for
	 * a superseded request that just hadn't finished yet.
	 */
	requestId: number;
	ruleSet: RuleSet;
	trueCount: number;
	/** The counting system's per-rank point values the count was kept with. */
	tags: TagValues;
}

export interface EvWorkerResult extends EvTables {
	/**
	 * How many percentage points of player edge one unit of true count is worth,
	 * from a straight line through the baseline and one count-adjusted shoe. Bet
	 * sizing needs the edge at counts other than the one on screen, and a line is
	 * what this app is willing to spend on that -- see docs/bankroll-model.md
	 * §The edge line.
	 */
	edgeSlopePointsPerTrueCount: number;
}

export type EvWorkerResponse =
	| { requestId: number; status: 'success'; result: EvWorkerResult }
	| { requestId: number; status: 'error'; message: string };

/**
 * The unadjusted shoe's grids for the rule set most recently asked about.
 *
 * Half of every request is the full-shoe baseline the count is measured
 * against, and that half moves only when the rules do -- so a worker that
 * keeps the last one answers a count change for the price of one composition
 * instead of two. One entry is enough: the count is what a user sweeps
 * through, the rules are what they change occasionally.
 */
let cachedBaseGrids: { key: string; grids: EvGrids } | null = null;

function baseGridsFor(ruleSet: RuleSet): EvGrids {
	const key = ruleSetKey(ruleSet);
	if (cachedBaseGrids?.key === key) return cachedBaseGrids.grids;
	const grids = computeEvGrids(ruleSet, baseComposition(ruleSet));
	cachedBaseGrids = { key, grids };
	return grids;
}

/**
 * True count the edge line is measured over when the count on screen is no use
 * for it. Far enough out that the half-card rounding in
 * `applyTrueCountToComposition` is a rounding error rather than the whole signal,
 * and well inside what any shoe can represent.
 */
const SLOPE_PROBE_TRUE_COUNT = 2;

/**
 * The smallest true count whose own delta is trusted to set the edge line. A
 * fraction of a true count moves an eight-deck shoe by a half-card or not at all,
 * and dividing that by a true count near zero magnifies the rounding into a slope
 * that is mostly noise -- so those probe instead.
 */
const MIN_SLOPE_TRUE_COUNT = 1;

/**
 * Percentage points of player edge per unit of true count.
 *
 * The grids the app asks for are already priced at a true count (the engine sizes
 * a count's removals as `tc · decks`, see `applyTrueCountToComposition`), so a
 * second shoe at a known count fixes the line directly. See
 * docs/bankroll-model.md §The edge line.
 */
function edgeSlope(
	ruleSet: RuleSet,
	base: Composition,
	tags: TagValues,
	baseGrids: EvGrids,
	countGrids: EvGrids,
	trueCount: number
): number {
	const payout = ruleSet.blackjackPayout;
	const baseEv = averageEvPercent(baseGrids.average, payout);

	if (countGrids !== baseGrids && Math.abs(trueCount) >= MIN_SLOPE_TRUE_COUNT) {
		return (averageEvPercent(countGrids.average, payout) - baseEv) / trueCount;
	}

	const probeComp = applyTrueCountToComposition(base, tags, SLOPE_PROBE_TRUE_COUNT);
	const probeEv = averageEvPercent(computeEvGrids(ruleSet, probeComp).average, payout);
	return (probeEv - baseEv) / SLOPE_PROBE_TRUE_COUNT;
}

export function computeEvWorkerResponse(request: EvWorkerRequest): EvWorkerResponse {
	try {
		const { ruleSet, trueCount, tags } = request;
		const base = baseComposition(ruleSet);
		// Before the base grids are cached, so a count this shoe cannot
		// represent still throws rather than banking work for a doomed request.
		const modified = applyTrueCountToComposition(base, tags, trueCount);
		const baseGrids = baseGridsFor(ruleSet);
		// A count that leaves the shoe untouched -- zero, or one too small to
		// move a whole half-card -- is the baseline, already computed.
		const unchanged = modified.every((halfCards, index) => halfCards === base[index]);
		const countGrids = unchanged ? baseGrids : computeEvGrids(ruleSet, modified);
		return {
			requestId: request.requestId,
			status: 'success',
			result: {
				...combineEvTables(
					ruleSet,
					baseGrids,
					countGrids,
					analyzeInsurance(ruleSet, base, modified)
				),
				edgeSlopePointsPerTrueCount: edgeSlope(
					ruleSet,
					base,
					tags,
					baseGrids,
					countGrids,
					trueCount
				),
			},
		};
	} catch (err) {
		return {
			requestId: request.requestId,
			status: 'error',
			message: err instanceof Error ? err.message : String(err),
		};
	}
}
