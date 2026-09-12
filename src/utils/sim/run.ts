/**
 * The loop: a shoe, a bet off the ramp, a round driven through the same state
 * machine the Play view deals on, and a record folded one decision at a time.
 *
 * Nothing here computes an EV, prices an action or settles a hand. `game.ts` runs
 * the round, `coach.ts` grades the decision, `stats.ts` folds it, and `bankroll.ts`
 * sizes the bet -- so what the sim adds is the loop around code the rest of the
 * app is already tested on. See docs/sim-model.md.
 */

import { betAtCount, hiLoCountScale } from '../bankroll/bankroll';
import { ROUND_TRUE_COUNTS, roundCountBucket } from '../bankroll/countRounds';
import { CARD_UNITS, RANK_INDEX, type Rank } from '../ev/cards';
import { baseComposition, type Composition, type TagValues } from '../ev/composition';
import { insuranceEvPercent, insuranceTenFraction } from '../ev/insurance';
import type { PrecisionId } from '../ev/precision';
import type { PlayerAction, RuleSet } from '../ev/rules';
import { cellAddressFor, gradeDecision } from '../play/coach';
import {
	applyAction,
	blackjackPayoutValue,
	createGame,
	legalActions,
	resolveInsurance,
	settleRound,
	startRound,
	type GameState,
} from '../play/game';
import { mulberry32, type SeededRandom } from '../play/rng';
import { createShoe, type DealtShoe } from '../play/shoe';
import {
	EMPTY_PLAY_STATS,
	recordDecision,
	recordRound,
	type PlayStats,
} from '../play/stats';
import { decideAction, decideInsurance } from './policy';
import { createStrategy, type Strategy } from './strategy';
import { WONG_LIMIT, type SimConfig } from './config';

/**
 * One round as a diagnostic sees it: which cell the money went out on, what was
 * priced there, and what came back. Bucketed only on what was known *before* the
 * cards fell -- the cell, the action, the count and the bet -- because at a
 * no-peek table conditioning on the outcome splits rounds into buckets whose only
 * meaningful content is their sum. See docs/sim-model.md §The loop.
 */
export interface SimRoundRecord {
	/**
	 * Which grid the opening decision came out of, and its key -- or `natural`
	 * for a round nobody acted in, priced by `naturalEv` rather than by a cell.
	 * Every round played gets a record, so the per-cell contributions built off
	 * these sum to the whole run's gap rather than to most of it.
	 */
	cell: string;
	/** Absent on a `natural` round, where there was no decision to take. */
	openingAction?: PlayerAction;
	/**
	 * What the round was priced at, in percent of the opening bet -- the same
	 * `roundEv` the run accumulates, so `net/bet - evPercent/100` summed over the
	 * records is the run's whole AV-over-EV gap and nothing is left outside the
	 * decomposition. That is `Grading.chosenEvPercent` on almost every round; it
	 * differs only where the round was priced without a decision (a natural) or
	 * carried an insurance stake beside the main one.
	 */
	evPercent: number;
	bet: number;
	net: number;
	hiLo: number;
}

/** Everything a run is: the sim's own settings plus the game they are run against. */
export interface SimInputs {
	ruleSet: RuleSet;
	tags: TagValues;
	sim: SimConfig;
	/** Units wagered in each `RAMP_TRUE_COUNTS` bucket, off the Bankroll settings. */
	ramp: readonly number[];
	/** What one betting unit is worth, which puts the whole record in money. */
	unit: number;
	roundsPerHour: number;
	precision: PrecisionId;
	/**
	 * Diagnostic seam: called once per round the player was in, with the round as
	 * the accumulators saw it. Never set in the app -- it exists so the AV-over-EV
	 * gap can be attributed cell by cell without the attribution living in the
	 * loop. A run that does not ask for it pays one undefined check per round.
	 */
	observe?: (round: SimRoundRecord) => void;
}

