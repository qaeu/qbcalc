import { describe, it, expect } from 'vitest';

import { ACE_FIVE_TAGS } from '#utils/ev/composition';
import { HI_LO_TAGS } from '#utils/settings/countingSystems';
import { DEFAULT_RULE_SET } from '#utils/ev/rules';
import {
	BOARD_SIZE,
	bestOn,
	boardKey,
	compareEntries,
	describeRules,
	isScoreBoards,
	recordScore,
	type ScoreEntry,
} from '#utils/train/scores';

const entry = (correct: number, total: number, timeMs: number): ScoreEntry => ({
	correct,
	total,
	timeMs,
	date: '2026-09-11T12:00:00.000Z',
	seed: 1,
	rules: '6 decks · S17',
});

const H17 = { ...DEFAULT_RULE_SET, dealerHitsSoft17: true };

describe('which board a run goes on', () => {
	it('keys Basic on the rules alone', () => {
		expect(boardKey('basic', 'easy', DEFAULT_RULE_SET, HI_LO_TAGS)).toBe(
			boardKey('basic', 'easy', DEFAULT_RULE_SET, ACE_FIVE_TAGS)
		);
		expect(boardKey('basic', 'easy', DEFAULT_RULE_SET, HI_LO_TAGS)).not.toBe(
			boardKey('basic', 'easy', H17, HI_LO_TAGS)
		);
	});

	it('keys Counting on the tags alone', () => {
		expect(boardKey('counting', 'hard', DEFAULT_RULE_SET, HI_LO_TAGS)).toBe(
			boardKey('counting', 'hard', H17, HI_LO_TAGS)
		);
		expect(boardKey('counting', 'hard', DEFAULT_RULE_SET, HI_LO_TAGS)).not.toBe(
			boardKey('counting', 'hard', DEFAULT_RULE_SET, ACE_FIVE_TAGS)
		);
	});

	it('keys Deviation on both, and every drill on its mode', () => {
		const key = boardKey('deviation', 'test', DEFAULT_RULE_SET, HI_LO_TAGS);
		expect(key).not.toBe(boardKey('deviation', 'test', H17, HI_LO_TAGS));
		expect(key).not.toBe(boardKey('deviation', 'test', DEFAULT_RULE_SET, ACE_FIVE_TAGS));
		expect(key).not.toBe(boardKey('deviation', 'hard', DEFAULT_RULE_SET, HI_LO_TAGS));
	});

	it('names the rules the way a table card does', () => {
		expect(describeRules({ ...H17, surrender: 'late' })).toBe(
			'6 decks · H17 · DAS · Split to 4 · Hit split aces · No peek · Late surrender'
		);
	});
});

describe('recording a run', () => {
	it('ranks more right first, then the faster run', () => {
		expect(compareEntries(entry(9, 10, 50_000), entry(8, 10, 10_000))).toBeLessThan(0);
		expect(compareEntries(entry(9, 10, 10_000), entry(9, 10, 20_000))).toBeLessThan(0);
	});

	it('places an equal run beneath the one that got there first', () => {
		const first = recordScore({}, 'k', entry(8, 10, 30_000));
		const second = recordScore(first.boards, 'k', entry(8, 10, 30_000));
		expect(second.rank).toBe(2);
		expect(second.newBest).toBe(false);
	});

	it('keeps a top five, and says when a run misses it', () => {
		let boards = {};
		for (let at = 0; at < BOARD_SIZE; at += 1) {
			boards = recordScore(boards, 'k', entry(10, 10, 10_000 + at)).boards;
		}
		const slow = recordScore(boards, 'k', entry(9, 10, 1));
		expect(slow.rank).toBeNull();
		expect(slow.board).toHaveLength(BOARD_SIZE);

		const best = recordScore(boards, 'k', entry(10, 10, 5_000));
		expect(best).toMatchObject({ rank: 1, newBest: true });
		expect(best.board).toHaveLength(BOARD_SIZE);
		expect(bestOn(best.boards, 'k')?.timeMs).toBe(5_000);
	});

	it('leaves the other boards as they were', () => {
		const one = recordScore({}, 'a', entry(1, 10, 1)).boards;
		const two = recordScore(one, 'b', entry(2, 10, 1)).boards;
		expect(two.a).toEqual(one.a);
	});
});

describe('a stored set of boards', () => {
	const key = boardKey('basic', 'easy', DEFAULT_RULE_SET, HI_LO_TAGS);

	it('passes when every board and run is well formed', () => {
		expect(isScoreBoards({ [key]: [entry(9, 10, 1000)] })).toBe(true);
		expect(isScoreBoards({})).toBe(true);
	});

	it('fails a run that is not one', () => {
		expect(isScoreBoards({ [key]: [{ ...entry(9, 10, 1000), correct: 11 }] })).toBe(
			false
		);
		expect(isScoreBoards({ [key]: [{ ...entry(9, 10, 1000), seed: 'x' }] })).toBe(false);
	});

	it('fails a board for a drill or mode this build does not offer', () => {
		expect(isScoreBoards({ 'poker:easy:x': [] })).toBe(false);
		expect(isScoreBoards({ 'basic:expert:x': [] })).toBe(false);
		expect(isScoreBoards([])).toBe(false);
	});
});
