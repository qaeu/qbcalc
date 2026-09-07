/**
 * The harness behind `attribution.test.ts`: run builders for the arms the
 * experiment contrasts, the shoe-snapshot-to-composition helper Phase B prices
 * against, and the aggregator that turns a stream of `SimRoundRecord`s into a
 * decomposition of a run's AV-over-EV gap.
 *
 * Deliberately not a `.test.ts`, so `npm test` never runs any of it: the
 * measurements here cost minutes and are read by hand. See docs/sim-model.md
 * §Against the bankroll model for what they found.
 */

import { hiLoCountScale } from '#utils/bankroll';
import { HI_LO_TAGS } from '#utils/countingSystems';
import { CARD_UNITS, RANKS, RANK_INDEX, type Rank } from '#utils/ev/cards';
import { baseComposition, type Composition, type TagValues } from '#utils/ev/composition';
import { bestAction } from '#utils/ev/outcome';
import { pairPlayGrids, playGridsFor } from '#utils/ev/playGrids';
import { DEFAULT_RULE_SET, type PlayerAction, type RuleSet } from '#utils/ev/rules';
import { cellAddressFor, gradeDecision } from '#utils/play/coach';
import { legalActions, startRound, type GameState } from '#utils/play/game';
import { restoreShoe, type DealtShoe } from '#utils/play/shoe';
import { DEFAULT_SIM_CONFIG, type SimConfig } from '#utils/sim/config';
import { decideAction } from '#utils/sim/policy';
import { summarizeRun, type SimResult } from '#utils/sim/result';
import {
	createRun,
	isDone,
	runChunk,
	type SimInputs,
	type SimRoundRecord,
	type SimRun,
} from '#utils/sim/run';

/** A tag vector that tells no rank from another: every round is priced at zero. */
export const ZERO_TAGS = Object.fromEntries(RANKS.map((rank) => [rank, 0])) as TagValues;

export const FLAT_RAMP = [1, 1, 1, 1, 1, 1, 1];

/**
 * The seed set every arm is run over, so contrasts between arms are paired: the
 * same shuffle streams, differing only in what the arm changes.
 */
export const SEEDS: readonly number[] = [
	101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117,
	118, 119, 120,
];

/** What one arm changes about the game and the shoe it is dealt from. */
export interface Arm {
	name: string;
	tags: TagValues;
	/** Where the cut card goes. Three percent reshuffles roughly every round. */
	penetrationPercent: number;
	/** What the arm is meant to isolate, for the report. */
	isolates: string;
}

/**
 * The three arms of the frame decomposition. `control` makes the priced
 * composition equal the dealt one -- a blind count prices every round off the
 * base composition, and a cut card three percent in means a round is always
 * dealt from a shoe within a few cards of a full one -- so its gap is the
 * calibration zero. Anything the other two show above it is the frame.
 */
export const ARMS: readonly Arm[] = [
	{
		name: 'control',
		tags: ZERO_TAGS,
		penetrationPercent: 3,
		isolates: 'nothing -- the calibration zero',
	},
	{
		name: 'depletion',
		tags: ZERO_TAGS,
		penetrationPercent: 75,
		isolates: 'dealing from a depleted shoe priced at the full one',
	},
	{
		name: 'count map',
		tags: HI_LO_TAGS,
		penetrationPercent: 75,
		isolates: 'what applyTrueCountToComposition adds on top',
	},
];

/**
 * A run under one arm: flat bet, no neighbours, no cut-card jitter, and the
 * engine's own index played at every cell, so the only thing left to disagree
 * about is the composition a round was priced off.
 */