/** What one `ROUND_TRUE_COUNTS` bucket saw. */
export interface SimBucket {
	trueCount: number;
	/** Rounds the shoe stood at this count, played or sat out. */
	rounds: number;
	/**
	 * Rounds actually wagered on. Zero in a bucket that was sat out -- wonged
	 * past, or bet nothing at by the ramp.
	 */
	roundsPlayed: number;
	/** Hands settled -- more than `roundsPlayed` wherever a hand was split. */
	hands: number;
	/** Money placed as the opening bet, summed over the rounds played. */
	wagered: number;
	av: number;
	ev: number;
}

/** The cumulative record at one checkpoint, for the trajectory chart. */
export interface SimSample {
	/** Rounds *dealt* by this point, which is the run's own clock. */
	rounds: number;
	av: number;
	ev: number;
	/** Standard deviation of the money staked so far, in currency. */
	sd: number;
}

/**
 * A run in progress. Mutable on purpose: the worker steps it a chunk at a time so
 * it can report progress and take a cancel between chunks, and copying an
 * accumulator a million times to keep it pure would be the whole cost of the run.
 */
export interface SimRun {
	readonly inputs: SimInputs;
	readonly strategy: Strategy;
	/** The felt, carried between chunks. The shoe inside it is the run's own. */
	game: GameState;
	/**
	 * The stream the other spots' hits are drawn from. Separate from the shoe's,
	 * so how many cards a neighbour takes can never shift which card comes next.
	 */
	readonly burnRandom: SeededRandom;
	/**
	 * The decision-level record: error counts, EV lost and optimal-play share, all
	 * folded by `stats.ts` exactly as the Play view folds them.
	 *
	 * Its own `ev` and `variance` fields are **not** what the sim reports. That
	 * record sums a hand's EV once per decision taken in it, which is a reasonable
	 * training figure and a badly wrong session figure -- a hand that hits three
	 * times would count three times over. `ev` and `variance` below are the
	 * round-level accumulators the result is built from instead. See
	 * docs/sim-model.md §Accumulating EV.
	 */
	stats: PlayStats;
	/** Expectation of each round as it was opened, summed, in currency. */
	ev: number;
	/** Variance of the same, in currency², summed as independent rounds. */
	variance: number;
	buckets: SimBucket[];
	samples: SimSample[];
	/**
	 * Rounds dealt, played or sat out -- what `SimConfig.rounds` counts down. See
	 * `isDone`.
	 */
	roundsSeen: number;
	/** Of those, the ones wagered on. */
	roundsPlayed: number;
	shoes: number;
	/**
	 * Rounds opened on a natural, counted whatever the dealer then showed -- a
	 * natural pushed against a dealer's is still one dealt. Only the round's first
	 * hand can hold one; a split hand's twenty-one never counts.
	 */
	blackjacks: number;
	/**
	 * Whether the player is in the seat right now. Carried on the run rather than
	 * recomputed per round because the wong settings are read with hysteresis: the
	 * seat is taken at `wongInCount` and given up below `wongOutCount`, so what
	 * happens at a count between the two depends on which side it was approached
	 * from. Carried across shuffles too -- the count resetting to zero is not the
	 * player standing up.
	 */
	seated: boolean;
	wagered: number;
	/** Insurance staked, kept apart from the main wager it is a fraction of. */
	insuranceWagered: number;
}

/**
 * Cards a spot at the table burns per round: two dealt to it, plus whatever it
 * draws. Other players are modelled as burned cards rather than as hands played
 * -- only their effect on the penetration, and on what the counter sees, reaches
 * anything the sim reports. See docs/sim-model.md §What is simplified.
 */
const SPOT_CARDS = 2;
/** And how many more, at most, a spot draws -- 0 to 2, uniformly. */
const SPOT_MAX_HITS = 2;
/** The dealer's own cards on a round the player is not in: two, plus a draw or two. */
const DEALER_CARDS = 2;
const DEALER_MAX_HITS = 3;

