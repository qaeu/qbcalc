import { describe, it, expect } from 'vitest';

import { HI_LO_TAGS } from '#utils/countingSystems';
import { DEFAULT_RULE_SET } from '#utils/ev/rules';
import { DEFAULT_SIM_CONFIG, type SimConfig } from '#utils/sim/config';
import {
	handleSimWorkerMessage,
	type SimWorkerRequest,
	type SimWorkerResponse,
} from '#utils/simWorkerProtocol';

function request(sim: Partial<SimConfig>, requestId = 1): SimWorkerRequest {
	return {
		requestId,
		ruleSet: DEFAULT_RULE_SET,
		tags: HI_LO_TAGS,
		sim: { ...DEFAULT_SIM_CONFIG, rounds: 1_000, ...sim },
		ramp: [1, 1, 2, 3, 5, 8, 12],
		unit: 25,
		roundsPerHour: 80,
		precision: 'fast',
	};
}

/**
 * Runs a request to whatever it settles on, collecting everything posted. The
 * driver yields on zero-delay timeouts between chunks, so the run finishes over
 * several turns of the event loop rather than in one call -- which is the whole
 * point of it, and what lets `during` land a cancel mid-run.
 */
async function collect(
	message: SimWorkerRequest,
	during?: (posted: SimWorkerResponse[]) => void
): Promise<SimWorkerResponse[]> {
	const posted: SimWorkerResponse[] = [];
	handleSimWorkerMessage(message, (response) => posted.push(response));
	during?.(posted);
	const settled = (): boolean => posted.some((response) => response.type !== 'progress');
	for (let turn = 0; turn < 10_000 && !settled(); turn += 1) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	return posted;
}

describe('the sim worker protocol', () => {
	it('reports pricing before it reports dealing', async () => {
		const posted = await collect(request({ rounds: 200 }));
		expect(posted[0]).toMatchObject({ type: 'progress', phase: 'pricing' });
	});

	it('finishes with a complete carrying the result', async () => {
		const posted = await collect(request({ rounds: 500, seed: 3 }));
		const last = posted[posted.length - 1];
		expect(last.type).toBe('complete');
		if (last.type !== 'complete') throw new Error('unreachable');
		expect(last.requestId).toBe(1);
		expect(last.result.roundsSeen).toBe(500);
		expect(last.elapsedMs).toBeGreaterThanOrEqual(0);
	});

	it('echoes the request id on every message', async () => {
		const posted = await collect(request({ rounds: 200 }, 77));
		for (const response of posted) expect(response.requestId).toBe(77);
	});

	it('takes a cancel and stops without a result', async () => {
		// Big enough that the run is still going several chunks later, so the
		// cancel lands mid-flight rather than after the fact.
		const posted = await collect(request({ rounds: 400_000, seed: 5 }), () =>
			handleSimWorkerMessage({ type: 'cancel', requestId: 1 }, () => {})
		);
		const last = posted[posted.length - 1];
		expect(last.type).toBe('cancelled');
		expect(posted.some((response) => response.type === 'complete')).toBe(false);
	});

	it('ignores a cancel for a run it is not on', async () => {
		const posted = await collect(request({ rounds: 300, seed: 8 }), () =>
			handleSimWorkerMessage({ type: 'cancel', requestId: 999 }, () => {})
		);
		expect(posted[posted.length - 1].type).toBe('complete');
	});

	it('abandons a superseded run for the newer one', async () => {
		const first: SimWorkerResponse[] = [];
		handleSimWorkerMessage(request({ rounds: 400_000, seed: 1 }, 1), (response) =>
			first.push(response)
		);
		const posted = await collect(request({ rounds: 300, seed: 2 }, 2));
		expect(posted[posted.length - 1]).toMatchObject({ type: 'complete', requestId: 2 });
		// The abandoned run posts nothing past the opening progress it had already
		// sent before the second request arrived.
		expect(first.every((response) => response.type === 'progress')).toBe(true);
	});

	it('reports an error rather than throwing out of the worker', async () => {
		const broken = request({ rounds: 100 });
		const posted = await collect({
			...broken,
			// A rule set with no cards in it: the shoe cannot be built, and the
			// failure has to come back as a message rather than as a dead worker.
			ruleSet: { ...broken.ruleSet, decks: 0 },
		});
		expect(posted[posted.length - 1].type).toBe('error');
	});
});