export function armInputs(
	arm: Arm,
	seed: number,
	rounds: number,
	overrides: Partial<SimInputs> = {}
): SimInputs {
	const ruleSet: RuleSet = {
		...DEFAULT_RULE_SET,
		penetrationPercent: arm.penetrationPercent,
		// Peeking takes the no-peek convention out of the picture entirely, so a
		// gap measured here cannot be about how a dealer natural is charged.
		dealerPeek: true,
	};
	const sim: SimConfig = {
		...DEFAULT_SIM_CONFIG,
		rounds,
		seed,
		deviations: 'full',
		cutCardVarianceDecks: 0,
		otherSpots: 0,
		reseedEachRun: false,
	};
	return {
		ruleSet,
		tags: arm.tags,
		sim,
		ramp: FLAT_RAMP,
		unit: 1,
		roundsPerHour: 80,
		precision: 'fast',
		...overrides,
	};
}

/** A whole run, stepped the way the worker steps it. */
export function play(inputs: SimInputs, chunk = 10_000): SimResult {
	const run = createRun(inputs);
	while (!isDone(run)) runChunk(run, chunk);
	return summarizeRun(run);
}

/** What a run, or a set of them, says about the gap -- all in points of edge. */
export interface GapReading {
	rounds: number;
	/** `edgePercent - evEdgePercent`: what the money did over what it was worth. */
	gapPoints: number;
	/** One standard error on that figure, off the rounds' own spread. */
	standardErrorPoints: number;
	edgePercent: number;
	evEdgePercent: number;
}

/**
 * Accumulates the gap and its standard error from the rounds themselves, so a
 * flat arm and a spread one are not handed the same band.
 */
function gapAccumulator(): {
	add: (record: SimRoundRecord) => void;
	read: () => GapReading;
} {
	let av = 0;
	let ev = 0;
	let wagered = 0;
	let rounds = 0;
	let residualSquares = 0;

	return {
		add(record) {
			const priced = (record.evPercent / 100) * record.bet;
			const residual = record.net - priced;
			av += record.net;
			ev += priced;
			wagered += record.bet;
			rounds += 1;
			residualSquares += residual * residual;
		},
		read() {
			if (wagered <= 0 || rounds < 2) {
				return {
					rounds,
					gapPoints: 0,
					standardErrorPoints: 0,
					edgePercent: 0,
					evEdgePercent: 0,
				};
			}
			const residualSum = av - ev;
			const variance = Math.max(
				0,
				(residualSquares - (residualSum * residualSum) / rounds) / (rounds - 1)
			);
			return {
				rounds,
				gapPoints: (residualSum / wagered) * 100,
				// The sum of `rounds` independent residuals, over the money staked.
				standardErrorPoints: (Math.sqrt(variance * rounds) / wagered) * 100,
				edgePercent: (av / wagered) * 100,
				evEdgePercent: (ev / wagered) * 100,
			};
		},
	};
}

/**
 * One arm over the whole seed set, pooled. Pooling the rounds rather than
 * averaging the seeds' gaps weights each seed by what it staked, which makes the
 * figure the same quantity one long run would report.
 *
 * `attribute`, where given, is handed every round too, so an arm can be measured
 * and decomposed in the same pass.
 */
export function measureArm(
	arm: Arm,
	roundsPerSeed: number,
	attribute?: (record: SimRoundRecord) => void
): GapReading {
	const gap = gapAccumulator();
	for (const seed of SEEDS) {
		play(
			armInputs(arm, seed, roundsPerSeed, {
				observe: (record) => {
					gap.add(record);
					attribute?.(record);
				},
			})
		);
	}
	return gap.read();
}

// -- Phase B: the frame error, measured on predictions rather than outcomes ---

/**
 * What a shoe still holds, in the half-card units the engine's compositions are
 * written in. `DealtShoe` has no composition accessor -- nothing in the app
 * needs one -- so it is tallied off the snapshot's undealt tail. Taken before
 * `startRound`, which is the frame `run.ts` prices in, there is no hole card
 * outstanding to account for.
 */
export function remainingComposition(shoe: DealtShoe): Composition {
	const { cards, dealt } = shoe.snapshot();
	const comp = new Array<number>(RANKS.length).fill(0);
	for (let index = dealt; index < cards.length; index += 1) {
		comp[RANK_INDEX[cards[index]]] += CARD_UNITS;
	}
	return comp;
}