/** Checkpoints on the trajectory chart. Enough to draw a walk, few enough to send. */
const TRAJECTORY_SAMPLES = 200;

function emptyBuckets(): SimBucket[] {
	return ROUND_TRUE_COUNTS.map((trueCount) => ({
		trueCount,
		rounds: 0,
		roundsPlayed: 0,
		hands: 0,
		wagered: 0,
		av: 0,
		ev: 0,
	}));
}

/**
 * The chance the hole card behind `upcard` makes a natural, off the count's own
 * composition and with the upcard removed from it -- the reading
 * `ev/insurance.ts` takes against an ace, and its mirror against a ten. Zero
 * behind anything else. The player's own cards stay in the shoe, as everywhere
 * else in the engine (docs/ev-model.md §Simplifications (1)).
 */
function dealerNaturalChance(comp: Composition, upcard: Rank): number {
	if (upcard === 'A') return insuranceTenFraction(comp);
	if (upcard !== 'T') return 0;
	const remaining = comp.reduce((sum, halfCards) => sum + halfCards, 0) - CARD_UNITS;
	if (remaining < CARD_UNITS) return 0;
	return comp[RANK_INDEX.A] / remaining;
}

/**
 * A round in which the player never acted: a natural of their own, or a dealer
 * natural the peek found at the deal. The grids price no such cell -- there was
 * no decision to price -- so it is priced here, off the composition, or the
 * naturals' money would land in AV with nothing to answer it in EV. That is
 * about seven percentage points of edge on a 3:2 game, so it is not a rounding
 * matter. Returns the round's expectation and its variance, in currency².
 */
function naturalEv(
	settled: GameState,
	comp: Composition,
	bet: number
): { ev: number; variance: number } {
	const hand = settled.hands[0];
	// Nobody acted and the player has no natural, so the peek ended it: the whole
	// wager is gone, with nothing left to vary.
	if (hand === undefined || !hand.blackjack) return { ev: -bet, variance: 0 };

	const paid = bet * blackjackPayoutValue(settled.ruleSet.blackjackPayout);
	// The one thing that can still happen to a natural is the dealer matching it.
	const push = dealerNaturalChance(comp, settled.dealer.cards[0]);
	return { ev: paid * (1 - push), variance: paid * paid * push * (1 - push) };
}

/** Burns `cards` off the shoe, counting them as the player would see them. */
function burn(shoe: DealtShoe, cards: number): void {
	for (let card = 0; card < cards && shoe.cardsRemaining() > 0; card += 1) shoe.draw();
}

/** One spot's cards for a round: its two, plus a seeded number of hits. */
function spotCards(random: SeededRandom): number {
	return SPOT_CARDS + Math.floor(random() * (SPOT_MAX_HITS + 1));
}

export function createRun(inputs: SimInputs): SimRun {
	const { ruleSet, tags, sim } = inputs;
	const shoe = createShoe(ruleSet, tags, sim.seed, {
		cutCardVarianceDecks: sim.cutCardVarianceDecks,
	});
	return {
		inputs,
		strategy: createStrategy(ruleSet, tags, inputs.precision),
		game: createGame(ruleSet, shoe),
		burnRandom: mulberry32(sim.seed ^ 0x5bf03635),
		stats: EMPTY_PLAY_STATS,
		ev: 0,
		variance: 0,
		buckets: emptyBuckets(),
		samples: [],
		roundsSeen: 0,
		roundsPlayed: 0,
		// The one it was dealt with. `runChunk` counts each shuffle after it.
		shoes: 1,
		blackjacks: 0,
		// A back-counter arrives standing. The loop's own entry test seats them
		// before the first bet goes out, which is immediately where none is set.
		seated: false,
		wagered: 0,
		insuranceWagered: 0,
	};
}

/**
 * A run is measured in rounds *dealt*, not rounds wagered on. Sitting out is
 * part of the session -- it is where a back-counter's time goes -- so a run that
 * wagers on none of its rounds is a finite run with an answer, not a loop with
 * no way out. That is also what lets the wong window be set to exclude every
 * count, and lets a ramp that stakes nothing be asked about.
 */
