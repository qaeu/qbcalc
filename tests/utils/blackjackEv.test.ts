import { describe, it, expect } from 'vitest';

import {
	ACE_FIVE_TAGS,
	DEFAULT_RULE_SET,
	RANKS,
	SOFT_TOTALS,
	type RuleSet,
	type Surrender,
	type TagValues,
	baseComposition,
	applyCountToComposition,
	computeEvComparison,
	computeSplitEvComparison,
} from '#utils/blackjackEv';

/**
 * The baseline the reference Python implementation was written against, and
 * so the one the golden EV values below belong to: no peek (a dealer natural
 * is an ordinary dealer 21 that beats the player) and no surrender.
 */
const RULE_SET: RuleSet = {
	...DEFAULT_RULE_SET,
	decks: 4,
	dealerHitsSoft17: true,
	dealerPeek: false,
	surrender: 'none',
};

describe('baseComposition', () => {
	it('builds a fresh shoe in half-card units', () => {
		const comp = baseComposition({ ...RULE_SET, decks: 1 });
		expect(comp).toHaveLength(10);
		// Non-ten ranks: 4 cards/deck * 1 deck * 2 half-card units = 8.
		expect(comp[RANKS.indexOf('2')]).toBe(8);
		expect(comp[RANKS.indexOf('9')]).toBe(8);
		// Ten-valued ranks (T, J, Q, K) collapse to one rank: 16 cards/deck * 2 units.
		expect(comp[RANKS.indexOf('T')]).toBe(32);
		expect(comp[RANKS.indexOf('A')]).toBe(8);
	});

	it('scales linearly with deck count', () => {
		const oneDeck = baseComposition({ ...RULE_SET, decks: 1 });
		const fourDecks = baseComposition({ ...RULE_SET, decks: 4 });
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
		const base = baseComposition({ ...RULE_SET, decks: 1 });
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
		const base = baseComposition({ ...RULE_SET, decks: 6 });
		const adjusted = applyCountToComposition(base, HI_LO_TAGS, 6);

		expect(adjusted[RANKS.indexOf('2')]).toBeLessThan(base[RANKS.indexOf('2')]);
		expect(adjusted[RANKS.indexOf('6')]).toBeLessThan(base[RANKS.indexOf('6')]);
		expect(adjusted[RANKS.indexOf('8')]).toBe(base[RANKS.indexOf('8')]);
		expect(adjusted[RANKS.indexOf('T')]).toBeGreaterThan(base[RANKS.indexOf('T')]);
		expect(adjusted[RANKS.indexOf('A')]).toBeGreaterThan(base[RANKS.indexOf('A')]);
	});

	it('preserves the shoe size and stays integral', () => {
		const base = baseComposition({ ...RULE_SET, decks: 6 });
		for (const count of [-9, -4, 1, 5, 13]) {
			const adjusted = applyCountToComposition(base, HI_LO_TAGS, count);
			expect(totalCards(adjusted)).toBe(totalCards(base));
			expect(adjusted.every(Number.isInteger)).toBe(true);
		}
	});

	it('reverses the direction of the shift when the count flips sign', () => {
		const base = baseComposition({ ...RULE_SET, decks: 6 });
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
		const base = baseComposition({ ...RULE_SET, decks: 1 });
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
	//
	// The six T/A-upcard, no-peek cells below (8-T, 8-A, 12-T, 12-A, 16-T,
	// 16-A) are overridden from that reference: it shared a bug with this
	// codebase's original port where a live (unpeeked) dealer natural was
	// folded into an ordinary dealer 21, so a player hand that also landed
	// on 21 by drawing (e.g. hitting 16 into a 5) wrongly pushed instead of
	// losing to the natural, as standard rules require. 20-T/20-A are exempt
	// since standing on 20 never draws into this case. Recomputed by hand
	// after the fix (see `dealerUpcardDist`'s `natural` outcome).
	const golden: Record<string, { base: number; mod: number }> = {
		'8-2': { base: -0.022614020102258103, mod: -0.006907015828013355 },
		'8-6': { base: 0.10595493706475456, mod: 0.13206283501164154 },
		'8-T': { base: -0.3015941308975191, mod: -0.3120509036619411 },
		'8-A': { base: -0.4709079493315567, mod: -0.45330916624384554 },
		'12-2': { base: -0.25064167438251495, mod: -0.2503294793682547 },
		'12-6': { base: -0.12249146529035816, mod: -0.11926370647221837 },
		'12-T': { base: -0.4219059556827166, mod: -0.4388588647591659 },
		'12-A': { base: -0.5643791705463572, mod: -0.5602769913101782 },
		'16-2': { base: -0.2844464086900959, mod: -0.27203348828830076 },
		'16-6': { base: -0.12249146529035816, mod: -0.11926370647221837 },
		'16-T': { base: -0.5703348688642161, mod: -0.5889534675911907 },
		'16-A': { base: -0.6758638018050835, mod: -0.6708949235551441 },
		'20-2': { base: 0.6341572502198931, mod: 0.6300076609865916 },
		'20-6': { base: 0.6776749210619718, mod: 0.6989031461332856 },
		'20-T': { base: 0.43812639597973013, mod: 0.40797110468981135 },
		'20-A': { base: 0.12252949764519311, mod: 0.12963394507970194 },
	};

	const totals = [8, 12, 16, 20];
	const upcards = (['2', '6', 'T', 'A'] as const).slice();
	const result = computeEvComparison(
		{ ...RULE_SET, decks: 1 },
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
		const result = computeSplitEvComparison(RULE_SET, 0, ACE_FIVE_TAGS, ['8'], RANKS);
		const six = result.rows.find((r) => r.upcard === '6')!;
		const ten = result.rows.find((r) => r.upcard === 'T')!;
		expect(six.dealerBustPercent).toBeGreaterThan(ten.dealerBustPercent);
	});
});

describe('dealer peek', () => {
	const totals = [16, 20];
	const upcards = (['6', 'T', 'A'] as const).slice();
	const byKey = (dealerPeek: boolean) =>
		new Map(
			computeEvComparison(
				{ ...RULE_SET, dealerPeek },
				0,
				ACE_FIVE_TAGS,
				totals,
				upcards
			).rows.map((row) => [`${row.total}-${row.upcard}`, row])
		);

	const noPeek = byKey(false);
	const peek = byKey(true);

	it('lifts EV against a ten or an ace, where a natural is no longer possible', () => {
		for (const key of ['16-T', '20-T', '16-A', '20-A']) {
			expect(peek.get(key)!.baseEvPercent).toBeGreaterThan(
				noPeek.get(key)!.baseEvPercent
			);
		}
	});

	it('raises the dealer bust chance against a ten or an ace', () => {
		// Conditioning away the dealer's naturals takes made 21s out of the
		// distribution, so what is left busts more often.
		expect(peek.get('16-T')!.dealerBustPercent).toBeGreaterThan(
			noPeek.get('16-T')!.dealerBustPercent
		);
		expect(peek.get('16-A')!.dealerBustPercent).toBeGreaterThan(
			noPeek.get('16-A')!.dealerBustPercent
		);
	});

	it('leaves an upcard that cannot make a natural untouched', () => {
		expect(peek.get('16-6')!.baseEvPercent).toBeCloseTo(
			noPeek.get('16-6')!.baseEvPercent,
			9
		);
		expect(peek.get('20-6')!.dealerBustPercent).toBeCloseTo(
			noPeek.get('20-6')!.dealerBustPercent,
			9
		);
	});

	it('costs a player hand that also lands on 21 the full bet against a live, unpeeked natural', () => {
		// Standing on a made 21 (never a natural here, per simplification #2)
		// against a dealer upcard that could hide one: at a peeking table the
		// natural is filtered out of the world entirely, so the player only
		// ever wins or pushes. Without the peek that same natural is still
		// live and, being a genuine two-card blackjack, beats the player's
		// made 21 outright instead of tying it -- so the no-peek EV should be
		// exactly `(1 - pNatural) * peekEv - pNatural`, not the more generous
		// `(1 - pNatural) * peekEv` a push-on-tie treatment would give.
		const rules = { ...RULE_SET, decks: 1 };
		const peekEv =
			computeEvComparison({ ...rules, dealerPeek: true }, 0, ACE_FIVE_TAGS, [21], ['T'])
				.rows[0].baseEvPercent / 100;
		const noPeekEv =
			computeEvComparison({ ...rules, dealerPeek: false }, 0, ACE_FIVE_TAGS, [21], ['T'])
				.rows[0].baseEvPercent / 100;

		// One deck in half-card units: 104 total, minus 1 for the removed
		// upcard leaves 103, 8 of them the ace that completes the natural.
		const pNatural = 8 / 103;
		expect(noPeekEv).toBeCloseTo((1 - pNatural) * peekEv - pNatural, 9);
	});
});

describe('surrender', () => {
	const totals = [12, 15, 16, 17];
	const upcards = (['6', 'T', 'A'] as const).slice();
	const actions = (surrender: Surrender) =>
		new Map(
			computeEvComparison(
				{ ...RULE_SET, surrender, dealerPeek: true },
				0,
				ACE_FIVE_TAGS,
				totals,
				upcards
			).rows.map((row) => [`${row.total}-${row.upcard}`, row.optimalAction])
		);

	const none = actions('none');
	const late = actions('late');
	const early = actions('early');

	it('is never offered at a table without it', () => {
		for (const action of none.values()) {
			expect(action).not.toBe('R');
		}
	});

	it('gives up hard 16 against a ten but plays it out against a six', () => {
		expect(late.get('16-T')).toBe('R');
		expect(late.get('16-6')).toBe('S');
	});

	it('never gives up a hand that is already strong enough to stand on', () => {
		expect(late.get('17-T')).toBe('S');
		expect(late.get('17-6')).toBe('S');
	});

	it('gives up more hands early than late, since the dealer has yet to peek', () => {
		// Early surrender is taken before the dealer checks for a natural, so
		// it also buys the player out of losing outright to one -- worth doing
		// on hands that are playable once that risk has been peeked away.
		expect(late.get('12-A')).toBe('H');
		expect(early.get('12-A')).toBe('R');
		expect(early.get('17-A')).toBe('R');

		for (const [key, action] of late) {
			if (action === 'R') expect(early.get(key)).toBe('R');
		}
	});

	it('reports surrender as a flat half-bet loss on the splits table', () => {
		const result = computeSplitEvComparison(
			{ ...RULE_SET, surrender: 'late', dealerPeek: true },
			0,
			ACE_FIVE_TAGS,
			['T'],
			['A']
		);
		const row = result.rows[0];
		if (row.optimalAction === 'R') expect(row.countEvPercent).toBeCloseTo(-50, 9);
	});
});

describe('split rules', () => {
	const pairRanks = (['A', '4', '8'] as const).slice();
	const upcards = (['5', '6', 'T'] as const).slice();
	const splitRows = (rules: Partial<RuleSet>) =>
		new Map(
			computeSplitEvComparison(
				{ ...RULE_SET, ...rules },
				0,
				ACE_FIVE_TAGS,
				pairRanks,
				upcards
			).rows.map((row) => [`${row.pairRank}-${row.upcard}`, row])
		);

	it('never splits at a table that allows only one hand', () => {
		for (const row of splitRows({ splitLimit: 1 }).values()) {
			expect(row.optimalAction).not.toBe('P');
		}
	});

	it('splits 4,4 against a weak upcard only when doubling after a split is allowed', () => {
		expect(splitRows({ doubleAfterSplit: true }).get('4-6')!.optimalAction).toBe('P');
		expect(splitRows({ doubleAfterSplit: false }).get('4-6')!.optimalAction).toBe('H');
	});

	it('is worth more with doubling after a split allowed', () => {
		const withDas = splitRows({ doubleAfterSplit: true });
		const withoutDas = splitRows({ doubleAfterSplit: false });
		for (const key of ['8-5', '8-6']) {
			expect(withDas.get(key)!.countEvPercent).toBeGreaterThan(
				withoutDas.get(key)!.countEvPercent
			);
		}
	});

	it('is worth more the more hands the split limit allows', () => {
		const twoHands = splitRows({ splitLimit: 2 });
		const fourHands = splitRows({ splitLimit: 4 });
		expect(fourHands.get('8-5')!.countEvPercent).toBeGreaterThan(
			twoHands.get('8-5')!.countEvPercent
		);
	});

	it('raises the split limit for aces only when resplitting them is allowed', () => {
		const noRsa = splitRows({ splitLimit: 4, resplitAces: false });
		const rsa = splitRows({ splitLimit: 4, resplitAces: true });
		const twoHands = splitRows({ splitLimit: 2, resplitAces: false });

		expect(noRsa.get('A-6')!.countEvPercent).toBeCloseTo(
			twoHands.get('A-6')!.countEvPercent,
			9
		);
		expect(rsa.get('A-6')!.countEvPercent).toBeGreaterThan(
			noRsa.get('A-6')!.countEvPercent
		);
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
