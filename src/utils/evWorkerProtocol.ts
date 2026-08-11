/**
 * Message protocol shared between `blackjackEv.worker.ts` (the real Worker,
 * used in the browser) and the `Worker` stub tests install in
 * `setupTests.ts` (jsdom has no Worker implementation, so tests run this
 * same request/response logic synchronously instead of on a real thread).
 */

import { computeAllEvTables, type RuleSet } from './blackjackEv';

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
}

export type EvWorkerResult = ReturnType<typeof computeAllEvTables>;

export type EvWorkerResponse =
	| { requestId: number; status: 'success'; result: EvWorkerResult }
	| { requestId: number; status: 'error'; message: string };

export function computeEvWorkerResponse(request: EvWorkerRequest): EvWorkerResponse {
	try {
		return {
			requestId: request.requestId,
			status: 'success',
			result: computeAllEvTables(request.ruleSet, request.count),
		};
	} catch (err) {
		return {
			requestId: request.requestId,
			status: 'error',
			message: err instanceof Error ? err.message : String(err),
		};
	}
}