export function isDone(run: SimRun): boolean {
	return run.roundsSeen >= run.inputs.sim.rounds;
}

/**
 * The two counts the seat turns on: the one a standing player sits down at, and
 * the one a seated player gets up below. The floor of either range is a sentinel
 * meaning "never" rather than a literal -10 -- a shoe dealt to the cut card
 * reaches past ten often enough that reading it literally would sit out a handful
 * of rounds in a run that asked to play every one of them.
 *
 * With no exit set, the entry count does both jobs: the seat is held exactly as
 * long as the count that earned it, which is the plain round-by-round reading of
 * wonging in. Set below the entry it is hysteresis proper -- sit down at +2, hold
 * the seat until the shoe cools past -1 -- and that is the only arrangement in
 * which the two settings differ. Set *above* the entry it simply wins: sitting
 * down at a count you would stand up at again the next round is not a strategy,
 * so the exit becomes the entry too rather than seating the player every other
 * round.
 */
function wongCounts(sim: SimConfig): { entry: number; exit: number } {
	const entry = sim.wongInCount > -WONG_LIMIT ? sim.wongInCount : -Infinity;
	const exit = sim.wongOutCount > -WONG_LIMIT ? sim.wongOutCount : entry;
	return { entry: Math.max(entry, exit), exit };
}

/** The Hi-Lo-equivalent count the ramp, the wong settings and the indices read. */
function hiLoCountOf(shoe: DealtShoe, scale: number): number {
	return scale > 0 ? shoe.trueCount() / scale : 0;
}

function sample(run: SimRun): void {
	run.samples.push({
		rounds: run.roundsSeen,
		av: run.stats.av,
		ev: run.ev,
		sd: Math.sqrt(Math.max(0, run.variance)),
	});
}

/**
 * Steps the run by at most `rounds` rounds dealt, played or sat out. Bounding it
 * by rounds dealt rather than by rounds played is what keeps a chunk finite
 * however much of the session is spent waiting for a count.
 */
export function runChunk(run: SimRun, rounds: number): void {
	const { ruleSet, tags, sim, ramp, unit } = run.inputs;
	const scale = hiLoCountScale(baseComposition(ruleSet), tags);
	const sampleEvery = Math.max(1, Math.floor(sim.rounds / TRAJECTORY_SAMPLES));
	const { entry: entryCount, exit: exitCount } = wongCounts(sim);

	for (let step = 0; step < rounds && !isDone(run); step += 1) {
		const shoe = run.game.shoe;
		if (shoe.needsShuffle()) {
			shoe.shuffle();
			run.shoes += 1;
		}

		const hiLo = hiLoCountOf(shoe, scale);
		const bucket = run.buckets[roundCountBucket(hiLo)];
		bucket.rounds += 1;
		run.roundsSeen += 1;

		// Standing or sitting is decided before the bet, and it depends on which way
		// the count arrived: a seat is taken at the entry count and kept until the
		// count falls under the exit one. Where the two are equal -- the default --
		// this is the same round-by-round test as before.
		run.seated = run.seated ? hiLo >= exitCount : hiLo >= entryCount;
		const bet = run.seated ? betAtCount(ramp, hiLo) * unit : 0;
		if (bet <= 0) {
			// The round is dealt without the player in it -- wonged out, or a count
			// the ramp stakes nothing at. The cards come out, the count moves, and
			// nothing is wagered.
			burn(shoe, spotCards(run.burnRandom) * sim.otherSpots);
			burn(shoe, DEALER_CARDS + Math.floor(run.burnRandom() * DEALER_MAX_HITS));
		} else {
			playRound(run, bucket, bet, hiLo);
			burn(run.game.shoe, spotCards(run.burnRandom) * sim.otherSpots);
		}

		// Checkpointed against rounds *dealt*, so the walk advances at the rate the
		// session does: a stretch spent back-counting draws as the flat line it is
		// rather than being compressed out of the picture.
		if (run.roundsSeen % sampleEvery === 0) sample(run);
	}

	// The last checkpoint is the run's own end, so the trajectory finishes on the
	// figure the stat band reports rather than a round or two short of it.
	if (isDone(run) && run.samples[run.samples.length - 1]?.rounds !== run.roundsSeen) {
		sample(run);
	}
}

