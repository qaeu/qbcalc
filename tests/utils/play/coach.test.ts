import { describe, it, expect } from 'vitest';

import type { Rank } from '#utils/ev/cards';
import { DEFAULT_RULE_SET, type RuleSet } from '#utils/ev/rules';
import { HI_LO_TAGS } from '#utils/settings/countingSystems';
import { computeEvWorkerResponse, type PlayGrids } from '#utils/evWorkerProtocol';
import { gradeDecision } from '#utils/play/coach';
import { applyAction, createGame, startRound, type GameState } from '#utils/play/game';

import { scriptedShoe } from './scriptedShoe';

/** Two decks: the same maths as six, a fraction of the enumeration. */
const RULE_SET: RuleSet = {
	...DEFAULT_RULE_SET,
	decks: 2,
	insurance: false,
	dealerPeek: true,
	surrender: 'none',
};

function gridsAt(trueCount: number, ruleSet: RuleSet = RULE_SET): PlayGrids {
	const response = computeEvWorkerResponse({
		requestId: 1,
		scope: 'play',
		ruleSet,
		trueCount,
		tags: HI_LO_TAGS,
	});
	if (response.status !== 'success' || response.scope !== 'play') {
		throw new Error('expected a play-scope result');
	}
	return response.result;
}

function deal(script: readonly Rank[], ruleSet: RuleSet = RULE_SET): GameState {
	return startRound(createGame(ruleSet, scriptedShoe(script)), 10);
}

/** Player 9,7 against a ten -- the classic 16 vs T. */
const SIXTEEN_VS_TEN: Rank[] = ['9', 'T', '7', '5'];

describe('grading a decision', () => {
	const flat = gridsAt(0);

	it('costs nothing when the optimal action is taken', () => {
		const grading = gradeDecision(deal(SIXTEEN_VS_TEN), 'H', flat, 0);
		expect(grading).not.toBeNull();
		expect(grading!.countAction).toBe('H');
		expect(grading!.basicAction).toBe('H');
		expect(grading!.evLostPercent).toBe(0);
		expect(grading!.basicError).toBe(false);
		expect(grading!.deviationError).toBe(false);
	});

	it('charges a misplay the EV it gave up', () => {
		const grading = gradeDecision(deal(SIXTEEN_VS_TEN), 'S', flat, 0)!;
		expect(grading.chosen).toBe('S');
		expect(grading.evLostPercent).toBeLessThan(0);
		expect(grading.chosenEvPercent).toBeLessThan(0);
		// A basic-strategy error: the count had nothing to say about it.
		expect(grading.basicError).toBe(true);
		expect(grading.deviationError).toBe(false);
	});

	it('reports the whole count the grids were priced at', () => {
		expect(gradeDecision(deal(SIXTEEN_VS_TEN), 'H', flat, 0)!.trueCount).toBe(0);
		expect(gradeDecision(deal(SIXTEEN_VS_TEN), 'H', flat, 2.4)!.trueCount).toBe(2);
	});

	it('has nothing to say when the grids have not arrived', () => {
		const empty: PlayGrids = { hard: new Map(), soft: new Map(), split: new Map() };
		expect(gradeDecision(deal(SIXTEEN_VS_TEN), 'H', empty, 0)).toBeNull();
	});

	it('has nothing to say once the hand is no longer acting', () => {
		const stood = applyAction(deal(SIXTEEN_VS_TEN), 'S');
		expect(stood.phase).toBe('dealer');
		expect(gradeDecision(stood, 'S', flat, 0)).toBeNull();
	});
});

describe('the 16 vs T deviation', () => {
	it('hits at a flat shoe and stands at a high count', () => {
		const flat = gradeDecision(deal(SIXTEEN_VS_TEN), 'H', gridsAt(0), 0)!;
		expect(flat.countAction).toBe('H');

		const rich = gradeDecision(deal(SIXTEEN_VS_TEN), 'H', gridsAt(5), 5)!;
		// Basic strategy has not moved -- the shoe has.
		expect(rich.basicAction).toBe('H');
		expect(rich.countAction).toBe('S');
		expect(rich.deviationError).toBe(true);
		expect(rich.basicError).toBe(false);
		expect(rich.evLostPercent).toBeLessThan(0);
	});

	it('grades the deviation itself as the best action going', () => {
		const grading = gradeDecision(deal(SIXTEEN_VS_TEN), 'S', gridsAt(5), 5)!;
		expect(grading.chosen).toBe(grading.countAction);
		expect(grading.evLostPercent).toBe(0);
		expect(grading.deviationError).toBe(false);
	});
});

describe('only the actions the table allows', () => {
	const flat = gridsAt(0);

	it('will not recommend a double once a card has been drawn', () => {
		// Hard 11 against a six: the textbook double, while it is still two cards.
		const twoCards = gradeDecision(deal(['5', '6', '6', '9']), 'H', flat, 0)!;
		expect(twoCards.countAction).toBe('D');

		const threeCards = applyAction(deal(['2', '6', '3', '9', '6']), 'H');
		expect(threeCards.hands[0].total).toBe(11);
		const graded = gradeDecision(threeCards, 'H', flat, 0)!;
		expect(graded.countAction).toBe('H');
		expect(graded.basicAction).toBe('H');
		expect(graded.evLostPercent).toBe(0);
	});

	it('will not recommend a surrender on three cards', () => {
		const ruleSet: RuleSet = { ...RULE_SET, surrender: 'late' };
		const late = gridsAt(0, ruleSet);

		const twoCards = gradeDecision(deal(['T', 'T', '6', '5'], ruleSet), 'R', late, 0)!;
		expect(twoCards.countAction).toBe('R');
		expect(twoCards.evLostPercent).toBe(0);

		const threeCards = applyAction(deal(['2', 'T', '4', '5', 'T'], ruleSet), 'H');
		expect(threeCards.hands[0].total).toBe(16);
		const graded = gradeDecision(threeCards, 'H', late, 0)!;
		expect(graded.countAction).not.toBe('R');
		expect(graded.basicAction).not.toBe('R');
	});

	it('prices a splittable pair off the splits grid', () => {
		// 8,8 against a nine: split, which only the splits grid has a price for.
		const grading = gradeDecision(deal(['8', '9', '8', '5']), 'P', flat, 0)!;
		expect(grading.countAction).toBe('P');
		expect(grading.evLostPercent).toBe(0);
	});

	it('falls back to the hand total once the split budget is spent', () => {
		const ruleSet: RuleSet = { ...RULE_SET, splitLimit: 1 };
		const grids = gridsAt(0, ruleSet);
		const grading = gradeDecision(deal(['8', '9', '8', '5'], ruleSet), 'H', grids, 0)!;
		expect(grading.countAction).not.toBe('P');
		// Hard 16 against a nine, which basic strategy hits.
		expect(grading.countAction).toBe('H');
	});
});
