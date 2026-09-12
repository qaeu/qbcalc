/**
 * What a Train drill asks: the three drills, their three modes, and the seeded
 * question pools behind them. Every question is a real `GameState` in its `act`
 * phase, dealt to order through the Play view's own state machine, so the felt,
 * the action bar and the coach all read it exactly as they read a live hand.
 * See docs/train-model.md.
 */

import { hiLoCountScale, wholeCountFrequencies } from '../bankroll/bankroll';
import { blackjackHoleRank, RANK_INDEX, RANKS, type Rank } from '../ev/cards';
import { baseComposition, type TagValues } from '../ev/composition';
import type { PlayerAction, RuleSet } from '../ev/rules';
import type { PlayGrids, TrainGrids } from '../evWorkerProtocol';
import {
	applyAction,
	createGame,
	dealLooseCards,
	resolveInsurance,
	settleRound,
	startRound,
	type GameState,
} from '../play/game';
import { mulberry32, type SeededRandom } from '../play/rng';
import { restoreShoe } from '../play/shoe';
import { MAX_PRICED_COUNT } from '../sim/strategy';
import type { AnimationSpeed } from '../settings/storage';
import { priceDecision, type PricedDecision } from './grade';

export type DrillId = 'basic' | 'counting' | 'deviation';
export type DrillMode = 'easy' | 'hard' | 'test';

export const DRILL_IDS: readonly DrillId[] = ['basic', 'counting', 'deviation'];
export const DRILL_MODES: readonly DrillMode[] = ['easy', 'hard', 'test'];

/** Questions in a Basic or Deviation drill. */
export const DECISION_QUESTIONS: Record<DrillMode, number> = {
	easy: 10,
	hard: 20,
	test: 40,
};

/** Checkpoints in a Counting drill. */
export const COUNT_CHECKPOINTS: Record<DrillMode, number> = {
	easy: 5,
	hard: 5,
	test: 10,
};

/** A Test answers every question against this clock; running out is a miss. */
export const TEST_TIME_LIMIT_MS = 5000;

/**
 * Two actions this close, in percentage points, are a tie: at `'fast'` precision
 * the winner could be noise, and nobody can be expected to know it. Such a cell
 * is never asked.
 */
export const TIE_EPSILON_POINTS = 0.02;

/** How a Counting drill deals, per mode. */
export interface CountingPace {
	/** How fast the cards land. The mode's own, not the Play view's setting. */
	speed: Exclude<AnimationSpeed, 'instant'>;
	/** The time to count a round: from its last card landing to the felt clearing. */
	countMs: number;
	/** Rounds per checkpoint, drawn uniformly from this range. */
	minRounds: number;
	maxRounds: number;
	/** How far from the right count an answer may be and still be right. */
	tolerance: number;
	/**
	 * Where the mode deals cards rather than rounds, how many it lays down each
	 * time. Easy's own shape: no game to follow, just cards to count. See
	 * `dealCountingCards`.
	 */
	cardsPerRound?: number;
}

export const COUNTING_PACE: Record<DrillMode, CountingPace> = {
	easy: {
		speed: '2x',
		countMs: 10_000,
		minRounds: 5,
		maxRounds: 5,
		tolerance: 0,
		cardsPerRound: 4,
	},
	hard: {
		speed: '4x',
		countMs: 8000,
		minRounds: 6,
		maxRounds: 10,
		tolerance: 0,
	},
	test: {
		speed: '4x',
		countMs: 5000,
		minRounds: 6,
		maxRounds: 10,
		tolerance: 0,
	},
};

/** A drill's length, in questions or checkpoints. */
export function drillLength(drill: DrillId, mode: DrillMode): number {
	return drill === 'counting' ? COUNT_CHECKPOINTS[mode] : DECISION_QUESTIONS[mode];
}

/** Whether each answer gets its verdict as it is given. A Test holds them all back. */
export function hasFeedback(mode: DrillMode): boolean {
	return mode !== 'test';
}

/**
 * The count a deviation question's play switches at: `action` is what the count
 * plays from `from` outward -- upward for a positive index, downward for a
 * negative one. What the verdict quotes, and never zero, since the count-zero
 * shoe is the unadjusted one.
 */
export interface DeviationIndex {
	action: PlayerAction;
	from: number;
}