function playRound(run: SimRun, bucket: SimBucket, bet: number, hiLo: number): void {
	const { sim, observe } = run.inputs;
	const shoe = run.game.shoe;
	// Read once, before the round's own cards move it: the grids a hand is played
	// off are the shoe's as it stood when the bet went out, which is the same
	// basis the Play view's coach grades on.
	const trueCount = shoe.trueCount();
	const grids = run.strategy.gridsFor(trueCount);

	let state = startRound(run.game, bet);
	// What this round was worth, and how it was spread, read off its *opening*
	// decision alone -- a priced action's EV already covers playing the hand on
	// from there, and a split's covers both of its stakes. See `SimRun.stats`.
	let roundEv = 0;
	let roundVariance = 0;
	let opened = false;
	// Only ever read by the observer below, and only filled where one is set.
	let openingCell = 'natural';
	let openingAction: PlayerAction | undefined;

	if (state.phase === 'insurance') {
		const comp = run.strategy.compFor(trueCount);
		const take = decideInsurance(sim.deviations, comp, hiLo);
		state = resolveInsurance(state, take);
		if (take) {
			const stake = bet / 2;
			run.insuranceWagered += stake;
			// The side bet's own expectation, priced off the same composition the
			// decision was made on. Its variance is left out, which is the one thing
			// the deviation figure is slightly optimistic about.
			roundEv += (insuranceEvPercent(comp) / 100) * stake;
		}
	}

	while (state.phase === 'act') {
		const legal = legalActions(state);
		if (legal.length === 0) break;
		const action = decideAction(state, legal, grids, sim.deviations, hiLo);
		const graded = gradeDecision(state, action, grids, trueCount);
		if (graded !== null) {
			const wager = state.hands[state.activeHandIndex].bet;
			run.stats = recordDecision(run.stats, graded, wager);
			if (!opened) {
				opened = true;
				const evFraction = graded.chosenEvPercent / 100;
				roundEv += wager * evFraction;
				roundVariance +=
					wager * wager * (graded.chosenSecondMoment - evFraction * evFraction);
				if (observe) {
					const address = cellAddressFor(state, legal);
					openingCell = `${address.grid}:${address.key}`;
					openingAction = action;
				}
			}
		}
		state = applyAction(state, action);
	}

	const settled = settleRound(state);
	run.stats = recordRound(run.stats, settled.net, settled.hands.length);
	run.game = settled;
	if (settled.hands[0]?.blackjack) run.blackjacks += 1;

	if (!opened) {
		const natural = naturalEv(settled, run.strategy.compFor(trueCount), bet);
		roundEv += natural.ev;
		roundVariance += natural.variance;
	}

	if (observe) {
		observe({
			cell: openingCell,
			openingAction,
			evPercent: (roundEv / bet) * 100,
			bet,
			net: settled.net,
			hiLo,
		});
	}

	run.ev += roundEv;
	// Rounds are summed as independent, which they are up to the cards one takes
	// out of the shoe for the next -- the same assumption docs/bankroll-model.md
	// makes per round.
	run.variance += roundVariance;
	run.roundsPlayed += 1;
	run.wagered += bet;
	bucket.roundsPlayed += 1;
	bucket.hands += settled.hands.length;
	// The opening bet, not the money that ended up on the felt: it is what the
	// ramp actually set, and what an average-bet figure is read as.
	bucket.wagered += bet;
	bucket.av += settled.net;
	bucket.ev += roundEv;
}