/** A composition with these cards taken out of it, in half-card units. */
function withoutCards(comp: Composition, cards: readonly Rank[]): Composition {
	const out = [...comp];
	for (const card of cards) out[RANK_INDEX[card]] -= CARD_UNITS;
	return out;
}

/** One round's opening decision, priced in each frame. */
export interface FramePrediction {
	cell: string;
	action: PlayerAction;
	/** What the grids the sim played off said the chosen action was worth. */
	pricedPercent: number;
	/** And what the shoe actually in front of the player said. */
	actualPercent: number;
	/**
	 * And what it said once the player's own two cards were taken out of it --
	 * which the dealt game has done and the grids never do, being indexed by
	 * total (docs/ev-model.md §Simplifications (1)).
	 */
	ownCardsPercent: number;
	/** Whether the actual shoe would have picked a different action. */
	disagreed: boolean;
	trueCount: number;
}

export interface FrameReading {
	rounds: number;
	/**
	 * The mean of `actual - priced`, in points of edge. **This is** the frame
	 * error: positive means the real shoe was worth more than the frame it was
	 * priced in, which is the sign the residual gap would need.
	 */
	framePoints: number;
	/** One standard error on it -- prediction spread only, no settlement noise. */
	standardErrorPoints: number;
	/**
	 * The mean of `ownCards - actual`, in points of edge: what taking the
	 * player's two cards out of the shoe is worth on top of the frame above. A
	 * separate term from `framePoints`, and one no precision mode reaches, since
	 * a grid is indexed by total and cannot know which two cards made it.
	 */
	ownCardsPoints: number;
	ownCardsStandardErrorPoints: number;
	/** Rounds where the two frames disagreed about which action is best. */
	actionDisagreements: number;
	predictions: FramePrediction[];
}

/**
 * Drives a run one round at a time and, every `sampleEvery` rounds, prices the
 * opening decision twice: off the count-derived grids the sim used, and off
 * grids built from the shoe's actual remaining composition. Comparing
 * *predictions* rather than outcomes carries no settlement variance at all, so
 * thousands of rounds settle what tens of millions of dealt ones would be
 * needed for.
 *
 * The rounds in between are still dealt, so the shoe walks exactly as it would
 * in a full run and the sample is spread over every depth.
 */
export function measureFrame(
	inputs: SimInputs,
	sampleSize: number,
	sampleEvery: number
): FrameReading {
	const run = createRun(inputs);
	const scale = hiLoCountScale(baseComposition(inputs.ruleSet), inputs.tags);
	const predictions: FramePrediction[] = [];
	let step = 0;

	while (!isDone(run) && predictions.length < sampleSize) {
		if (step % sampleEvery === 0) {
			const prediction = priceBothWays(run, scale);
			if (prediction !== null) predictions.push(prediction);
		}
		runChunk(run, 1);
		step += 1;
	}

	const frame = meanAndError(
		predictions.map((one) => one.actualPercent - one.pricedPercent)
	);
	const ownCards = meanAndError(
		predictions.map((one) => one.ownCardsPercent - one.actualPercent)
	);

	return {
		rounds: predictions.length,
		framePoints: frame.mean,
		standardErrorPoints: frame.standardError,
		ownCardsPoints: ownCards.mean,
		ownCardsStandardErrorPoints: ownCards.standardError,
		actionDisagreements: predictions.filter((one) => one.disagreed).length,
		predictions,
	};
}

function meanAndError(values: readonly number[]): {
	mean: number;
	standardError: number;
} {
	const n = values.length;
	if (n === 0) return { mean: 0, standardError: 0 };
	const mean = values.reduce((sum, value) => sum + value, 0) / n;
	if (n < 2) return { mean, standardError: 0 };
	const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
	return { mean, standardError: Math.sqrt(variance / n) };
}