/** One decision question: a hand, an upcard, and the count it is asked at. */
export interface DecisionQuestion {
	/** The player's cards in the order dealt; past two, the hand has hit. */
	cards: Rank[];
	upcard: Rank;
	/** Drawn but never shown -- chosen so the dealer holds no natural. */
	hole: Rank;
	/** The whole true count the question is asked at; zero for Basic. */
	trueCount: number;
	/**
	 * A Deviation question's standing: a play the count has moved, or a control
	 * just short of its index where basic strategy still holds.
	 */
	kind: 'basic' | 'deviation' | 'control';
	/** Deviation drills only: the index the verdict names. */
	index?: DeviationIndex;
}

/** The counts a drill needs grids at, before it can ask anything. */
export interface DrillPlan {
	counts: number[];
}

/** A two-card starting hand against an upcard, and how often the deal produces it. */
interface Candidate {
	cards: Rank[];
	upcard: Rank;
	/** Probability of this deal, off the full shoe. */
	occurrence: number;
	state: GameState;
}

/** One question a drill may ask, with the weight it is drawn at. */
interface PoolItem {
	question: DecisionQuestion;
	weight: number;
	/** Cells asked twice in a row read as a stuck drill; the key keeps them apart. */
	cell: string;
}

/**
 * How far a Deviation drill prices the count, in Hi-Lo-equivalent true counts,
 * converted to the system's own through `hiLoCountScale` and clamped where the
 * sim clamps. Wide enough to reach the index plays that only fire at the tails
 * of the shoe, which is what the Hard pool is for.
 */
const DEVIATION_HI_LO_RANGE: readonly [number, number] = [-5, 8];

/**
 * The share of rounds the Easy pool's counts cover, from the centre of the
 * count distribution out: counts the shoe actually spends its time at. A share
 * of the rounds inside the priced range, not of every round -- a one- or
 * two-deck count spreads so wide that the range itself holds less than this.
 */
const EASY_COUNT_MASS = 0.9;

/** Of a Hard Basic drill, the share dealt as a hand that has already hit. */
const MULTI_CARD_SHARE = 0.3;

/** Of a Deviation drill, the share asked just short of an index. */
const CONTROL_SHARE = 0.3;

/**
 * A shoe of exactly `script`, in the table's deal order: player, upcard, player,
 * hole card, then every hit. A played shoe restored from its own snapshot, so the
 * question is dealt through the same code a live one is.
 */
function scriptedShoe(script: Rank[], tags: TagValues) {
	return restoreShoe(tags, {
		cards: script,
		dealt: 0,
		count: 0,
		hidden: [],
		cutCard: script.length,
		rng: 0,
	});
}

/**
 * The live hand a question describes, dealt through `game.ts` and left acting:
 * insurance declined where it is offered, and every card past the second taken
 * as a hit. Throws if the question cannot be dealt that way -- a natural, a bust
 * -- which the pools below never produce.
 */
export function questionState(
	question: Pick<DecisionQuestion, 'cards' | 'upcard' | 'hole'>,
	ruleSet: RuleSet,
	tags: TagValues
): GameState {
	const { cards, upcard, hole } = question;
	const script = [cards[0], upcard, cards[1], hole, ...cards.slice(2)];
	let state = startRound(createGame(ruleSet, scriptedShoe(script, tags)), 1);
	if (state.phase === 'insurance') state = resolveInsurance(state, false);
	for (let hit = 2; hit < cards.length; hit += 1) state = applyAction(state, 'H');
	if (state.phase !== 'act') {
		throw new Error(`${cards.join(',')} v ${upcard} does not leave a decision to make.`);
	}
	return state;
}

/** Real cards per rank in a full shoe. */
function fullShoe(ruleSet: RuleSet): number[] {
	return baseComposition(ruleSet).map((halfCards) => halfCards / 2);
}

/** Probability of dealing `first`, `second` (either order) and `upcard` off `shoe`. */
function dealProbability(
	shoe: number[],
	first: Rank,
	second: Rank,
	upcard: Rank
): number {
	const total = shoe.reduce((sum, cards) => sum + cards, 0);
	const a = RANK_INDEX[first];
	const b = RANK_INDEX[second];
	const pair = a === b ? shoe[a] * (shoe[a] - 1) : 2 * shoe[a] * shoe[b];
	const up = RANK_INDEX[upcard];
	const left = shoe[up] - (a === up ? 1 : 0) - (b === up ? 1 : 0);
	return (pair / (total * (total - 1))) * (Math.max(0, left) / (total - 2));
}

