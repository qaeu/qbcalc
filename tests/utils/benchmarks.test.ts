import { describe, it, expect } from 'vitest';

import { RANKS, type Rank } from '#utils/ev/cards';
import { applyTrueCountToComposition, baseComposition } from '#utils/ev/composition';
import { ShoeEv } from '#utils/ev/engine';
import { insuranceEvPercent } from '#utils/ev/insurance';
import { FAST_PRECISION, FULL_PRECISION, type Precision } from '#utils/ev/precision';
import { DEFAULT_RULE_SET, type RuleSet } from '#utils/ev/rules';
import { averageEvPercent, computeEvComparison } from '#utils/ev/tables';
import { HI_LO_TAGS } from '#utils/countingSystems';

/**
 * The engine against published figures, rather than against itself.
 *
 * `averageEv.test.ts` brackets the *differences* between rule sets, which is what
 * the engine tracks well. This file pins the absolute numbers, in both of the
 * precisions the engine offers (docs/ev-model.md §Precision modes):
 *
 * - **Fast** is what the app ships on and therefore what a user actually sees. Its
 *   block pins the cost of that choice rather than comparing it to anything
 *   published.
 * - **Full** is the deliberate run behind the sidebar's button, and it is the one
 *   the published comparisons belong to: it removes the player's own two cards
 *   before pricing the hand, which is the whole of the gap fast mode leaves.
 *
 * Insurance is priced off the composition alone and never enters the recursion, so
 * it is identical in both and is asserted once.
 *
 * Sources: Wizard of Odds' six-deck H17 expected-return appendix and its rule
 * variations table; the dealer bust rates in its dealer-outcome tables.
 */

/**
 * A peeking six-deck game, the shape almost every published figure is quoted for.
 * Pinned rather than inherited so moving a default cannot re-baseline anything
 * below.
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

/** Whole-shoe averages are seconds of recursion each, so every rule set is walked once. */
const averages = new Map<string, number>();
function averageEv(overrides: Partial<RuleSet> = {}, precision = FAST_PRECISION): number {
	const key = `${precision.drawCap}|${precision.removePlayerCards}|${JSON.stringify(overrides)}`;
	let ev = averages.get(key);
	if (ev === undefined) {
		const ruleSet = { ...PEEK_S17, ...overrides };
		ev = averageEvPercent(
			new ShoeEv(ruleSet, precision).analyzeAverage(baseComposition(ruleSet)),
			ruleSet.blackjackPayout
		);
		averages.set(key, ev);
	}
	return ev;
}

/** Comfortably past the few seconds a handful of shoe averages costs on CI. */
const TIMEOUT_MS = 120_000;

describe('insurance against published odds', () => {
	/**
	 * The figure usually quoted for insurance is -7.69%, i.e. -1/13, which is what
	 * `3·(4/13) - 1` gives when the ten density is read off a full pack. It is the
	 * no-removal answer: the dealer's ace is still in the shoe being counted. The
	 * engine takes the ace out, so it lands a little above that, and further above
	 * it the fewer the decks.
	 */
	it('prices the hole card off the shoe the ace has left', () => {
		expect(insuranceEvPercent(baseComposition({ ...PEEK_S17, decks: 1 }))).toBeCloseTo(
			// 3·(16/51) - 1, the textbook single-deck value.
			-5.8824,
			3
		);
		expect(insuranceEvPercent(baseComposition({ ...PEEK_S17, decks: 6 }))).toBeCloseTo(
			// 3·(96/311) - 1.
			-7.3955,
			3
		);
		expect(insuranceEvPercent(baseComposition({ ...PEEK_S17, decks: 8 }))).toBeCloseTo(
			-7.4699,
			3
		);
	});

	it('approaches the no-removal -7.69% as the shoe deepens', () => {
		const noRemoval = (3 * (4 / 13) - 1) * 100;
		const eight = insuranceEvPercent(baseComposition({ ...PEEK_S17, decks: 8 }));
		const one = insuranceEvPercent(baseComposition({ ...PEEK_S17, decks: 1 }));
		expect(eight).toBeGreaterThan(noRemoval);
		expect(eight - noRemoval).toBeLessThan(one - noRemoval);
	});
});