/**
 * Prices the round the run is about to deal, twice over, without disturbing it:
 * the hand is dealt onto a *restored copy* of the shoe, so the run deals the
 * identical round on its next `runChunk`.
 *
 * Returns null where there is no opening decision to price -- a shuffle due, a
 * natural either side, an insurance offer, or a hand outside the grids.
 */
function priceBothWays(run: SimRun, scale: number): FramePrediction | null {
	const shoe = run.game.shoe;
	if (shoe.needsShuffle()) return null;

	const trueCount = shoe.trueCount();
	const hiLo = scale > 0 ? trueCount / scale : 0;
	const pricedGrids = run.strategy.gridsFor(trueCount);
	const actualComp = remainingComposition(shoe);

	const scratch = scratchRound(run);
	if (scratch === null) return null;
	const legal = legalActions(scratch);
	if (legal.length === 0) return null;

	const address = cellAddressFor(scratch, legal);
	const action = decideAction(
		scratch,
		legal,
		pricedGrids,
		run.inputs.sim.deviations,
		hiLo
	);
	const priced = gradeDecision(scratch, action, pricedGrids, trueCount);
	if (priced === null) return null;

	// The actual shoe paired with itself: both halves of the cell are the same
	// composition, since there is no count frame here to hold the other one.
	const raw = playGridsFor(run.inputs.ruleSet, actualComp, run.inputs.precision);
	const actualGrids = pairPlayGrids(raw, raw);
	const actual = gradeDecision(scratch, action, actualGrids, 0);
	if (actual === null) return null;

	// The same shoe again, less the two cards the player is holding. The engine
	// takes the dealer's upcard out for itself, so the only removal missing from
	// the frame above is the player's own -- which is what this isolates.
	const ownComp = withoutCards(actualComp, scratch.hands[0].cards);
	const ownRaw = playGridsFor(run.inputs.ruleSet, ownComp, run.inputs.precision);
	const ownCards = gradeDecision(scratch, action, pairPlayGrids(ownRaw, ownRaw), 0);
	if (ownCards === null) return null;

	const actualCell = actualGrids[address.grid].get(address.key);
	const best =
		actualCell === undefined ? undefined : (
			bestAction(actualCell.actions.filter((one) => legal.includes(one.action)))
		);

	return {
		cell: `${address.grid}:${address.key}`,
		action,
		pricedPercent: priced.chosenEvPercent,
		actualPercent: actual.chosenEvPercent,
		ownCardsPercent: ownCards.chosenEvPercent,
		disagreed: best !== undefined && best.action !== action,
		trueCount,
	};
}

/**
 * The round the run is about to deal, dealt onto a restored shoe instead. Null
 * where nobody gets to act: a natural either side ends the round at the deal,
 * and an insurance offer is a decision the grids do not price.
 */
function scratchRound(run: SimRun): GameState | null {
	const replay = restoreShoe(run.inputs.tags, run.game.shoe.snapshot());
	const state = startRound({ ...run.game, phase: 'settled', shoe: replay }, 1);
	return state.phase === 'act' ? state : null;
}

// -- Phase C: per-cell attribution -------------------------------------------

/** One `(cell, openingAction)` pair's share of the run's gap. */
export interface CellAttribution {
	cell: string;
	action: string;
	n: number;
	/** Mean `net/bet` over the rounds in this pair, in points. */
	meanPercent: number;
	/** And what those rounds were priced at, in the same units. */
	pricedPercent: number;
	/** `(mean - priced) * sqrt(n) / sd` -- how many SEs the pair sits off by. */
	z: number;
	/**
	 * `n * (mean - priced) / N`, in points of edge. These sum to the whole run's
	 * gap, so the ranked table is an exact decomposition rather than a set of
	 * loose readings.
	 */
	contributionPoints: number;
}

interface CellTally {
	n: number;
	sum: number;
	sumSquares: number;
	pricedSum: number;
}