/** A hole card for `upcard` that does not complete a dealer natural. */
function holeFor(upcard: Rank, shoe: number[], random: SeededRandom): Rank {
	const barred = blackjackHoleRank(upcard);
	const ranks = RANKS.filter((rank) => rank !== barred);
	return pickWeighted(
		ranks,
		ranks.map((rank) => shoe[RANK_INDEX[rank]]),
		random
	);
}

function pickWeighted<T>(
	items: readonly T[],
	weights: readonly number[],
	random: SeededRandom
): T {
	const total = weights.reduce((sum, weight) => sum + weight, 0);
	let target = random() * total;
	for (let index = 0; index < items.length; index += 1) {
		target -= weights[index];
		if (target < 0) return items[index];
	}
	return items[items.length - 1];
}

/** Every two-card starting hand against every upcard, naturals aside. */
function twoCardCandidates(
	ruleSet: RuleSet,
	tags: TagValues,
	random: SeededRandom
): Candidate[] {
	const shoe = fullShoe(ruleSet);
	const out: Candidate[] = [];
	for (let i = 0; i < RANKS.length; i += 1) {
		for (let j = i; j < RANKS.length; j += 1) {
			const [low, high] = [RANKS[i], RANKS[j]];
			if ((low === 'A' && high === 'T') || (low === 'T' && high === 'A')) continue;
			for (const upcard of RANKS) {
				// Dealt in either order -- the felt shows which came first, and a
				// player reading 7,9 and 9,7 is reading the same hand.
				const cards = random() < 0.5 ? [low, high] : [high, low];
				const hole = holeFor(upcard, shoe, random);
				out.push({
					cards,
					upcard,
					occurrence: dealProbability(shoe, low, high, upcard),
					state: questionState({ cards, upcard, hole }, ruleSet, tags),
				});
			}
		}
	}
	return out;
}

/** The hand's grid address, for keeping one cell from being asked twice running. */
function cellKey(state: GameState): string {
	const hand = state.hands[0];
	const pair = hand.cards.length === 2 && hand.cards[0] === hand.cards[1];
	const shape =
		pair ? `pair-${hand.cards[0]}`
		: hand.soft ? `soft-${hand.total}`
		: `hard-${hand.total}`;
	return `${shape}|${state.dealer.cards[0]}|${hand.cards.length}`;
}

/**
 * Cells nobody gets wrong: hard 8 or less that hits, hard 17 or more that stands
 * (tens included), soft 20 that stands. A pair of nines is not one of them: that
 * it stands against 7, 10 and ace rather than splitting is among the most missed
 * cells there are. Where the rules make one of them something else -- hard 17
 * surrendering against an ace -- it is not trivial and stays in.
 */
function isTrivial(state: GameState, priced: PricedDecision): boolean {
	const hand = state.hands[0];
	const pair = hand.cards.length === 2 && hand.cards[0] === hand.cards[1];
	const nines = pair && hand.cards[0] === '9';
	if (!hand.soft && !pair && hand.total <= 8 && priced.countAction === 'H') return true;
	if (!hand.soft && !nines && hand.total >= 17 && priced.countAction === 'S') return true;
	return hand.soft && hand.total >= 20 && priced.countAction === 'S';
}

/**
 * How much a Hard drill leans on a cell: toward the borderline (a small margin
 * between the two best plays) and toward the rare (a deal that seldom comes up).
 * Soft doubles, surrenders and pairs against strong upcards come in on the second.
 */
function hardWeight(
	occurrence: number,
	meanOccurrence: number,
	gapPoints: number
): number {
	const rarity = Math.min(4, Math.sqrt(meanOccurrence / Math.max(occurrence, 1e-9)));
	const borderline = 1 / (1 + Math.min(gapPoints, 100) / 2);
	return rarity * borderline;
}

/**
 * Three-card hands for the Hard pool: a two-card hand basic strategy hits,
 * plus the card it drew, still short of 21. Double and surrender are gone by
 * then, which is the point -- soft 18 on three cards against a 3 is a different
 * question from soft 18 on two.
 */
