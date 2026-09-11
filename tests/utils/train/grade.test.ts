import { describe, it, expect } from 'vitest';

import { questionState } from '#utils/train/drills';
import {
	gradeAnswer,
	gradeCheckpoint,
	nextBasis,
	priceDecision,
	ZERO_BASIS,
} from '#utils/train/grade';

import { RULE_SET, TAGS, trainGrids } from './trainGrids';

const grids = trainGrids([0, 4]);
const flat = grids.get(0)!;

/** 9,7 against a ten: hits flat, surrenders late, stands high. */
const sixteenVsTen = () =>
	questionState({ cards: ['9', '7'], upcard: 'T', hole: '8' }, RULE_SET, TAGS);

describe('pricing a decision', () => {
	it('ranks every legal action, best first', () => {
		const priced = priceDecision(sixteenVsTen(), flat)!;
		expect(priced.prices[0].action).toBe(priced.countAction);
		const evs = priced.prices.map((price) => price.evPercent);
		expect(evs).toEqual([...evs].sort((a, b) => b - a));
		expect(priced.gapPoints).toBeCloseTo(evs[0] - evs[1], 10);
	});

	it('only offers what the table allows once the hand has hit', () => {
		const state = questionState(
			{ cards: ['5', '4', '3'], upcard: 'T', hole: '8' },
			RULE_SET,
			TAGS
		);
		const actions = priceDecision(state, flat)!.prices.map((price) => price.action);
		expect(actions.sort()).toEqual(['H', 'S']);
	});
});

describe('grading an answer', () => {
	it('is right when it is the count play, and costs nothing', () => {
		const answer = priceDecision(sixteenVsTen(), flat)!.countAction;
		const graded = gradeAnswer(sixteenVsTen(), answer, flat, 0)!;
		expect(graded).toMatchObject({ chosen: answer, answer, correct: true });
		expect(graded.evLostPercent).toBe(0);
	});

	it('charges a wrong play what it gave up', () => {
		const graded = gradeAnswer(sixteenVsTen(), 'D', flat, 0)!;
		expect(graded.correct).toBe(false);
		expect(graded.evLostPercent).toBeLessThan(0);
	});

	it('marks a timeout wrong without pricing it', () => {
		const graded = gradeAnswer(sixteenVsTen(), null, flat, 0)!;
		expect(graded).toMatchObject({ chosen: null, correct: false, evLostPercent: null });
	});

	it('grades at the question count, not at basic strategy', () => {
		// 12 v 3: a hit off the top, a stand once the count is up.
		const twelveVsThree = () =>
			questionState({ cards: ['T', '2'], upcard: '3', hole: '8' }, RULE_SET, TAGS);
		const high = grids.get(4)!;
		const priced = priceDecision(twelveVsThree(), high)!;
		expect(priced).toMatchObject({ basicAction: 'H', countAction: 'S' });
		expect(gradeAnswer(twelveVsThree(), 'H', high, 4)!.correct).toBe(false);
		expect(gradeAnswer(twelveVsThree(), 'S', high, 4)!.correct).toBe(true);
	});
});

describe('grading a checkpoint', () => {
	it('against a fresh shoe, wants the running count itself', () => {
		expect(gradeCheckpoint(5, 5, ZERO_BASIS, 0)).toMatchObject({
			expected: 5,
			correct: true,
		});
		expect(gradeCheckpoint(4, 5, ZERO_BASIS, 0).correct).toBe(false);
		expect(gradeCheckpoint(4, 5, ZERO_BASIS, 1).correct).toBe(true);
	});

	it('counts a timeout as a miss', () => {
		expect(gradeCheckpoint(null, 0, ZERO_BASIS, 1).correct).toBe(false);
	});

	it('without feedback, measures from the last answer, so one slip costs one checkpoint', () => {
		// Said +3 at a true +5, then counted the next stretch's +2 perfectly.
		const first = gradeCheckpoint(3, 5, ZERO_BASIS, 0);
		expect(first.correct).toBe(false);
		const second = gradeCheckpoint(5, 7, nextBasis(first, false), 0);
		expect(second).toMatchObject({ expected: 5, correct: true });
	});

	it('with feedback, measures from the count the verdict gave', () => {
		const first = gradeCheckpoint(3, 5, ZERO_BASIS, 0);
		const second = gradeCheckpoint(5, 7, nextBasis(first, true), 0);
		expect(second).toMatchObject({ expected: 7, correct: false });
	});

	it('after a timeout, measures from the true count', () => {
		const first = gradeCheckpoint(null, 5, ZERO_BASIS, 0);
		expect(nextBasis(first, false)).toEqual({ answer: 5, runningCount: 5 });
	});
});
