import { describe, it, expect } from 'vitest';

import {
	ACE_FIVE_TAGS,
	RANKS,
	SOFT_TOTALS,
	PAIR_RANKS,
	type RuleSet,
	type TagValues,
	baseComposition,
	applyCountToComposition,
	computeEvComparison,
	computeSplitEvComparison,
} from '#utils/blackjackEv';

const RULE_SET: RuleSet = { decks: 4, dealerHitsSoft17: true };

describe('baseComposition', () => {
	it('builds a fresh shoe in half-card units', () => {
		const comp = baseComposition({ decks: 1, dealerHitsSoft17: true });
		expect(comp).toHaveLength(10);
		// Non-ten ranks: 4 cards/deck * 1 deck * 2 half-card units = 8.
		expect(comp[RANKS.indexOf('2')]).toBe(8);
		expect(comp[RANKS.indexOf('9')]).toBe(8);
		// Ten-valued ranks (T, J, Q, K) collapse to one rank: 16 cards/deck * 2 units.
		expect(comp[RANKS.indexOf('T')]).toBe(32);
		expect(comp[RANKS.indexOf('A')]).toBe(8);
	});

	it('scales linearly with deck count', () => {
		const oneDeck = baseComposition({ decks: 1, dealerHitsSoft17: true });
		const fourDecks = baseComposition({ decks: 4, dealerHitsSoft17: true });
		expect(fourDecks).toEqual(oneDeck.map((n) => n * 4));
	});
});

describe('applyCountToComposition', () => {
	const HI_LO_TAGS: TagValues = {
		'2': 1,
		'3': 1,
		'4': 1,
		'5': 1,
		'6': 1,
		'7': 0,
		'8': 0,
		'9': 0,
		T: -1,
		A: -1,
	};

	const totalCards = (comp: readonly number[]) => comp.reduce((sum, n) => sum + n, 0);

	it('shifts half a card of five density into aces per count unit under Ace-Five', () => {
		const base = baseComposition({ decks: 1, dealerHitsSoft17: true });
		const adjusted = applyCountToComposition(base, ACE_FIVE_TAGS, 2);
		expect(adjusted[RANKS.indexOf('5')]).toBe(base[RANKS.indexOf('5')] - 2);
		expect(adjusted[RANKS.indexOf('A')]).toBe(base[RANKS.indexOf('A')] + 2);
		// Neutral ranks are untouched, whatever the deck count.
		expect(adjusted[RANKS.indexOf('T')]).toBe(base[RANKS.indexOf('T')]);
		expect(applyCountToComposition(baseComposition(RULE_SET), ACE_FIVE_TAGS, 2)).toEqual(
			baseComposition(RULE_SET).map((n, index) =>
				index === RANKS.indexOf('5') ? n - 2
				: index === RANKS.indexOf('A') ? n + 2
				: n
			)
		);
	});

	it('leaves the composition alone at a count of zero', () => {
		const base = baseComposition(RULE_SET);
		expect(applyCountToComposition(base, HI_LO_TAGS, 0)).toEqual(base.slice());
	});

	it('depletes low cards and enriches high cards on a positive Hi-Lo count', () => {
		const base = baseComposition({ decks: 6, dealerHitsSoft17: true });
		const adjusted = applyCountToComposition(base, HI_LO_TAGS, 6);

		expect(adjusted[RANKS.indexOf('2')]).toBeLessThan(base[RANKS.indexOf('2')]);
		expect(adjusted[RANKS.indexOf('6')]).toBeLessThan(base[RANKS.indexOf('6')]);
		expect(adjusted[RANKS.indexOf('8')]).toBe(base[RANKS.indexOf('8')]);
		expect(adjusted[RANKS.indexOf('T')]).toBeGreaterThan(base[RANKS.indexOf('T')]);
		expect(adjusted[RANKS.indexOf('A')]).toBeGreaterThan(base[RANKS.indexOf('A')]);
	});

	it('preserves the shoe size and stays integral', () => {
		const base = baseComposition({ decks: 6, dealerHitsSoft17: true });
		for (const count of [-9, -4, 1, 5, 13]) {
			const adjusted = applyCountToComposition(base, HI_LO_TAGS, count);
			expect(totalCards(adjusted)).toBe(totalCards(base));
			expect(adjusted.every(Number.isInteger)).toBe(true);
		}
	});

	it('reverses the direction of the shift when the count flips sign', () => {
		const base = baseComposition({ decks: 6, dealerHitsSoft17: true });
		const negative = applyCountToComposition(base, HI_LO_TAGS, -6);

		expect(negative[RANKS.indexOf('2')]).toBeGreaterThan(base[RANKS.indexOf('2')]);
		expect(negative[RANKS.indexOf('T')]).toBeLessThan(base[RANKS.indexOf('T')]);
		expect(negative[RANKS.indexOf('A')]).toBeLessThan(base[RANKS.indexOf('A')]);
	});

	it('throws when every rank carries the same tag', () => {
		const base = baseComposition(RULE_SET);
		const zeroTags = Object.fromEntries(RANKS.map((rank) => [rank, 0])) as TagValues;
		expect(() => applyCountToComposition(base, zeroTags, 3)).toThrow(/no effect/i);
	});

	it('throws once the count removes more cards of a rank than exist', () => {
		const base = baseComposition({ decks: 1, dealerHitsSoft17: true });
		expect(() => applyCountToComposition(base, ACE_FIVE_TAGS, 100)).toThrow(
			/too extreme/i
		);
		expect(() => applyCountToComposition(base, ACE_FIVE_TAGS, -100)).toThrow(
			/too extreme/i
		);
	});
});