function multiCardItems(
	candidates: readonly Candidate[],
	ruleSet: RuleSet,
	tags: TagValues,
	grids: PlayGrids,
	meanOccurrence: number,
	random: SeededRandom
): PoolItem[] {
	const shoe = fullShoe(ruleSet);
	const total = shoe.reduce((sum, cards) => sum + cards, 0);
	const items: PoolItem[] = [];
	for (const candidate of candidates) {
		const prefix = priceDecision(candidate.state, grids);
		if (prefix === null || prefix.basicAction !== 'H') continue;
		const [first, second] = candidate.cards;
		for (const drawn of RANKS) {
			const cards = [...candidate.cards, drawn];
			const hole = holeFor(candidate.upcard, shoe, random);
			let state: GameState;
			try {
				state = questionState({ cards, upcard: candidate.upcard, hole }, ruleSet, tags);
			} catch {
				// Twenty-one or a bust: nothing left to decide.
				continue;
			}
			const priced = priceDecision(state, grids);
			if (priced === null || priced.gapPoints < TIE_EPSILON_POINTS) continue;
			if (isTrivial(state, priced)) continue;
			const occurrence =
				dealProbability(shoe, first, second, candidate.upcard)
				* (shoe[RANK_INDEX[drawn]] / (total - 3));
			items.push({
				question: { cards, upcard: candidate.upcard, hole, trueCount: 0, kind: 'basic' },
				weight: hardWeight(occurrence, meanOccurrence, priced.gapPoints),
				cell: cellKey(state),
			});
		}
	}
	return items;
}

/**
 * How much less likely a cell is to be drawn again for each time it already has
 * been. Several deals share a cell -- hard 14 is 4,T and 5,9 and 6,8 -- so a
 * common one would otherwise come round several times in one short drill.
 */
const REPEAT_DAMPING = 3;

/**
 * Draws `count` questions from `pools`, one pool per question as `choosePool`
 * says, weighted and without repeating an item until its pool is exhausted --
 * a cell already asked damped by `REPEAT_DAMPING`, and never the same cell
 * twice in a row where the pool leaves any choice.
 */
function drawQuestions(
	pools: readonly PoolItem[][],
	count: number,
	choosePool: () => number,
	random: SeededRandom
): DecisionQuestion[] {
	const remaining = pools.map((pool) => [...pool]);
	const out: DecisionQuestion[] = [];
	const timesAsked = new Map<string, number>();
	let lastCell = '';
	for (let asked = 0; asked < count; asked += 1) {
		let poolIndex = choosePool();
		if (pools[poolIndex].length === 0)
			poolIndex = pools.findIndex((pool) => pool.length > 0);
		if (poolIndex < 0) break;
		if (remaining[poolIndex].length === 0) remaining[poolIndex] = [...pools[poolIndex]];
		const left = remaining[poolIndex];
		const fresh = left.filter((item) => item.cell !== lastCell);
		const from = fresh.length > 0 ? fresh : left;
		const item = pickWeighted(
			from,
			from.map(
				(entry) => entry.weight / REPEAT_DAMPING ** (timesAsked.get(entry.cell) ?? 0)
			),
			random
		);
		left.splice(left.indexOf(item), 1);
		timesAsked.set(item.cell, (timesAsked.get(item.cell) ?? 0) + 1);
		lastCell = item.cell;
		out.push(item.question);
	}
	return out;
}

/** The whole counts from `low` to `high`, inclusive. */
function countRange(low: number, high: number): number[] {
	return Array.from({ length: high - low + 1 }, (_, index) => low + index);
}

/**
 * The counts the Deviation drill prices at, in the system's own units: the
 * whole of `DEVIATION_HI_LO_RANGE` for Hard and Test, and for Easy only the
 * central `EASY_COUNT_MASS` of rounds -- see `easyCounts`.
 */
function deviationCounts(ruleSet: RuleSet, tags: TagValues, mode: DrillMode): number[] {
	const scale = hiLoCountScale(baseComposition(ruleSet), tags);
	const clamp = (count: number) =>
		Math.max(-MAX_PRICED_COUNT, Math.min(MAX_PRICED_COUNT, Math.round(count * scale)));
	const all = countRange(
		clamp(DEVIATION_HI_LO_RANGE[0]),
		clamp(DEVIATION_HI_LO_RANGE[1])
	);
	return mode === 'easy' ? easyCounts(ruleSet, tags, all) : all;
}

/**
 * The narrowest run of whole counts about zero holding `EASY_COUNT_MASS` of the
 * rounds played inside `all`, grown a count at a time toward whichever side
 * holds more.
 */
function easyCounts(ruleSet: RuleSet, tags: TagValues, all: readonly number[]): number[] {
	const frequencies = wholeCountFrequencies(ruleSet, tags, all);
	const at = (count: number) => frequencies[all.indexOf(count)] ?? 0;
	const target = EASY_COUNT_MASS * frequencies.reduce((sum, share) => sum + share, 0);
	let low = 0;
	let high = 0;
	let mass = at(0);
	while (mass < target) {
		const below = all.includes(low - 1) ? at(low - 1) : -1;
		const above = all.includes(high + 1) ? at(high + 1) : -1;
		if (below < 0 && above < 0) break;
		if (above >= below) {
			high += 1;
			mass += above;
		} else {
			low -= 1;
			mass += below;
		}
	}
	return countRange(low, high);
}

