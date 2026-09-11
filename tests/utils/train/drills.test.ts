import { describe, it, expect } from 'vitest';

import { RANKS } from '#utils/ev/cards';
import { createGame, legalActions, preRound } from '#utils/play/game';
import { createShoe } from '#utils/play/shoe';
import {
	basicQuestions,
	checkpointRounds,
	COUNTING_PACE,
	COUNT_CHECKPOINTS,
	DECISION_QUESTIONS,
	dealCountingRound,
	deviationQuestions,
	planDrill,
	questionState,
	TIE_EPSILON_POINTS,
	type DecisionQuestion,
} from '#utils/train/drills';
import { priceDecision } from '#utils/train/grade';

import { RULE_SET, TAGS, trainGrids } from './trainGrids';

const hardPlan = planDrill('deviation', 'hard', RULE_SET, TAGS);
const grids = trainGrids(hardPlan.counts);

const priced = (question: DecisionQuestion) =>
	priceDecision(questionState(question, RULE_SET, TAGS), grids.get(question.trueCount)!)!;

/** The grid cell a question lands on, for telling repeats apart. */
const cellOf = (question: DecisionQuestion) => {
	const hand = questionState(question, RULE_SET, TAGS).hands[0];
	return `${hand.soft}${hand.total}${hand.cards.length === 2 && hand.cards[0] === hand.cards[1]}|${question.upcard}|${hand.cards.length}`;
};

describe('a question', () => {
	it('is dealt through the game, acting, with the cards it names', () => {
		const state = questionState(
			{ cards: ['A', '6', '2'], upcard: '9', hole: '7' },
			RULE_SET,
			TAGS
		);
		expect(state.phase).toBe('act');
		expect(state.hands[0].cards).toEqual(['A', '6', '2']);
		expect(state.dealer.cards).toEqual(['9', '7']);
		expect(legalActions(state)).not.toContain('D');
	});

	it('refuses a hand with nothing left to decide', () => {
		expect(() =>
			questionState({ cards: ['A', 'T'], upcard: '9', hole: '7' }, RULE_SET, TAGS)
		).toThrow();
	});
});

describe('planning a drill', () => {
	it('prices only the flat shoe for Basic and Counting', () => {
		expect(planDrill('basic', 'hard', RULE_SET, TAGS).counts).toEqual([0]);
		expect(planDrill('counting', 'easy', RULE_SET, TAGS).counts).toEqual([0]);
	});

	it('gives Easy deviations the central counts, and Hard the whole range', () => {
		const easy = planDrill('deviation', 'easy', RULE_SET, TAGS).counts;
		expect(easy).toContain(0);
		expect(easy.every((count) => hardPlan.counts.includes(count))).toBe(true);
		expect(easy.length).toBeLessThan(hardPlan.counts.length);
		expect(Math.min(...hardPlan.counts)).toBeLessThan(0);
	});
});

describe('the Basic drill', () => {
	for (const mode of ['easy', 'hard', 'test'] as const) {
		it(`asks ${DECISION_QUESTIONS[mode]} clear-cut questions at ${mode}`, () => {
			const questions = basicQuestions(mode, RULE_SET, TAGS, grids, 11);
			expect(questions).toHaveLength(DECISION_QUESTIONS[mode]);
			for (const question of questions) {
				expect(question.trueCount).toBe(0);
				expect(priced(question).gapPoints).toBeGreaterThanOrEqual(TIE_EPSILON_POINTS);
			}
		});
	}

	it('deals the same drill from the same seed, and another from another', () => {
		const once = basicQuestions('hard', RULE_SET, TAGS, grids, 5);
		expect(basicQuestions('hard', RULE_SET, TAGS, grids, 5)).toEqual(once);
		expect(basicQuestions('hard', RULE_SET, TAGS, grids, 6)).not.toEqual(once);
	});

	it('never asks the same cell twice running', () => {
		const questions = basicQuestions('test', RULE_SET, TAGS, grids, 3);
		for (let at = 1; at < questions.length; at += 1) {
			expect(cellOf(questions[at])).not.toBe(cellOf(questions[at - 1]));
		}
	});

	it('leaves out the cells nobody gets wrong', () => {
		const questions = basicQuestions('test', RULE_SET, TAGS, grids, 9);
		for (const question of questions) {
			const hand = questionState(question, RULE_SET, TAGS).hands[0];
			const action = priced(question).countAction;
			const nines = question.cards.length === 2 && question.cards.join('') === '99';
			expect(!hand.soft && !nines && hand.total >= 17 && action === 'S').toBe(false);
		}
	});

	it('still asks a pair of nines that stands', () => {
		const standing = Array.from({ length: 40 }, (_, seed) =>
			basicQuestions('hard', RULE_SET, TAGS, grids, seed)
		)
			.flat()
			.filter((question) => question.cards.join('') === '99')
			.filter((question) => priced(question).countAction === 'S');
		expect(standing.length).toBeGreaterThan(0);
	});

	it('keeps Easy to two cards and mixes hands that have hit into Hard', () => {
		const easy = basicQuestions('easy', RULE_SET, TAGS, grids, 2);
		expect(easy.every((question) => question.cards.length === 2)).toBe(true);
		const hard = basicQuestions('test', RULE_SET, TAGS, grids, 2);
		expect(hard.some((question) => question.cards.length > 2)).toBe(true);
	});

	it('never deals the dealer a natural', () => {
		for (const question of basicQuestions('test', RULE_SET, TAGS, grids, 4)) {
			const state = questionState(question, RULE_SET, TAGS);
			expect(state.dealer.cards).toHaveLength(2);
			expect(RANKS).toContain(question.hole);
		}
	});
});