describe('computeEvComparison', () => {
	// Golden values from the reference Python implementation
	// (1 deck, H17, Ace-Five count +2, half-card units).
	const golden: Record<string, { base: number; mod: number }> = {
		'8-2': { base: -0.022614020102258103, mod: -0.006907015828013355 },
		'8-6': { base: 0.10595493706475456, mod: 0.13206283501164154 },
		'8-T': { base: -0.29623968142730495, mod: -0.30606471403988766 },
		'8-A': { base: -0.44905265427079005, mod: -0.43415487880245657 },
		'12-2': { base: -0.25064167438251495, mod: -0.2503294793682547 },
		'12-6': { base: -0.12249146529035816, mod: -0.11926370647221837 },
		'12-T': { base: -0.41416494851930863, mod: -0.42919265541978535 },
		'12-A': { base: -0.5317264125725097, mod: -0.5293405004203375 },
		'16-2': { base: -0.2844464086900959, mod: -0.27203348828830076 },
		'16-6': { base: -0.12249146529035816, mod: -0.11926370647221837 },
		'16-T': { base: -0.5642431117730301, mod: -0.5889534675911907 },
		'16-A': { base: -0.6514967734403396, mod: -0.6708949235551439 },
		'20-2': { base: 0.6341572502198931, mod: 0.6300076609865916 },
		'20-6': { base: 0.6776749210619718, mod: 0.6989031461332856 },
		'20-T': { base: 0.43812639597973013, mod: 0.40797110468981135 },
		'20-A': { base: 0.12252949764519311, mod: 0.12963394507970194 },
	};

	const totals = [8, 12, 16, 20];
	const upcards = (['2', '6', 'T', 'A'] as const).slice();
	const result = computeEvComparison(
		{ decks: 1, dealerHitsSoft17: true },
		2,
		ACE_FIVE_TAGS,
		totals,
		upcards
	);
	const byKey = new Map(result.rows.map((row) => [`${row.total}-${row.upcard}`, row]));

	it.each(Object.entries(golden))('matches the reference EV at %s', (key, expected) => {
		const row = byKey.get(key);
		expect(row).toBeDefined();
		expect(row!.baseEvPercent).toBeCloseTo(expected.base * 100, 6);
		expect(row!.countEvPercent).toBeCloseTo(expected.mod * 100, 6);
		expect(row!.deltaPercentPoints).toBeCloseTo((expected.mod - expected.base) * 100, 6);
	});

	it('improves hard 20 EV against a 6 when more aces are in the shoe', () => {
		const row = byKey.get('20-6')!;
		expect(row.deltaPercentPoints).toBeGreaterThan(0);
	});

	it('never exceeds a 100% edge in either direction', () => {
		for (const row of result.rows) {
			expect(row.baseEvPercent).toBeLessThanOrEqual(100);
			expect(row.baseEvPercent).toBeGreaterThanOrEqual(-100);
		}
	});
});

describe('optimal play', () => {
	it('recommends doubling hard 11 against a weak dealer upcard', () => {
		const result = computeEvComparison(RULE_SET, 0, ACE_FIVE_TAGS, [11], RANKS);
		const row = result.rows.find((r) => r.upcard === '6')!;
		expect(row.optimalAction).toBe('D');
	});

	it('recommends standing on a strong hard total regardless of upcard', () => {
		const result = computeEvComparison(RULE_SET, 0, ACE_FIVE_TAGS, [20], RANKS);
		for (const row of result.rows) {
			expect(row.optimalAction).toBe('S');
		}
	});

	it('recommends hitting a weak hard total against a strong dealer upcard', () => {
		const result = computeEvComparison(RULE_SET, 0, ACE_FIVE_TAGS, [16], RANKS);
		const row = result.rows.find((r) => r.upcard === 'T')!;
		expect(row.optimalAction).toBe('H');
	});
});

