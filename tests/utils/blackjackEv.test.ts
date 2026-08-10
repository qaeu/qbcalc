import { describe, it, expect } from 'vitest';

import {
	RANKS,
	baseComposition,
	applyAceFiveCount,
	computeEvComparison,
} from '#utils/blackjackEv';

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

describe('applyAceFiveCount', () => {
	it('shifts half a card of five density into aces per count unit', () => {
		const base = baseComposition({ decks: 1, dealerHitsSoft17: true });
		const adjusted = applyAceFiveCount(base, 2);
		expect(adjusted[RANKS.indexOf('5')]).toBe(base[RANKS.indexOf('5')] - 2);
		expect(adjusted[RANKS.indexOf('A')]).toBe(base[RANKS.indexOf('A')] + 2);
	});

	it('throws once the count removes more fives or aces than exist', () => {
		const base = baseComposition({ decks: 1, dealerHitsSoft17: true });
		expect(() => applyAceFiveCount(base, 100)).toThrow(/too extreme/i);
		expect(() => applyAceFiveCount(base, -100)).toThrow(/too extreme/i);
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