/** The counts a drill has to have grids at before its first question. */
export function planDrill(
	drill: DrillId,
	mode: DrillMode,
	ruleSet: RuleSet,
	tags: TagValues
): DrillPlan {
	return { counts: drill === 'deviation' ? deviationCounts(ruleSet, tags, mode) : [0] };
}

/**
 * A Basic drill: the best legal play off the unadjusted grids, at a count of
 * zero. Easy deals hands as often as the shoe does, trivial cells aside; Hard
 * leans toward the rare and the borderline and mixes in hands that have hit.
 * Near-ties are never asked, in either.
 */
export function basicQuestions(
	mode: DrillMode,
	ruleSet: RuleSet,
	tags: TagValues,
	grids: TrainGrids,
	seed: number
): DecisionQuestion[] {
	const random = mulberry32(seed);
	const flat = grids.get(0);
	if (flat === undefined) throw new Error('A Basic drill needs the count-zero grids.');
	const candidates = twoCardCandidates(ruleSet, tags, random);
	const meanOccurrence =
		candidates.reduce((sum, candidate) => sum + candidate.occurrence, 0)
		/ candidates.length;

	const twoCard: PoolItem[] = [];
	for (const candidate of candidates) {
		const priced = priceDecision(candidate.state, flat);
		if (priced === null || priced.gapPoints < TIE_EPSILON_POINTS) continue;
		if (isTrivial(candidate.state, priced)) continue;
		twoCard.push({
			question: {
				cards: candidate.cards,
				upcard: candidate.upcard,
				hole: candidate.state.dealer.cards[1],
				trueCount: 0,
				kind: 'basic',
			},
			weight:
				mode === 'easy' ?
					candidate.occurrence
				:	hardWeight(candidate.occurrence, meanOccurrence, priced.gapPoints),
			cell: cellKey(candidate.state),
		});
	}

	if (mode === 'easy') {
		return drawQuestions([twoCard], DECISION_QUESTIONS[mode], () => 0, random);
	}
	const multi = multiCardItems(candidates, ruleSet, tags, flat, meanOccurrence, random);
	return drawQuestions(
		[twoCard, multi],
		DECISION_QUESTIONS[mode],
		() => (random() < MULTI_CARD_SHARE ? 1 : 0),
		random
	);
}

/** One count's reading of a candidate: the count play, and whether it is a tie. */
interface CountReading {
	count: number;
	action: PlayerAction;
	tie: boolean;
}

/**
 * The index a deviation at `readings[at]` switches at: walking back toward zero
 * from it, the last count still playing the same action. `readings` runs
 * outward from zero on one side.
 */
function indexOf(readings: readonly CountReading[], at: number): number {
	let from = at;
	while (from > 0 && readings[from - 1].action === readings[at].action) from -= 1;
	return readings[from].count;
}

/**
 * A Deviation drill: a hand and a whole true count, answered with the count's
 * own play. About `CONTROL_SHARE` of the questions sit one count short of an
 * index, where basic strategy still holds -- without them every answer would be
 * "not basic". Easy draws from counts the shoe spends its time at, weighted by
 * how often the hand and the count come up together; Hard from the rest --
 * extreme and negative counts, rare hands, split and surrender plays.
 *
 * Empty where the counting system moves no play at all inside the range priced.
 */
