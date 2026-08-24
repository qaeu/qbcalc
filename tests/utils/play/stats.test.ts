import { describe, it, expect, afterEach } from 'vitest';

import type { Grading } from '#utils/play/coach';
import {
	EMPTY_PLAY_STATS,
	evDeviation,
	optimalPlayPercent,
	recordDecision,
	recordRound,
	type PlayStats,
} from '#utils/play/stats';
import { loadPlayStats, resetPlayStats, savePlayStats } from '#utils/storage';

const PLAY_STATS_KEY = 'qbcalc:play-stats';

function grading(overrides: Partial<Grading> = {}): Grading {
	return {
		chosen: 'H',
		basicAction: 'H',
		countAction: 'H',
		evLostPercent: 0,
		chosenEvPercent: -20,
		chosenSecondMoment: 1,
		basicError: false,
		deviationError: false,
		trueCount: 0,
		...overrides,
	};
}

describe('accumulating decisions', () => {
	it('folds the chosen action EV in at the money on the hand', () => {
		const stats = recordDecision(EMPTY_PLAY_STATS, grading(), 25);
		expect(stats.decisions).toBe(1);
		expect(stats.optimalDecisions).toBe(1);
		// -20% of a 25 wager.
		expect(stats.ev).toBeCloseTo(-5, 10);
		expect(stats.evLost).toBe(0);
	});

	it('charges a basic-strategy error to `evLost`, positive', () => {
		const stats = recordDecision(
			EMPTY_PLAY_STATS,
			grading({ chosen: 'S', basicError: true, evLostPercent: -4, chosenEvPercent: -24 }),
			50
		);
		expect(stats.basicErrors).toBe(1);
		expect(stats.deviationErrors).toBe(0);
		expect(stats.optimalDecisions).toBe(0);
		expect(stats.evLost).toBeCloseTo(2, 10);
		expect(stats.ev).toBeCloseTo(-12, 10);
	});

	it('files a missed deviation separately', () => {
		const stats = recordDecision(
			EMPTY_PLAY_STATS,
			grading({ countAction: 'S', deviationError: true, evLostPercent: -1 }),
			10
		);
		expect(stats.basicErrors).toBe(0);
		expect(stats.deviationErrors).toBe(1);
		expect(stats.optimalDecisions).toBe(0);
		expect(stats.evLost).toBeCloseTo(0.1, 10);
	});

	it('counts a correctly taken deviation as optimal', () => {
		const stats = recordDecision(
			EMPTY_PLAY_STATS,
			grading({ chosen: 'S', basicAction: 'H', countAction: 'S', basicError: true }),
			10
		);
		expect(stats.optimalDecisions).toBe(1);
		expect(stats.evLost).toBe(0);
	});

	it('leaves the record it was handed alone', () => {
		recordDecision(EMPTY_PLAY_STATS, grading(), 10);
		expect(EMPTY_PLAY_STATS.decisions).toBe(0);
	});
});

describe('accumulating rounds', () => {
	it('adds the money and the hands played', () => {
		let stats = recordRound(EMPTY_PLAY_STATS, -10, 1);
		stats = recordRound(stats, 25, 2);
		expect(stats.rounds).toBe(2);
		expect(stats.hands).toBe(3);
		expect(stats.av).toBe(15);
	});
});

describe('the derived figures', () => {
	it('reports optimal play as a percentage, or nothing before the first decision', () => {
		expect(optimalPlayPercent(EMPTY_PLAY_STATS)).toBeNull();
		let stats = recordDecision(EMPTY_PLAY_STATS, grading(), 10);
		stats = recordDecision(stats, grading({ basicError: true, chosen: 'S' }), 10);
		stats = recordDecision(stats, grading(), 10);
		stats = recordDecision(stats, grading(), 10);
		expect(optimalPlayPercent(stats)).toBeCloseTo(75, 10);
	});

	it('suppresses EV deviation until there is a variance to divide by', () => {
		const untouched: PlayStats = { ...EMPTY_PLAY_STATS, av: 100, ev: 50 };
		expect(evDeviation(untouched)).toBeNull();

		const real: PlayStats = { ...EMPTY_PLAY_STATS, av: -10, ev: -30, variance: 100 };
		expect(evDeviation(real)).toBeCloseTo(2, 10);
	});
});

describe('the stored record', () => {
	afterEach(() => {
		localStorage.clear();
	});

	it('round-trips through storage', () => {
		let stats = recordDecision(EMPTY_PLAY_STATS, grading({ evLostPercent: -3 }), 20);
		stats = recordRound(stats, -20, 1);
		savePlayStats(stats);
		expect(loadPlayStats()).toEqual(stats);
	});

	it('falls back to nothing when the stored version is not this one', () => {
		localStorage.setItem(
			PLAY_STATS_KEY,
			JSON.stringify({ ...EMPTY_PLAY_STATS, version: 99 })
		);
		expect(loadPlayStats()).toBeNull();
	});

	it('falls back to nothing when a field is missing', () => {
		localStorage.setItem(PLAY_STATS_KEY, JSON.stringify({ version: 1, av: 10 }));
		expect(loadPlayStats()).toBeNull();
	});

	it('clears the key on reset', () => {
		savePlayStats(EMPTY_PLAY_STATS);
		resetPlayStats();
		expect(localStorage.getItem(PLAY_STATS_KEY)).toBeNull();
		expect(loadPlayStats()).toBeNull();
	});
});
