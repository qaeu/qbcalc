/**
 * What a finished run reports. Every derived figure is computed here, once, so a
 * component draws numbers rather than deriving them -- and so the arithmetic
 * behind the stat band is testable without rendering anything.
 *
 * See docs/sim-model.md §What the result reports.
 */

import { evDeviation, optimalPlayPercent, type PlayStats } from '../play/stats';
import type { SimConfig } from './config';
import type { SimBucket, SimRun, SimSample } from './run';

export interface SimResult {
	/**
	 * The decision-level record, folded by the same `stats.ts` the Play view
	 * keeps: `av`, the two error counts, `evLost` and the optimal-play share are
	 * all read from here. Its own `ev` and `variance` are not -- see `ev` below
	 * and docs/sim-model.md §Accumulating EV.
	 */
	stats: PlayStats;
	/** Expectation of the rounds as they were opened, in currency. */
	ev: number;
	/** Variance of the same, in currency². */
	variance: number;
	/** One entry per `ROUND_TRUE_COUNTS` bucket, in the same order. */
	buckets: readonly SimBucket[];
	samples: readonly SimSample[];
	/** The config the run was dealt under, so a result can be re-run from itself. */
	config: SimConfig;

	/** Rounds dealt at the table, which is what the run was sized in. */
	roundsSeen: number;
	/** Of those, the ones wagered on. */
	roundsPlayed: number;
	/**
	 * And the ones watched: not in the seat, or dealt at a count the ramp stakes
	 * nothing at. The cost of a back-counting strategy is mostly here -- the
	 * rounds are time spent at the table earning nothing.
	 */
	roundsWatched: number;
	/** `roundsWatched` as a share of the rounds dealt, in percent. */
	watchedPercent: number;
	/** Hours of the session spent watching rather than playing, at `roundsPerHour`. */
	hoursWatched: number;
	hands: number;
	shoes: number;
	/** Opening bets summed over the rounds played, in currency. */
	wagered: number;

	/**
	 * What the run actually paid, per unit wagered: `av / wagered`. The simulated
	 * answer to the question `analyzeBankroll`'s `edgePercent` answers in closed
	 * form -- and the noisier of the two by far, since it is one sample of a walk
	 * rather than an expectation.
	 */
	edgePercent: number;
	/**
	 * What the hands played were *worth* per unit wagered: `ev / wagered`. This is
	 * the figure that should agree with the Bankroll card's, and it converges far
	 * faster than `edgePercent` does. See docs/sim-model.md §Against the bankroll model.
	 */
	evEdgePercent: number;
	/** Mean opening bet over the rounds played, in currency. */
	averageBet: number;
	/** Hours at `roundsPerHour`, over the rounds *seen* -- see the doc. */
	hours: number;
	winRatePerHour: number;
	sdPerHour: number;
	/** Rounds until the expectation is one standard deviation. `Infinity` at no edge. */
	n0Rounds: number;
	/** `(av - ev) / sigma`, or null before the first graded decision. */
	evDeviationSigmas: number | null;
	/** Share of decisions taking the count-adjusted best action, or null. */
	optimalPlayPercent: number | null;
}

export function summarizeRun(run: SimRun): SimResult {
	const { stats, ev, variance, wagered, roundsPlayed, roundsSeen } = run;
	const { roundsPerHour } = run.inputs;

	const roundsWatched = roundsSeen - roundsPlayed;
	const hours = roundsPerHour > 0 ? roundsSeen / roundsPerHour : 0;
	const evPerRound = roundsPlayed > 0 ? ev / roundsPlayed : 0;
	const variancePerRound = roundsPlayed > 0 ? variance / roundsPlayed : 0;

	return {
		stats,
		ev,
		variance,
		buckets: run.buckets,
		samples: run.samples,
		config: run.inputs.sim,

		roundsSeen,
		roundsPlayed,
		roundsWatched,
		watchedPercent: roundsSeen > 0 ? (roundsWatched / roundsSeen) * 100 : 0,
		hoursWatched: roundsPerHour > 0 ? roundsWatched / roundsPerHour : 0,
		hands: stats.hands,
		shoes: run.shoes,
		wagered,

		edgePercent: wagered > 0 ? (stats.av / wagered) * 100 : 0,
		evEdgePercent: wagered > 0 ? (ev / wagered) * 100 : 0,
		averageBet: roundsPlayed > 0 ? wagered / roundsPlayed : 0,
		hours,
		winRatePerHour: hours > 0 ? stats.av / hours : 0,
		sdPerHour: hours > 0 ? Math.sqrt(Math.max(0, variance) / hours) : 0,
		// Read off the expectation rather than the money: N0 is a property of the
		// game, and a run that ran hot would otherwise report a shorter one.
		n0Rounds:
			evPerRound > 0 && variancePerRound > 0 ?
				variancePerRound / (evPerRound * evPerRound)
			:	Infinity,
		// The same arithmetic the Play view's record uses, over the sim's own
		// round-level totals: `(av - ev) / sigma`.
		evDeviationSigmas: evDeviation({ ...stats, ev, variance }),
		optimalPlayPercent: optimalPlayPercent(stats),
	};
}
