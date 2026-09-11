import { describe, it, expect } from 'vitest';

import { formatClock, handPhrase, indexPhrase, scoreEntry } from '#utils/train/run';

describe('the words a verdict is written in', () => {
	it('reads a hand as a player says it', () => {
		expect(handPhrase(['9', '7'], 'T')).toBe('hard 16 v 10');
		expect(handPhrase(['A', '7'], 'A')).toBe('soft 18 v ace');
		expect(handPhrase(['8', '8'], '6')).toBe('pair of 8s v 6');
		expect(handPhrase(['A', 'A'], '2')).toBe('pair of aces v 2');
		expect(handPhrase(['A', '4', '3'], '3')).toBe('soft 18 v 3');
	});

	it('names an index from above or below', () => {
		expect(indexPhrase({ action: 'S', from: 2 }, 'deviation')).toBe('stands from TC +2');
		expect(indexPhrase({ action: 'H', from: -1 }, 'deviation')).toBe(
			'hits at TC -1 and below'
		);
		expect(indexPhrase({ action: 'D', from: 3 }, 'control')).toBe(
			'doubles only from TC +3'
		);
	});

	it('times a run as a stopwatch reads', () => {
		expect(formatClock(0)).toBe('0:00');
		expect(formatClock(67_900)).toBe('1:07');
	});
});

describe('scoring a run', () => {
	it('counts the right answers and adds up the answering time', () => {
		const run = {
			drill: 'counting' as const,
			mode: 'easy' as const,
			seed: 7,
			records: [
				{
					checkpoint: 1,
					graded: { answer: 3, runningCount: 3, expected: 3, correct: true },
					timeMs: 1200.4,
				},
				{
					checkpoint: 2,
					graded: { answer: null, runningCount: 1, expected: 1, correct: false },
					timeMs: 800,
				},
			],
		};
		const entry = scoreEntry(run, 'Hi-Lo', new Date('2026-09-11T00:00:00Z'));
		expect(entry).toEqual({
			correct: 1,
			total: 2,
			timeMs: 2000,
			date: '2026-09-11T00:00:00.000Z',
			seed: 7,
			rules: 'Hi-Lo',
		});
	});
});