describe('the Deviation drill', () => {
	const questions = deviationQuestions('hard', RULE_SET, TAGS, grids, 17);

	it('asks a full drill', () => {
		expect(questions).toHaveLength(DECISION_QUESTIONS.hard);
	});

	it('asks deviations where the count moves the play, off a clear margin', () => {
		const deviations = questions.filter((question) => question.kind === 'deviation');
		expect(deviations.length).toBeGreaterThan(0);
		for (const question of deviations) {
			const at = priced(question);
			expect(at.countAction).not.toBe(at.basicAction);
			expect(at.countAction).toBe(question.index!.action);
			expect(at.gapPoints).toBeGreaterThanOrEqual(TIE_EPSILON_POINTS);
		}
	});

	it('asks controls just short of an index, where basic strategy still holds', () => {
		const controls = deviationQuestions('test', RULE_SET, TAGS, grids, 23).filter(
			(question) => question.kind === 'control'
		);
		expect(controls.length).toBeGreaterThan(0);
		for (const question of controls) {
			const at = priced(question);
			expect(at.countAction).toBe(at.basicAction);
			const side = Math.sign(question.index!.from);
			expect(question.trueCount).toBe(question.index!.from - side);
			const atIndex = priceDecision(
				questionState(question, RULE_SET, TAGS),
				grids.get(question.index!.from)!
			)!;
			expect(atIndex.countAction).toBe(question.index!.action);
		}
	});

	it('names the index the play switches at, not just the count it is asked at', () => {
		for (const question of questions.filter((q) => q.kind === 'deviation')) {
			const { from } = question.index!;
			expect(from).not.toBe(0);
			expect(Math.sign(from)).toBe(Math.sign(question.trueCount));
			expect(Math.abs(question.trueCount)).toBeGreaterThanOrEqual(Math.abs(from));
		}
	});

	it('keeps Easy to the counts it was priced at for Easy', () => {
		const easyCounts = planDrill('deviation', 'easy', RULE_SET, TAGS).counts;
		const easyGrids = new Map(easyCounts.map((count) => [count, grids.get(count)!]));
		const easy = deviationQuestions('easy', RULE_SET, TAGS, easyGrids, 8);
		expect(easy).toHaveLength(DECISION_QUESTIONS.easy);
		expect(easy.every((question) => easyCounts.includes(question.trueCount))).toBe(true);
	});
});

describe('the Counting drill', () => {
	it('draws each checkpoint a number of rounds inside its mode', () => {
		for (const mode of ['easy', 'hard', 'test'] as const) {
			const rounds = checkpointRounds(mode, 99);
			expect(rounds).toHaveLength(COUNT_CHECKPOINTS[mode]);
			const { minRounds, maxRounds } = COUNTING_PACE[mode];
			for (const count of rounds) {
				expect(count).toBeGreaterThanOrEqual(minRounds);
				expect(count).toBeLessThanOrEqual(maxRounds);
			}
		}
	});

	it('plays each round out to basic strategy, every card counted', () => {
		const flat = grids.get(0)!;
		let game = createGame(RULE_SET, createShoe(RULE_SET, TAGS, 42));
		let before = 0;
		for (let round = 0; round < 20; round += 1) {
			if (game.shoe.needsShuffle()) before = 0;
			game = dealCountingRound(preRound(game), flat);
			expect(game.phase).toBe('settled');
			const seen = [...game.dealer.cards, ...game.hands.flatMap((hand) => hand.cards)];
			const tagged = seen.reduce((sum, rank) => sum + TAGS[rank], 0);
			expect(game.shoe.runningCount()).toBe(before + tagged);
			before = game.shoe.runningCount();
		}
	});
});