describe('dealer outcomes against published tables', () => {
	/** Any cell carries its upcard's dealer bust probability; hard 16 is as good as any. */
	function bustPercent(overrides: Partial<RuleSet>): Map<Rank, number> {
		const comparison = computeEvComparison(
			{ ...PEEK_S17, ...overrides },
			0,
			undefined,
			[16],
			RANKS as Rank[]
		);
		return new Map(comparison.rows.map((row) => [row.upcard, row.dealerBustPercent]));
	}

	it('busts a six at the published rate', { timeout: TIMEOUT_MS }, () => {
		// Wizard of Odds gives 43.9144% for six decks, H17; the S17 figure is the
		// widely quoted 42.28%. Within a hundredth of a point either way -- the
		// dealer recursion is exact given the shoe it is handed, and a bust rate
		// never asks about the player's cards, so simplification 1 cannot reach it.
		expect(bustPercent({ dealerHitsSoft17: true }).get('6')).toBeCloseTo(43.9144, 1);
		expect(bustPercent({}).get('6')).toBeCloseTo(42.28, 1);
	});

	it(
		'leaves the ten and below-ten upcards untouched by H17',
		{ timeout: TIMEOUT_MS },
		() => {
			// With a ten up and the ace hole card peeked away, the dealer can never hold
			// a soft 17: any ace drawn later meets a total of 11 or more and counts one.
			// So H17 must be a no-op for 7 through T, and must move only 2-6 and A.
			const s17 = bustPercent({});
			const h17 = bustPercent({ dealerHitsSoft17: true });
			for (const upcard of ['7', '8', '9', 'T'] as Rank[]) {
				expect(h17.get(upcard)).toBeCloseTo(s17.get(upcard) as number, 10);
			}
			for (const upcard of ['2', '6', 'A'] as Rank[]) {
				expect(h17.get(upcard)).toBeGreaterThan(s17.get(upcard) as number);
			}
		}
	);

	it(
		'prices hard 16 against a ten where the published tables do',
		{ timeout: TIMEOUT_MS },
		() => {
			// Wizard of Odds' six-deck H17 appendix gives -0.540188 for standing. The
			// engine reads -0.53952, and prefers hitting by a tenth of a point, as
			// basic strategy does.
			const rows = computeEvComparison(
				{ ...PEEK_S17, dealerHitsSoft17: true },
				0,
				undefined,
				[16],
				['T'] as Rank[]
			).rows;
			const stand = rows[0].baseActions.find((action) => action.action === 'S');
			const hit = rows[0].baseActions.find((action) => action.action === 'H');
			expect(stand?.evPercent).toBeCloseTo(-54.02, 0);
			expect(stand?.evPercent).toBeCloseTo(-53.952, 2);
			expect(hit?.evPercent).toBeGreaterThan(stand?.evPercent as number);
			expect(rows[0].optimalAction).toBe('H');
		}
	);
});

describe('house edge in the precision the app ships on', () => {
	/**
	 * Fast mode leaves the player's own cards in the shoe, which is the whole of
	 * the offset below -- see docs/ev-model.md §Precision modes. These pin what a
	 * user sees by default; the published comparisons are in the full-mode block.
	 */
	it(
		'reads about 0.08 points below full mode on a six-deck game',
		{ timeout: TIMEOUT_MS },
		() => {
			const fast = averageEv({ dealerHitsSoft17: true });
			const full = averageEv({ dealerHitsSoft17: true }, FULL_PRECISION);
			expect(fast).toBeCloseTo(-0.706, 2);
			expect(full - fast).toBeGreaterThan(0.05);
			expect(full - fast).toBeLessThan(0.12);
		}
	);

	it(
		'keeps only a fraction of what a shallow shoe is worth',
		{ timeout: TIMEOUT_MS },
		() => {
			// The published gain for a single deck over eight is 0.48 points. Removal is
			// most of that, and fast mode skips it, so about a quarter survives.
			const gain = averageEv({ decks: 1 }) - averageEv({ decks: 8 });
			expect(gain).toBeCloseTo(0.136, 2);
			expect(gain).toBeLessThan(0.48);
		}
	);
});

describe('house edge against published figures, in full mode', () => {
	/** Every figure in this block is priced at `FULL_PRECISION`. */
	const full: Precision = FULL_PRECISION;

	it(
		'lands within 0.02 points of the published six-deck edge',
		{ timeout: TIMEOUT_MS },
		() => {
			// Wizard of Odds: -0.6151% for six decks, H17, DAS, resplit to four. The
			// residual is composition-dependent play: the published figure is for a
			// player who reads their own two cards, where these grids know a total.
			const published = -0.6151;
			const ours = averageEv({ dealerHitsSoft17: true }, full);
			expect(ours).toBeCloseTo(-0.6276, 3);
			expect(published - ours).toBeGreaterThan(0);
			expect(published - ours).toBeLessThan(0.02);
		}
	);

	it(
		'turns a single deck positive, as the published tables do',
		{ timeout: TIMEOUT_MS },
		() => {
			// Single deck, S17, DAS, no surrender is quoted a shade either side of
			// +0.15% depending on the resplit rules.
			expect(averageEv({ decks: 1 }, full)).toBeCloseTo(0.145, 2);
		}
	);

	it('overshoots what a shallow shoe is worth', { timeout: TIMEOUT_MS }, () => {
		// The published gain for a single deck over eight is 0.48 points. Removing
		// the player's cards recovers it and then some: the removal is applied to
		// every hand at once, where a real shoe deals them one round at a time.
		const gain = averageEv({ decks: 1 }, full) - averageEv({ decks: 8 }, full);
		expect(gain).toBeCloseTo(0.586, 2);
		expect(gain).toBeGreaterThan(0.48);
	});
});

describe('count sensitivity against published figures', () => {
	it(
		'gains about half a point of edge per Hi-Lo true count',
		{ timeout: TIMEOUT_MS },
		() => {
			// The usual published figure for Hi-Lo is ~0.5 points per true count, which
			// is also what the calculators that take it as a flat input default to. This
			// is a slope rather than an absolute, so the offset above cancels out of it.
			const ruleSet = { ...PEEK_S17, dealerHitsSoft17: true };
			const base = baseComposition(ruleSet);
			const at = (trueCount: number) =>
				averageEvPercent(
					new ShoeEv(ruleSet).analyzeAverage(
						applyTrueCountToComposition(base, HI_LO_TAGS, trueCount)
					),
					ruleSet.blackjackPayout
				);
			const slope = (at(4) - at(-4)) / 8;
			expect(slope).toBeGreaterThan(0.45);
			expect(slope).toBeLessThan(0.6);
		}
	);
});