export interface Attributor {
	observe: (record: SimRoundRecord) => void;
	/** Every pair, ranked by the size of its contribution. */
	rank: () => CellAttribution[];
	rounds: () => number;
}

/**
 * Collects records into `(cell, action)` pairs as a run deals them. Everything
 * it buckets on is known *before* the cards fall -- the cell, the action, the
 * count and the bet. Bucketing on the outcome instead produces buckets whose
 * only meaningful content is their sum, because a no-peek cell is priced
 * unconditionally; see docs/sim-model.md §Against the bankroll model.
 */
export function createAttributor(): Attributor {
	const tallies = new Map<string, CellTally>();
	let rounds = 0;

	return {
		observe(record) {
			const key = `${record.cell}|${record.openingAction ?? '-'}`;
			let tally = tallies.get(key);
			if (tally === undefined) {
				tally = { n: 0, sum: 0, sumSquares: 0, pricedSum: 0 };
				tallies.set(key, tally);
			}
			const result = (record.net / record.bet) * 100;
			tally.n += 1;
			tally.sum += result;
			tally.sumSquares += result * result;
			tally.pricedSum += record.evPercent;
			rounds += 1;
		},
		rank() {
			const out: CellAttribution[] = [];
			for (const [key, tally] of tallies) {
				const [cell, action] = key.split('|');
				const mean = tally.sum / tally.n;
				const priced = tally.pricedSum / tally.n;
				const variance =
					tally.n < 2 ?
						0
					:	Math.max(
							0,
							(tally.sumSquares - (tally.sum * tally.sum) / tally.n) / (tally.n - 1)
						);
				const sd = Math.sqrt(variance);
				out.push({
					cell,
					action,
					n: tally.n,
					meanPercent: mean,
					pricedPercent: priced,
					z: sd > 0 ? ((mean - priced) * Math.sqrt(tally.n)) / sd : 0,
					contributionPoints: (tally.n * (mean - priced)) / rounds,
				});
			}
			return out.sort(
				(a, b) => Math.abs(b.contributionPoints) - Math.abs(a.contributionPoints)
			);
		},
		rounds: () => rounds,
	};
}

/**
 * How many rounds a pair needs before it can resolve a one-point cell error on
 * its own. A settled round has a spread of about 115 points of the wager, so
 * anything thinner than this is noise and the report says so rather than
 * inviting the top of the table to be over-read.
 */
export const RESOLVABLE_ROUNDS = 13_000;

// -- Reporting ---------------------------------------------------------------

function column(value: number, places = 3): string {
	return value.toFixed(places).padStart(places + 5);
}

export function formatArmTable(
	readings: readonly { arm: Arm; gap: GapReading }[]
): string {
	const lines = [
		'arm         tags   pen    rounds       AV%       EV%       gap    ±1SE',
	];
	for (const { arm, gap } of readings) {
		lines.push(
			[
				arm.name.padEnd(11),
				(arm.tags === HI_LO_TAGS ? 'Hi-Lo' : 'null').padEnd(6),
				`${arm.penetrationPercent}%`.padStart(4),
				String(gap.rounds).padStart(9),
				column(gap.edgePercent),
				column(gap.evEdgePercent),
				column(gap.gapPoints),
				column(gap.standardErrorPoints),
				`   ${arm.isolates}`,
			].join(' ')
		);
	}
	return lines.join('\n');
}

export function formatAttribution(rows: readonly CellAttribution[], top: number): string {
	const lines = [
		'cell             act        n      mean%    priced%          z    contrib  resolves',
	];
	for (const row of rows.slice(0, top)) {
		lines.push(
			[
				row.cell.padEnd(16),
				row.action.padEnd(3),
				String(row.n).padStart(8),
				column(row.meanPercent, 2),
				column(row.pricedPercent, 2),
				column(row.z, 2),
				column(row.contributionPoints),
				row.n >= RESOLVABLE_ROUNDS ? '  yes' : '   no',
			].join(' ')
		);
	}
	return lines.join('\n');
}
