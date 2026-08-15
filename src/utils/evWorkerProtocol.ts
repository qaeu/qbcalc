/**
 * Message protocol shared between `blackjackEv.worker.ts` (the real Worker,
 * used in the browser) and the `Worker` stub tests install in
 * `setupTests.ts` (jsdom has no Worker implementation, so tests run this
 * same request/response logic synchronously instead of on a real thread).
 */

import {
	applyCountToComposition,
	baseComposition,
	type TagValues,
} from './ev/composition';
import { computeEvGrids, type EvGrids } from './ev/engine';
import { analyzeInsurance } from './ev/insurance';
import { ruleSetKey, type RuleSet } from './ev/rules';
import { combineEvTables, type EvTables } from './ev/tables';

export interface EvWorkerRequest {
	/**
	 * Echoed back on the response. A Worker is a shared message bus, not a
	 * per-call promise -- every listener sees every message -- so the caller
	 * needs this to tell a response for the latest request apart from one for
	 * a superseded request that just hadn't finished yet.
	 */
	requestId: number;
	ruleSet: RuleSet;
	count: number;
	/** The counting system's per-rank point values the count was kept with. */
	tags: TagValues;
}

export type EvWorkerResult = EvTables;

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

export function computeEvWorkerResponse(request: EvWorkerRequest): EvWorkerResponse {
	try {
		const { ruleSet, count, tags } = request;
		const base = baseComposition(ruleSet);
		// Before the base grids are cached, so a count this shoe cannot
		// represent still throws rather than banking work for a doomed request.
		const modified = applyCountToComposition(base, tags, count);
		const baseGrids = baseGridsFor(ruleSet);
		// A count that leaves the shoe untouched -- zero, or one too small to
		// move a whole half-card -- is the baseline, already computed.
		const unchanged = modified.every((halfCards, index) => halfCards === base[index]);
		return {
			requestId: request.requestId,
			status: 'success',
			result: combineEvTables(
				baseGrids,
				unchanged ? baseGrids : computeEvGrids(ruleSet, modified),
				analyzeInsurance(ruleSet, base, modified)
			),
		};
	} catch (err) {
		return {
			requestId: request.requestId,
			status: 'error',
			message: err instanceof Error ? err.message : String(err),
		};
	}
}
