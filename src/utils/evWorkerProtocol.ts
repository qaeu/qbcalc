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
import { hiLoCountScale } from './bankroll';
import { RANKS } from './ev/cards';
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
	 * How many percentage points of player edge one unit of this system's true
	 * count is worth: the linear term of the edge curve fitted symmetrically about
	 * the baseline. Bet sizing needs the edge at counts other than the one on
	 * screen -- see docs/bankroll-model.md §The edge curve.
	 */
	edgeSlopePointsPerTrueCount: number;
	/**
	 * The curve's squared term, per squared unit of the same count. Small beside
	 * the slope and positive for every real system: the edge accelerates away from
	 * the line at the counts furthest from zero, which is where a bet spread has
	 * most of its money.
	 */
	edgeCurvaturePointsPerTrueCountSquared: number;
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
 * How far either side of zero the edge curve is probed, in Hi-Lo-equivalent true
 * counts -- converted to the system's own counts through `hiLoCountScale`, so
 * that every system is fitted over the same range of *shoes* rather than the same
 * range of its own numbers. A level-two count runs on twice Hi-Lo's axis, and
 * probing it at a bare ±8 would cover half the shoe range and read a bend that
 * had not yet cleared the noise.
 *
 * Two pairs rather than one, because the two coefficients want different lever
 * arms. The half-card rounding in `applyTrueCountToComposition` puts about a
 * tenth of a point of noise on any one probe however far out it sits, so the
 * inner pair is already far enough to read a slope through it -- while the
 * curvature, which is a second difference, needs the wider pair before the bend
 * clears that same noise. Both are well inside what a shoe can represent, and the
 * inner one sits where the ramp's own buckets have their money.
 */
const EDGE_PROBE_HI_LO_COUNTS: readonly number[] = [4, 8];

/** The edge curve's two coefficients, in the system's own true counts. */
interface EdgeCurve {
	slope: number;
	curvature: number;
}

/**
 * Fits `edge(TC) = baseEv + slope·TC + curvature·TC²` by least squares over
 * shoes at `±EDGE_PROBE_TRUE_COUNTS`.
 *
 * The grids the app asks for are already priced at a true count (the engine sizes
 * a count's removals as `tc · decks`, see `applyTrueCountToComposition`), so
 * shoes at known counts fit the curve directly. The intercept is not fitted: the
 * full shoe's own EV is exact, so it is pinned and only the shape is measured.
 *
 * Probing symmetrically is what lets the fit come apart into two independent
 * one-parameter fits, since across a `±P` pair the odd half of the difference is
 * all slope and the even half all curvature. See docs/bankroll-model.md
 * §The edge curve.
 */
function fitEdgeCurve(
	ruleSet: RuleSet,
	base: Composition,
	tags: TagValues,
	baseEv: number
): EdgeCurve {
	const payout = ruleSet.blackjackPayout;
	const evAt = (trueCount: number) =>
		averageEvPercent(
			computeEvGrids(ruleSet, applyTrueCountToComposition(base, tags, trueCount)).average,
			payout
		);

	// A count that tells no rank from another has no curve to fit, and no probe
	// count to fit it at either -- every one of them is zero.
	const scale = hiLoCountScale(base, tags);
	if (scale <= 0) return { slope: 0, curvature: 0 };

	let slopeNumerator = 0;
	let slopeDenominator = 0;
	let curvatureNumerator = 0;
	let curvatureDenominator = 0;
	for (const probe of EDGE_PROBE_HI_LO_COUNTS.map((count) => count * scale)) {
		const high = evAt(probe);
		const low = evAt(-probe);
		slopeNumerator += probe * ((high - low) / 2);
		slopeDenominator += probe * probe;
		curvatureNumerator += probe * probe * ((high + low) / 2 - baseEv);
		curvatureDenominator += probe ** 4;
	}

	return {
		slope: slopeNumerator / slopeDenominator,
		curvature: curvatureNumerator / curvatureDenominator,
	};
}

/**
 * The edge curve for the rule set and tag vector most recently asked about.
 *
 * The curve describes the whole shoe, not the count on screen, so sweeping the
 * count would otherwise pay for the same four probe shoes over and over. Keyed on
 * both the rules and the tags, since either moves it. One entry, for the same
 * reason `cachedBaseGrids` keeps one.
 */
let cachedEdgeCurve: { key: string; curve: EdgeCurve } | null = null;

function edgeCurveFor(
	ruleSet: RuleSet,
	base: Composition,
	tags: TagValues,
	baseEv: number
): EdgeCurve {
	const key = `${ruleSetKey(ruleSet)}|${RANKS.map((rank) => tags[rank]).join(',')}`;
	if (cachedEdgeCurve?.key === key) return cachedEdgeCurve.curve;
	const curve = fitEdgeCurve(ruleSet, base, tags, baseEv);
	cachedEdgeCurve = { key, curve };
	return curve;
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
		const tables = combineEvTables(
			ruleSet,
			baseGrids,
			countGrids,
			analyzeInsurance(ruleSet, base, modified)
		);
		const curve = edgeCurveFor(ruleSet, base, tags, tables.average.baseEvPercent);
		return {
			requestId: request.requestId,
			status: 'success',
			result: {
				...tables,
				edgeSlopePointsPerTrueCount: curve.slope,
				edgeCurvaturePointsPerTrueCountSquared: curve.curvature,
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