describe('soft totals', () => {
	it('recommends standing on soft 20 regardless of upcard', () => {
		const result = computeEvComparison(RULE_SET, 0, ACE_FIVE_TAGS, [20], RANKS, true);
		for (const row of result.rows) {
			expect(row.optimalAction).toBe('S');
		}
	});

	it('recommends doubling soft 18 (A,7) against a weak dealer upcard', () => {
		const result = computeEvComparison(RULE_SET, 0, ACE_FIVE_TAGS, [18], RANKS, true);
		const row = result.rows.find((r) => r.upcard === '6')!;
		expect(row.optimalAction).toBe('D');
	});

	it('recommends hitting soft 18 (A,7) against a strong dealer upcard', () => {
		const result = computeEvComparison(RULE_SET, 0, ACE_FIVE_TAGS, [18], RANKS, true);
		const row = result.rows.find((r) => r.upcard === 'T')!;
		expect(row.optimalAction).toBe('H');
	});

	it('recommends doubling soft 19 (A,8) only against a dealer 6 (H17)', () => {
		const result = computeEvComparison(RULE_SET, 0, ACE_FIVE_TAGS, [19], RANKS, true);
		const six = result.rows.find((r) => r.upcard === '6')!;
		const two = result.rows.find((r) => r.upcard === '2')!;
		expect(six.optimalAction).toBe('D');
		expect(two.optimalAction).toBe('S');
	});

	it('gives 0% player bust-on-hit for every soft total', () => {
		const result = computeEvComparison(
			RULE_SET,
			0,
			ACE_FIVE_TAGS,
			SOFT_TOTALS,
			RANKS,
			true
		);
		for (const row of result.rows) {
			expect(row.playerBustOnHitPercent).toBe(0);
		}
	});
});

describe('splits', () => {
	it('always recommends splitting aces', () => {
		const result = computeSplitEvComparison(RULE_SET, 0, ACE_FIVE_TAGS, ['A'], RANKS);
		for (const row of result.rows) {
			expect(row.optimalAction).toBe('P');
		}
	});

	it('recommends splitting 8s against every upcard from 2 through 9', () => {
		const weakToMediumUpcards = RANKS.filter((r) => r !== 'T' && r !== 'A');
		const result = computeSplitEvComparison(
			RULE_SET,
			0,
			ACE_FIVE_TAGS,
			['8'],
			weakToMediumUpcards
		);
		for (const row of result.rows) {
			expect(row.optimalAction).toBe('P');
		}
	});

	it('never recommends splitting 10s', () => {
		const result = computeSplitEvComparison(RULE_SET, 0, ACE_FIVE_TAGS, ['T'], RANKS);
		for (const row of result.rows) {
			expect(row.optimalAction).not.toBe('P');
		}
	});

	it('recommends splitting 9s against a weak upcard but standing against a strong one', () => {
		const result = computeSplitEvComparison(RULE_SET, 0, ACE_FIVE_TAGS, ['9'], RANKS);
		const weak = result.rows.find((r) => r.upcard === '6')!;
		const strong = result.rows.find((r) => r.upcard === 'T')!;
		expect(weak.optimalAction).toBe('P');
		expect(strong.optimalAction).toBe('S');
	});

	it('recommends doubling 5,5 (hard 10) rather than splitting it', () => {
		const result = computeSplitEvComparison(RULE_SET, 0, ACE_FIVE_TAGS, ['5'], RANKS);
		const row = result.rows.find((r) => r.upcard === '6')!;
		expect(row.optimalAction).toBe('D');
	});

	it('gives the dealer a higher bust chance showing a 6 than showing a T', () => {
		const result = computeSplitEvComparison(
			RULE_SET,
			0,
			ACE_FIVE_TAGS,
			PAIR_RANKS,
			RANKS
		);
		const six = result.rows.find((r) => r.upcard === '6' && r.pairRank === '8')!;
		const ten = result.rows.find((r) => r.upcard === 'T' && r.pairRank === '8')!;
		expect(six.dealerBustPercent).toBeGreaterThan(ten.dealerBustPercent);
	});
});

describe('bust percentages', () => {
	it('gives 0% player bust-on-hit for a total that cannot bust in one card', () => {
		const result = computeEvComparison(RULE_SET, 0, ACE_FIVE_TAGS, [8], RANKS);
		for (const row of result.rows) {
			expect(row.playerBustOnHitPercent).toBe(0);
		}
	});

	it('gives a high player bust-on-hit chance for a near-max hard total', () => {
		// Every card of value 2+ busts hard 20; only a redrawn ace survives as a
		// soft-adjusted 21, so the bust chance is high but not exactly 100%.
		const result = computeEvComparison(RULE_SET, 0, ACE_FIVE_TAGS, [20], RANKS);
		for (const row of result.rows) {
			expect(row.playerBustOnHitPercent).toBeGreaterThan(85);
			expect(row.playerBustOnHitPercent).toBeLessThan(100);
		}
	});

	it('gives the dealer a higher bust chance showing a 6 than showing a T', () => {
		const result = computeEvComparison(RULE_SET, 0, ACE_FIVE_TAGS, [12], RANKS);
		const six = result.rows.find((r) => r.upcard === '6')!;
		const ten = result.rows.find((r) => r.upcard === 'T')!;
		expect(six.dealerBustPercent).toBeGreaterThan(ten.dealerBustPercent);
	});
});
