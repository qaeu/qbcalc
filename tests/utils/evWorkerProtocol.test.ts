import { describe, it, expect } from 'vitest';

import { computeEvWorkerResponse, type EvWorkerRequest } from '#utils/evWorkerProtocol';
import { DEFAULT_RULE_SET } from '#utils/ev/rules';
import { tagsForSystem } from '#utils/countingSystems';

const HI_LO = tagsForSystem('hi-lo')!;

/** Two decks rather than six: the same maths, a fraction of the enumeration. */
const RULE_SET = { ...DEFAULT_RULE_SET, decks: 2 };

function curveAt(trueCount: number, tags = HI_LO) {
	const request: EvWorkerRequest = { requestId: 1, ruleSet: RULE_SET, trueCount, tags };
	const response = computeEvWorkerResponse(request);
	if (response.status !== 'success') throw new Error(response.message);
	return response.result;
}

function slopeAt(trueCount: number, tags = HI_LO): number {
	return curveAt(trueCount, tags).edgeSlopePointsPerTrueCount;
}

describe('the edge slope', () => {
	it('is a property of the shoe and the tags, not of the count on screen', () => {
		// The line the bankroll figures are read off describes every shoe the
		// penetration reaches, so sweeping the count must not move it -- and a
		// slope measured from whichever shoe happened to be asked for did, by
		// enough half-card rounding to reorder two close counting systems.
		const zero = slopeAt(0);
		expect(slopeAt(1)).toBe(zero);
		expect(slopeAt(-3)).toBe(zero);
		expect(slopeAt(5)).toBe(zero);
	});

	it('is positive and of the size a six-deck game is worth', () => {
		// A true count is worth about half a point of edge under Hi-Lo.
		expect(slopeAt(0)).toBeGreaterThan(0.3);
		expect(slopeAt(0)).toBeLessThan(0.8);
	});

	it('bends upwards, and only slightly', () => {
		// The curve is convex: a shoe is played better the more its count says, so
		// both tails sit above the line through them. The bend is small beside the
		// slope -- a percent or two of the edge at the counts the ramp bets into --
		// but it is the counts furthest from zero that carry the money.
		const {
			edgeSlopePointsPerTrueCount: slope,
			edgeCurvaturePointsPerTrueCountSquared: curvature,
		} = curveAt(0);
		expect(curvature).toBeGreaterThan(0);
		expect(curvature).toBeLessThan(slope / 20);
	});

	it('fits the curve from the shoe and the tags alone, like the slope', () => {
		const { edgeCurvaturePointsPerTrueCountSquared: at0 } = curveAt(0);
		expect(curveAt(3).edgeCurvaturePointsPerTrueCountSquared).toBe(at0);
	});

	it('is smaller per count for a system that counts on a bigger axis', () => {
		// RPC's counts run about twice as fast, so each is worth about half as
		// much. `hiLoCountScale` is what puts the two back on one axis.
		const rpc = slopeAt(0, tagsForSystem('rpc')!);
		expect(rpc).toBeGreaterThan(0);
		expect(rpc).toBeLessThan(slopeAt(0) * 0.75);
	});
});
