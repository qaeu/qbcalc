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
import { computeEvGrids, ShoeEv, type AverageEvParts, type EvGrids } from './ev/engine';
import { analyzeInsurance } from './ev/insurance';
import { precisionFor, type PrecisionId } from './ev/precision';
import { ruleSetKey, type RuleSet } from './ev/rules';
import {
	averageEvPercent,
	buildAverageEv,
	combineEvTables,
	type AverageEvAnalysis,
	type EvTables,
} from './ev/tables';

export interface EvWorkerRequest {
	/**
	 * Echoed back on the response. A Worker is a shared message bus, not a
	 * per-call promise -- every listener sees every message -- so the caller
	 * needs this to tell a response for the latest request apart from one for
	 * a superseded request that just hadn't finished yet.
	 */
	requestId: number;
	/**
	 * What the caller actually needs back. 'tables' walks and returns every grid
	 * cell, for the Tables view. 'summary' skips that walk entirely and returns
	 * only the aggregate figures the Bankroll view reads -- see `EvSummaryResult`.
	 * Omitted requests behave as 'tables', which is every pre-existing caller.
	 */
	scope?: 'tables' | 'summary';
	/**
	 * How accurately to price it. 'fast' is what every ordinary recalculation
	 * asks for; 'full' is the deliberate, seconds-long run behind the sidebar's
	 * button. Omitted requests behave as 'fast'. Not a rule -- it describes the
	 * calculation, not the game -- so it stays out of `ruleSet` and is carried
	 * here instead. See docs/ev-model.md §Precision modes.
	 */
	precision?: PrecisionId;
	ruleSet: RuleSet;
	trueCount: number;
	/** The counting system's per-rank point values the count was kept with. */
	tags: TagValues;
}

/**
 * The aggregate figures the Bankroll view's cards and graph are built from --
 * everything a 'summary'-scope request returns. A strict subset of
 * `EvWorkerResult`'s fields, so a 'tables' response can stand in for one
 * wherever this type is asked for.
 */