export function deviationQuestions(
	mode: DrillMode,
	ruleSet: RuleSet,
	tags: TagValues,
	grids: TrainGrids,
	seed: number
): DecisionQuestion[] {
	const random = mulberry32(seed);
	const counts = [...grids.keys()].sort((a, b) => a - b);
	const easy = new Set(deviationCounts(ruleSet, tags, 'easy'));
	const frequencies = wholeCountFrequencies(ruleSet, tags, counts);
	const frequencyAt = (count: number) => frequencies[counts.indexOf(count)] ?? 0;
	const candidates = twoCardCandidates(ruleSet, tags, random);
	const occurrences = candidates
		.map((candidate) => candidate.occurrence)
		.sort((a, b) => a - b);
	const medianOccurrence = occurrences[Math.floor(occurrences.length / 2)];

	const deviations: PoolItem[] = [];
	const controls: PoolItem[] = [];

	for (const candidate of candidates) {
		const priced = new Map<number, PricedDecision>();
		for (const count of counts) {
			const at = priceDecision(candidate.state, grids.get(count)!);
			if (at !== null) priced.set(count, at);
		}
		const basic = priced.get(0)?.basicAction;
		if (basic === undefined) continue;
		const hole = candidate.state.dealer.cards[1];
		const cell = cellKey(candidate.state);
		const rare = candidate.occurrence < medianOccurrence;

		for (const side of [1, -1]) {
			// Outward from zero on this side, stopping at the first count not priced.
			const readings: CountReading[] = [];
			for (let count = 0; priced.has(count); count += side) {
				const at = priced.get(count)!;
				readings.push({
					count,
					action: at.countAction,
					tie: at.gapPoints < TIE_EPSILON_POINTS,
				});
			}

			// Grouped by index, so a play that holds for eight counts is one
			// deviation asked at one of eight counts, not eight deviations.
			const groups = new Map<
				string,
				{ index: DeviationIndex; members: CountReading[] }
			>();
			readings.forEach((reading, at) => {
				if (reading.count === 0 || reading.tie || reading.action === basic) return;
				const index = { action: reading.action, from: indexOf(readings, at) };
				const key = `${index.action}${index.from}`;
				const group = groups.get(key) ?? { index, members: [] };
				group.members.push(reading);
				groups.set(key, group);
			});

			for (const { index, members } of groups.values()) {
				const special = [index.action, basic].some(
					(action) => action === 'P' || action === 'R'
				);
				for (const member of members) {
					const typical = easy.has(member.count) && member.count > 0 && !rare && !special;
					if (mode !== 'easy' && typical) continue;
					deviations.push({
						question: {
							cards: candidate.cards,
							upcard: candidate.upcard,
							hole,
							trueCount: member.count,
							kind: 'deviation',
							index,
						},
						weight:
							mode === 'easy' ?
								candidate.occurrence * frequencyAt(member.count)
							:	1 / members.length,
						cell,
					});
				}

				// The control: one count short of the index, toward zero, where
				// basic strategy is still the play -- and is not a tie there either.
				const short = readings.find((reading) => reading.count === index.from - side);
				if (short === undefined || short.tie || short.action !== basic) continue;
				const typical = easy.has(short.count) && index.from > 0 && !rare && !special;
				if (mode !== 'easy' && typical) continue;
				controls.push({
					question: {
						cards: candidate.cards,
						upcard: candidate.upcard,
						hole,
						trueCount: short.count,
						kind: 'control',
						index,
					},
					weight: mode === 'easy' ? candidate.occurrence * frequencyAt(short.count) : 1,
					cell,
				});
			}
		}
	}

	return drawQuestions(
		[deviations, controls],
		DECISION_QUESTIONS[mode],
		() => (random() < CONTROL_SHARE ? 1 : 0),
		random
	);
}

/** Rounds per checkpoint for a whole Counting drill, drawn up front from `seed`. */
export function checkpointRounds(mode: DrillMode, seed: number): number[] {
	const random = mulberry32(seed);
	const { minRounds, maxRounds } = COUNTING_PACE[mode];
	return Array.from(
		{ length: COUNT_CHECKPOINTS[mode] },
		() => minRounds + Math.floor(random() * (maxRounds - minRounds + 1))
	);
}

/**
 * What Easy deals instead of a round: `count` cards onto the felt and nothing
 * else -- no upcard, no hand to play, no total under them. The mode asks for the
 * running count, and a hand played out is only more to watch while keeping it.
 * Shuffles at the cut card as a round does.
 */
export function dealCountingCards(game: GameState, count: number): GameState {
	return dealLooseCards(game, count);
}

/**
 * One Counting round, dealt and played to basic strategy through `game.ts` and
 * settled: insurance declined, every decision the best legal play off the
 * unadjusted grids. Handed to the felt settled, the reveal queue lands its cards
 * in the table's own order. `game` is the drill's running game, in `bet` or
 * `settled`, and shuffles itself at the cut card as a live one does.
 */
export function dealCountingRound(game: GameState, grids: PlayGrids): GameState {
	let state = startRound(game, 1);
	if (state.phase === 'insurance') state = resolveInsurance(state, false);
	while (state.phase === 'act') {
		const action = priceDecision(state, grids)?.basicAction ?? 'S';
		state = applyAction(state, action);
	}
	return settleRound(state);
}
