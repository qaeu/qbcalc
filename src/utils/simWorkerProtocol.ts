/**
 * Message protocol shared between `sim.worker.ts` (the real Worker, used in the
 * browser) and the `Worker` stub tests install in `setupTests.ts`, mirroring the
 * split `evWorkerProtocol.ts` makes: the types and the driver here, a thin
 * `onmessage` shell there.
 *
 * A sim is not a calculation. It runs for seconds or minutes, it has something to
 * say while it runs, and it has to be abandonable -- none of which the EV
 * worker's one-shot request/response protocol offers, which is why the sim has a
 * worker of its own. See docs/sim-model.md §The worker.
 */

import type { TagValues } from './ev/composition';
import type { PrecisionId } from './ev/precision';
import type { RuleSet } from './ev/rules';
import type { SimConfig } from './sim/config';
import { summarizeRun, type SimResult } from './sim/result';
import { createRun, isDone, runChunk, type SimRun } from './sim/run';

export interface SimWorkerRequest {
	type?: 'run';
	/** Echoed on every response, as the EV worker's is, and for the same reason. */
	requestId: number;
	ruleSet: RuleSet;
	tags: TagValues;
	sim: SimConfig;
	/** Units wagered in each `RAMP_TRUE_COUNTS` bucket. */
	ramp: readonly number[];
	unit: number;
	roundsPerHour: number;
	/**
	 * Always 'fast' today. A sim prices a handful of counts and then deals against
	 * them a million times, so the seconds-long full-precision walk would buy a
	 * third decimal place at the cost of the whole run's budget.
	 */
	precision?: PrecisionId;
}

export interface SimCancelRequest {
	type: 'cancel';
	requestId: number;
}

export type SimWorkerMessage = SimWorkerRequest | SimCancelRequest;

export type SimWorkerResponse =
	| {
			type: 'progress';
			requestId: number;
			/**
			 * 'pricing' while the loop is stalled building the grids for a count it
			 * has just reached for the first time, 'dealing' otherwise. The first run
			 * under a new game spends its opening seconds in the former.
			 */
			phase: 'pricing' | 'dealing';
			/** Rounds dealt so far, which is what the run is sized in. */
			roundsDealt: number;
			/** And how many it was asked for. */
			rounds: number;
			pricedCount: number;
	  }
	| { type: 'complete'; requestId: number; result: SimResult; elapsedMs: number }
	| { type: 'cancelled'; requestId: number }
	| { type: 'error'; requestId: number; message: string };

/**
 * Rounds a chunk plays before yielding. Small enough that a cancel lands within a
 * frame or two of being asked for, large enough that the yield itself is noise
 * beside the dealing.
 */
const CHUNK_ROUNDS = 2000;

/** Milliseconds between progress posts. Enough for a bar to move smoothly. */
const PROGRESS_INTERVAL_MS = 100;

/**
 * The run this worker is on, if any. One at a time: a second request supersedes
 * the first, which is the same "latest request wins" rule the EV worker keeps,
 * except that here the superseded run has to actually be stopped.
 */
let active: { requestId: number; cancelled: boolean } | null = null;

function isCancel(message: SimWorkerMessage): message is SimCancelRequest {
	return message.type === 'cancel';
}

/**
 * Drives one message. Runs the sim in chunks on zero-delay timeouts, so the
 * worker drains its own queue between them and a cancel arriving mid-run is seen
 * rather than waited out.
 */
export function handleSimWorkerMessage(
	message: SimWorkerMessage,
	post: (response: SimWorkerResponse) => void
): void {
	if (isCancel(message)) {
		if (active?.requestId === message.requestId) active.cancelled = true;
		return;
	}

	const request = message;
	const token = { requestId: request.requestId, cancelled: false };
	active = token;

	let run: SimRun;
	try {
		run = createRun({
			ruleSet: request.ruleSet,
			tags: request.tags,
			sim: request.sim,
			ramp: request.ramp,
			unit: request.unit,
			roundsPerHour: request.roundsPerHour,
			precision: request.precision ?? 'fast',
		});
	} catch (err) {
		active = null;
		post({
			type: 'error',
			requestId: request.requestId,
			message: err instanceof Error ? err.message : String(err),
		});
		return;
	}

	const started = Date.now();
	let lastProgress = 0;
	let lastPriced = run.strategy.pricedCount();

	const progress = (phase: 'pricing' | 'dealing') => {
		lastProgress = Date.now();
		post({
			type: 'progress',
			requestId: token.requestId,
			phase,
			roundsDealt: run.roundsSeen,
			rounds: request.sim.rounds,
			pricedCount: run.strategy.pricedCount(),
		});
	};

	// Before the first chunk, because the first chunk is where the counts get
	// priced: without this the bar would sit empty and silent through the one
	// part of the run that has a reason to be slow.
	progress('pricing');

	const step = () => {
		// A superseded run stops where it stands: `active` has already moved on, and
		// nothing it could post would still be wanted.
		if (active !== token) return;
		if (token.cancelled) {
			active = null;
			post({ type: 'cancelled', requestId: token.requestId });
			return;
		}

		try {
			runChunk(run, CHUNK_ROUNDS);
		} catch (err) {
			active = null;
			post({
				type: 'error',
				requestId: token.requestId,
				message: err instanceof Error ? err.message : String(err),
			});
			return;
		}

		if (isDone(run)) {
			active = null;
			post({
				type: 'complete',
				requestId: token.requestId,
				result: summarizeRun(run),
				elapsedMs: Date.now() - started,
			});
			return;
		}

		const priced = run.strategy.pricedCount();
		// A chunk that had to price a count spent nearly all of itself doing so,
		// and says which of the two it was on the way out.
		if (priced !== lastPriced || Date.now() - lastProgress >= PROGRESS_INTERVAL_MS) {
			progress(priced === lastPriced ? 'dealing' : 'pricing');
			lastPriced = priced;
		}
		setTimeout(step, 0);
	};

	setTimeout(step, 0);
}