export interface EvSummaryResult {
	average: AverageEvAnalysis;
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

export interface EvWorkerResult extends EvTables, EvSummaryResult {}

/**
 * `precision` is echoed rather than assumed: the UI labels the figures it applies
 * with the precision they were actually priced at, and a response can land after
 * the request that superseded it has changed that.
 */
export type EvWorkerResponse =
	| {
			requestId: number;
			status: 'success';
			scope: 'tables';
			precision: PrecisionId;
			result: EvWorkerResult;
	  }
	| {
			requestId: number;
			status: 'success';
			scope: 'summary';
			precision: PrecisionId;
			result: EvSummaryResult;
	  }
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

/**
 * What a cached baseline belongs to. Precision joins the rule set because the two
 * modes price the same shoe differently -- a full result served a fast cache entry
 * would be neither. Still one entry: a full run is deliberate and rare, so evicting
 * the fast baseline costs less than keeping a second cache alive for it.
 */
function baselineKey(ruleSet: RuleSet, precision: PrecisionId): string {
	return `${ruleSetKey(ruleSet)}|${precision}`;
}

function baseGridsFor(ruleSet: RuleSet, precision: PrecisionId): EvGrids {
	const key = baselineKey(ruleSet, precision);
	if (cachedBaseGrids?.key === key) return cachedBaseGrids.grids;
	const grids = computeEvGrids(
		ruleSet,
		baseComposition(ruleSet),
		precisionFor(precision)
	);
	cachedBaseGrids = { key, grids };
	return grids;
}

/**
 * The unadjusted shoe's average alone, for a 'summary'-scope request that never
 * asks for the grids `baseGridsFor` would otherwise have to walk to get it. Reuses
 * `cachedBaseGrids` when a 'tables' request has already paid for the full walk,
 * rather than paying for the composition's average twice.
 */
let cachedBaseAverage: { key: string; average: AverageEvParts } | null = null;

function baseAverageFor(
	ruleSet: RuleSet,
	base: Composition,
	precision: PrecisionId
): AverageEvParts {
	const key = baselineKey(ruleSet, precision);
	if (cachedBaseGrids?.key === key) return cachedBaseGrids.grids.average;
	if (cachedBaseAverage?.key === key) return cachedBaseAverage.average;
	const average = new ShoeEv(ruleSet, precisionFor(precision)).analyzeAverage(base);
	cachedBaseAverage = { key, average };
	return average;
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
 *
 * Each probe only ever reads `averageEvPercent`, so it prices the probe shoe's
 * average alone through `analyzeAverage` rather than walking the full grids
 * `computeEvGrids` would -- the curve is a 'summary'-scope figure and none of
 * the per-cell detail a grid walk produces is ever read back out of it.
 */
function fitEdgeCurve(
	ruleSet: RuleSet,
	base: Composition,
	tags: TagValues,
	baseEv: number,
	precision: PrecisionId
): EdgeCurve {
	const payout = ruleSet.blackjackPayout;
	// Every probe is priced at the same precision as the baseline it is fitted
	// against. The correction full mode applies is not count-stable, so a curve
	// fitted through fast probes cannot be offset onto a full baseline -- see
	// docs/bankroll-model.md §The edge curve.
	const evAt = (trueCount: number) =>
		averageEvPercent(
			new ShoeEv(ruleSet, precisionFor(precision)).analyzeAverage(
				applyTrueCountToComposition(base, tags, trueCount)
			),
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
 * the rules, the precision and the tags, since any of the three moves it. One
 * entry, for the same reason `cachedBaseGrids` keeps one.
 */
let cachedEdgeCurve: { key: string; curve: EdgeCurve } | null = null;

function edgeCurveFor(
	ruleSet: RuleSet,
	base: Composition,
	tags: TagValues,
	baseEv: number,
	precision: PrecisionId
): EdgeCurve {
	const key = `${baselineKey(ruleSet, precision)}|${RANKS.map((rank) => tags[rank]).join(',')}`;
	if (cachedEdgeCurve?.key === key) return cachedEdgeCurve.curve;
	const curve = fitEdgeCurve(ruleSet, base, tags, baseEv, precision);
	cachedEdgeCurve = { key, curve };
	return curve;
}

export function computeEvWorkerResponse(request: EvWorkerRequest): EvWorkerResponse {
	try {
		const {
			requestId,
			scope = 'tables',
			precision = 'fast',
			ruleSet,
			trueCount,
			tags,
		} = request;
		const base = baseComposition(ruleSet);
		// Before anything is cached, so a request the tags give no meaning still
		// throws rather than banking work for a doomed one.
		const modified = applyTrueCountToComposition(base, tags, trueCount);
		// A count that leaves the shoe untouched -- zero, or one too small to
		// move a whole half-card -- is the baseline, already computed.
		const unchanged = modified.every((halfCards, index) => halfCards === base[index]);

		if (scope === 'summary') {
			const baseAverage = baseAverageFor(ruleSet, base, precision);
			const countAverage =
				unchanged ? baseAverage : (
					new ShoeEv(ruleSet, precisionFor(precision)).analyzeAverage(modified)
				);
			const average = buildAverageEv(baseAverage, countAverage, ruleSet.blackjackPayout);
			const curve = edgeCurveFor(ruleSet, base, tags, average.baseEvPercent, precision);
			return {
				requestId,
				status: 'success',
				scope: 'summary',
				precision,
				result: {
					average,
					edgeSlopePointsPerTrueCount: curve.slope,
					edgeCurvaturePointsPerTrueCountSquared: curve.curvature,
				},
			};
		}

		const baseGrids = baseGridsFor(ruleSet, precision);
		const countGrids =
			unchanged ? baseGrids : computeEvGrids(ruleSet, modified, precisionFor(precision));
		const tables = combineEvTables(
			ruleSet,
			baseGrids,
			countGrids,
			analyzeInsurance(ruleSet, base, modified)
		);
		const curve = edgeCurveFor(
			ruleSet,
			base,
			tags,
			tables.average.baseEvPercent,
			precision
		);
		return {
			requestId,
			status: 'success',
			scope: 'tables',
			precision,
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
