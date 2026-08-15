import { describe, it, expect } from 'vitest';

import { RANKS, RANK_INDEX } from '#utils/ev/cards';
import { baseComposition } from '#utils/ev/composition';
import { dealIndex, dealWeights } from '#utils/ev/deal';
import { DEFAULT_RULE_SET, type RuleSet } from '#utils/ev/rules';
import { computeAllEvTables, type EvTables } from '#utils/ev/tables';

/**
 * A peeking six-deck game, the shape almost every published house-edge figure is
 * quoted for. Pinned rather than inherited so moving a default cannot silently
 * re-baseline the rule differences below.
 */
const PEEK_S17: RuleSet = {
	...DEFAULT_RULE_SET,
	decks: 6,
	dealerHitsSoft17: false,
	dealerPeek: true,
	blackjackPayout: '3:2',
	surrender: 'none',
	splitLimit: 4,
	doubleAfterSplit: true,
	resplitAces: false,
	hitSplitAces: false,
};

/** Averages are the expensive half of a full table, so each variation is computed once. */
const cache = new Map<string, EvTables>();
function tablesFor(overrides: Partial<RuleSet> = {}, count = 0): EvTables {
	const key = JSON.stringify([overrides, count]);
	let tables = cache.get(key);
	if (!tables) {
		tables = computeAllEvTables({ ...PEEK_S17, ...overrides }, count);
		cache.set(key, tables);
	}
	return tables;
}

/** The average EV of one round, in percentage points of a unit wagered. */
function averageEv(overrides: Partial<RuleSet> = {}, count = 0): number {
	return tablesFor(overrides, count).average.countEvPercent;
}

describe('dealWeights', () => {
	const weights = dealWeights(baseComposition(PEEK_S17));

	it('is a probability distribution over every opening', () => {
		let total = 0;
		for (const weight of weights) total += weight;
		expect(total).toBeCloseTo(1, 10);
	});

	it('leaves the reversed-pair slots empty, holding each hand once', () => {
		for (let low = 0; low < RANKS.length; low += 1) {
			for (let high = 0; high < low; high += 1) {
				for (let upcard = 0; upcard < RANKS.length; upcard += 1) {
					expect(weights[dealIndex(low, high, upcard)]).toBe(0);
				}
			}
		}
	});

	it('deals a natural at the textbook rate for a six-deck shoe', () => {
		// 2 * (96/312) * (24/311): either order of the ten and the ace.
		let natural = 0;
		for (let upcard = 0; upcard < RANKS.length; upcard += 1) {
			natural += weights[dealIndex(RANK_INDEX.T, RANK_INDEX.A, upcard)];
		}
		expect(natural * 100).toBeCloseTo(4.7489, 3);
		expect(tablesFor().average.naturalPercent).toBeCloseTo(4.7489, 3);
	});
});

describe('average EV', () => {
	it('costs the house a fraction of a percent on a standard six-deck game', () => {
		// Published basic-strategy figures put this near -0.4%. The engine reads a
		// touch optimistic because it leaves the player's own cards in the shoe --
		// see docs/ev-model.md §The average hand.
		expect(averageEv()).toBeGreaterThan(-0.6);
		expect(averageEv()).toBeLessThan(-0.1);
	});

	it('is the baseline itself at a neutral count', () => {
		const { average } = tablesFor();
		expect(average.countEvPercent).toBe(average.baseEvPercent);
		expect(average.deltaPercentPoints).toBe(0);
	});

	it('rises with the count and falls against it', () => {
		expect(averageEv({}, 5)).toBeGreaterThan(averageEv());
		expect(averageEv({}, -5)).toBeLessThan(averageEv());
	});

	it('reports the delta against the unadjusted shoe', () => {
		const { average } = tablesFor({}, 5);
		expect(average.baseEvPercent).toBeCloseTo(averageEv(), 10);
		expect(average.deltaPercentPoints).toBeCloseTo(
			average.countEvPercent - average.baseEvPercent,
			10
		);
	});
});

/**
 * The average's own accuracy is limited by the simplifications the grids rest on,
 * but the *differences* between rule sets are the part it tracks closely, since
 * those move the play grids it sums. Each band below brackets the published cost
 * of the rule.
 */
describe('average EV against published rule costs', () => {
	it('charges about 0.22 points for a dealer who hits soft 17', () => {
		const cost = averageEv() - averageEv({ dealerHitsSoft17: true });
		expect(cost).toBeGreaterThan(0.18);
		expect(cost).toBeLessThan(0.26);
	});

	it('charges about 1.4 points for a 6:5 natural', () => {
		const cost = averageEv() - averageEv({ blackjackPayout: '6:5' });
		expect(cost).toBeGreaterThan(1.25);
		expect(cost).toBeLessThan(1.5);
	});

	it('pays about 0.08 points for late surrender', () => {
		const gain = averageEv({ surrender: 'late' }) - averageEv();
		expect(gain).toBeGreaterThan(0.05);
		expect(gain).toBeLessThan(0.12);
	});

	it('charges about 0.11 points for a no-hole-card table', () => {
		// The extra stakes on doubles and splits that a dealer natural takes, and
		// nothing more: a player natural still pushes against one.
		const cost = averageEv() - averageEv({ dealerPeek: false });
		expect(cost).toBeGreaterThan(0.06);
		expect(cost).toBeLessThan(0.18);
	});

	it('pays for the right to split and to double after one', () => {
		expect(averageEv()).toBeGreaterThan(averageEv({ doubleAfterSplit: false }));
		expect(averageEv()).toBeGreaterThan(averageEv({ splitLimit: 1 }));
	});
});

describe('blackjack payout', () => {
	it('moves the average without touching a play grid', () => {
		const short = tablesFor({ blackjackPayout: '6:5' });
		const full = tablesFor();
		// The payout is applied outside the engine precisely so it cannot
		// invalidate a cached grid -- see docs/ev-model.md §Rules that don't reach
		// the maths.
		expect(short.hard.rows).toEqual(full.hard.rows);
		expect(short.soft.rows).toEqual(full.soft.rows);
		expect(short.split.rows).toEqual(full.split.rows);
		expect(short.average.countEvPercent).toBeLessThan(full.average.countEvPercent);
	});

	it('prices the natural at the stated odds', () => {
		// Paying 1:1 instead of 3:2 gives up half a unit on each natural that is
		// not pushed by a dealer natural, which is nearly every one of them.
		const cost = averageEv() - averageEv({ blackjackPayout: '1:1' });
		const naturals = tablesFor().average.naturalPercent;
		expect(cost).toBeGreaterThan(0.5 * naturals * 0.95);
		expect(cost).toBeLessThan(0.5 * naturals);
	});
});
