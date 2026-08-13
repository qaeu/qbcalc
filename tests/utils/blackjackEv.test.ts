import { describe, it, expect, beforeAll } from 'vitest';

import {
	ACE_FIVE_TAGS,
	DEFAULT_RULE_SET,
	RANKS,
	SOFT_TOTALS,
	type Rank,
	type RuleSet,
	type Surrender,
	type TagValues,
	baseComposition,
	applyCountToComposition,
	computeEvComparison,
	computeSplitEvComparison,
} from '#utils/blackjackEv';

/**
 * The baseline the golden EV values below belong to: no peek (a dealer
 * natural is still live and beats the player outright) and no surrender.
 */
const RULE_SET: RuleSet = {
	...DEFAULT_RULE_SET,
	decks: 4,
	dealerHitsSoft17: true,
	dealerPeek: false,
	surrender: 'none',
};

/**
 * Budget for the cases that need whole EV grids rather than single cells.
 * Each grid is a few seconds of exact recursion, so the shared ones are built
 * in `beforeAll` -- never at collection time, which would charge every
 * filtered run for grids it does not use -- and both those hooks and the
 * tests that build their own want more than vitest's 5s default.
 */
const GRID_TIMEOUT_MS = 120_000;

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
	// Golden values regenerated from this engine after the `addValue`
	// soft-ace and half-card-removal fixes (1 deck, H17, no peek, no
	// surrender, Ace-Five count +2, half-card units).
	//
	// The engine they were originally taken from -- a reference Python port --
	// shared two defects with this codebase's first version, so its values
	// could not be kept: it turned every soft hand hard as soon as it drew a
	// second ace, and it removed half a card per draw from a shoe stored in
	// half-card units. The corrected engine reproduces Wizard of Odds
	// Appendix 2B's dealer bust probabilities exactly (see the `dealer bust
	// probability` block below), which is what these values now rest on.
	const golden: Record<string, { base: number; mod: number }> = {
		'8-2': { base: -0.025966743708865193, mod: -0.012084418651186838 },
		'8-6': { base: 0.10767029251325697, mod: 0.13398846105074716 },
		'8-T': { base: -0.2960645623863047, mod: -0.30684881252938523 },
		'8-A': { base: -0.501428789500461, mod: -0.49223573016939537 },
		'12-2': { base: -0.25063170382409233, mod: -0.2511329409048318 },
		'12-6': { base: -0.12448823156282013, mod: -0.12157618707692947 },
		'12-T': { base: -0.41489005036514065, mod: -0.4322484259465115 },
		'12-A': { base: -0.5823144319401172, mod: -0.582903226340963 },
		'16-2': { base: -0.2873098598722572, mod: -0.2762149580130267 },
		'16-6': { base: -0.12448823156282013, mod: -0.12157618707692947 },
		'16-T': { base: -0.5653045097163133, mod: -0.5868607621895505 },
		'16-A': { base: -0.6877491188012591, mod: -0.7052840993302912 },
		'20-2': { base: 0.6304308995653626, mod: 0.6253101496855284 },
		'20-6': { base: 0.6770703648487681, mod: 0.6989493736178257 },
		'20-T': { base: 0.44132588835719294, mod: 0.4108205539385041 },
		'20-A': { base: 0.10164595083868398, mod: 0.10450003154768445 },
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
	// The non-ace cases all read from one grid: a single `computeSplitEvComparison`
	// shares its memoised shoe across every pair rank in the call, so asking for
	// four ranks at once costs far less than four calls for one rank each.
	let pairs: Map<string, ReturnType<typeof computeSplitEvComparison>['rows'][number]>;
	let peekAces: typeof pairs;

	beforeAll(() => {
		const byKey = (rules: Partial<RuleSet>, pairRanks: readonly Rank[]) =>
			new Map(
				computeSplitEvComparison(
					{ ...RULE_SET, ...rules },
					0,
					ACE_FIVE_TAGS,
					pairRanks,
					RANKS
				).rows.map((row) => [`${row.pairRank}-${row.upcard}`, row])
			);

		pairs = byKey({}, ['5', '8', '9', 'T']);
		peekAces = byKey({ dealerPeek: true }, ['A']);
	}, GRID_TIMEOUT_MS);

	it('always recommends splitting aces at a peeking table', () => {
		for (const row of peekAces.values()) {
			expect(row.optimalAction).toBe('P');
		}
	});

	it(
		'hits A,A against an ace at a no-peek table instead of splitting',
		() => {
			// A,A is soft 12, so hitting it cannot bust and plays far better than
			// the hard 12 an earlier `addValue` bug made it. Without a peek, both
			// split hands are exposed to a dealer natural taking the whole wager,
			// which is what tips an ENHC table away from splitting here -- the
			// standard ENHC recommendation, and the reverse of the peeking case
			// above. Against a ten the split still wins.
			const result = computeSplitEvComparison(
				{ ...RULE_SET, dealerPeek: false },
				0,
				ACE_FIVE_TAGS,
				['A'],
				['A', 'T']
			);
			const byUpcard = new Map(result.rows.map((row) => [row.upcard, row]));
			expect(byUpcard.get('A')!.optimalAction).toBe('H');
			expect(byUpcard.get('T')!.optimalAction).toBe('P');
		},
		GRID_TIMEOUT_MS
	);

	it('recommends splitting 8s against every upcard from 2 through 9', () => {
		for (const upcard of RANKS.filter((r) => r !== 'T' && r !== 'A')) {
			expect(pairs.get(`8-${upcard}`)!.optimalAction).toBe('P');
		}
	});

	it('never recommends splitting 10s', () => {
		for (const upcard of RANKS) {
			expect(pairs.get(`T-${upcard}`)!.optimalAction).not.toBe('P');
		}
	});

	it('recommends splitting 9s against a weak upcard but standing against a strong one', () => {
		expect(pairs.get('9-6')!.optimalAction).toBe('P');
		expect(pairs.get('9-T')!.optimalAction).toBe('S');
	});

	it('recommends doubling 5,5 (hard 10) rather than splitting it', () => {
		expect(pairs.get('5-6')!.optimalAction).toBe('D');
	});

	it('gives the dealer a higher bust chance showing a 6 than showing a T', () => {
		expect(pairs.get('8-6')!.dealerBustPercent).toBeGreaterThan(
			pairs.get('8-T')!.dealerBustPercent
		);
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

	type Rows = ReturnType<typeof byKey>;
	let noPeek: Rows;
	let peek: Rows;

	beforeAll(() => {
		noPeek = byKey(false);
		peek = byKey(true);
	}, GRID_TIMEOUT_MS);

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

		// One deck in half-card units: 104 total, minus 2 (one whole card) for
		// the removed upcard leaves 102, 8 of them the ace that completes the
		// natural -- i.e. 4 aces out of the 51 cards left, as it should be.
		const pNatural = 8 / 102;
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

	type Actions = ReturnType<typeof actions>;
	let none: Actions;
	let late: Actions;
	let early: Actions;

	beforeAll(() => {
		none = actions('none');
		late = actions('late');
		early = actions('early');
	}, GRID_TIMEOUT_MS);

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

	it('reports surrender as a flat half-bet loss behind a peek', () => {
		// Late surrender is taken after the dealer has checked, so the natural
		// is already out of the world both sides of the comparison live in.
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

	it('never prices surrender below half the stake at a no-peek table', () => {
		// A surrendered stake is off the table before the dealer draws their
		// second card, so a natural that arrives later has nothing left to
		// collect: every no-hole-card surrender is an early one worth a flat
		// -0.5. ("All bets lost" still applies to doubles and splits, whose
		// stakes are live at the draw.) Briefly modelled the other way, which
		// showed R cells at -53% against a ten and -65% against an ace.
		for (const surrender of ['late', 'es10', 'early'] as const) {
			const rows = computeEvComparison(
				{ ...RULE_SET, decks: 6, dealerHitsSoft17: false, surrender, dealerPeek: false },
				0,
				ACE_FIVE_TAGS,
				[12, 15, 16, 17],
				['6', 'T', 'A']
			).rows;
			for (const row of rows) {
				if (row.optimalAction !== 'R') continue;
				expect(row.baseEvPercent).toBeCloseTo(-50, 9);
			}
			// Against an ace, where playing on is exposed to the natural, that
			// makes surrender the right answer even on a made 17 -- the
			// well-known early-surrender pattern.
			expect(rows.find((r) => r.total === 17 && r.upcard === 'A')!.optimalAction).toBe(
				'R'
			);
		}
	});

	it(
		'gives ES10 the early treatment against a ten and the late one against an ace',
		() => {
			// ES10 is early surrender against a ten only. Against an ace it is
			// late, so it is worth a flat -0.5 there and dodges nothing; against a
			// ten it buys the player out of the natural and is reported in the
			// same conditional frame as its neighbours.
			const grid = (surrender: Surrender) =>
				new Map(
					computeEvComparison(
						{ ...RULE_SET, surrender, dealerPeek: true },
						0,
						ACE_FIVE_TAGS,
						[16],
						['T', 'A']
					).rows.map((row) => [row.upcard, row])
				);
			const es10 = grid('es10');
			const late = grid('late');
			const early = grid('early');

			expect(es10.get('T')!.baseEvPercent).toBeCloseTo(early.get('T')!.baseEvPercent, 9);
			expect(es10.get('A')!.baseEvPercent).toBeCloseTo(late.get('A')!.baseEvPercent, 9);
			// The ten column is strictly better than late surrender, and the ace
			// column strictly worse than early -- otherwise ES10 would just be one
			// of the two under another name.
			expect(es10.get('T')!.baseEvPercent).toBeGreaterThan(late.get('T')!.baseEvPercent);
			expect(es10.get('A')!.baseEvPercent).toBeLessThan(early.get('A')!.baseEvPercent);
		},
		GRID_TIMEOUT_MS
	);

	it('reports early surrender in the same conditional frame as its neighbours', () => {
		// Early surrender really is worth -0.5 before the peek, but every
		// other cell at a peeking table is reported conditional on no dealer
		// natural. Displaying the flat -0.5 put the chosen action's number
		// below the stand value it had just beaten.
		const rules = { ...RULE_SET, surrender: 'early' as Surrender, dealerPeek: true };
		const pNatural = 128 / 414;
		const conditional = (-0.5 + pNatural) / (1 - pNatural);

		const row = computeEvComparison(rules, 0, ACE_FIVE_TAGS, [17], ['A']).rows[0];
		expect(row.optimalAction).toBe('R');
		expect(row.baseEvPercent).toBeCloseTo(conditional * 100, 9);
		expect(row.baseEvPercent).toBeGreaterThan(-50);

		// ...and above the stand EV it was chosen over, which is the whole
		// point of reporting the two in one frame.
		const stand = computeEvComparison(
			{ ...rules, surrender: 'none' },
			0,
			ACE_FIVE_TAGS,
			[17],
			['A']
		).rows[0];
		expect(row.baseEvPercent).toBeGreaterThan(stand.baseEvPercent);
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

	// One grid per distinct rule set, deduplicated across the cases below.
	// `splitLimit: 4, resplitAces: false` is the shared baseline.
	type SplitRows = ReturnType<typeof splitRows>;
	let oneHand: SplitRows;
	let twoHands: SplitRows;
	let threeHands: SplitRows;
	let fourHands: SplitRows;
	let fourHandsRsa: SplitRows;
	let eightHands: SplitRows;
	let withoutDas: SplitRows;
	let withHsa: SplitRows;
	let withHsaNoDas: SplitRows;

	beforeAll(() => {
		oneHand = splitRows({ splitLimit: 1 });
		twoHands = splitRows({ splitLimit: 2 });
		threeHands = splitRows({ splitLimit: 3 });
		fourHands = splitRows({ splitLimit: 4 });
		fourHandsRsa = splitRows({ splitLimit: 4, resplitAces: true });
		eightHands = splitRows({ splitLimit: 8 });
		withoutDas = splitRows({ doubleAfterSplit: false });
		withHsa = splitRows({ hitSplitAces: true });
		withHsaNoDas = splitRows({ hitSplitAces: true, doubleAfterSplit: false });
	}, GRID_TIMEOUT_MS);

	it('never splits at a table that allows only one hand', () => {
		for (const row of oneHand.values()) {
			expect(row.optimalAction).not.toBe('P');
		}
	});

	it('splits 4,4 against a weak upcard only when doubling after a split is allowed', () => {
		expect(fourHands.get('4-6')!.optimalAction).toBe('P');
		expect(withoutDas.get('4-6')!.optimalAction).toBe('H');
	});

	it('is worth more with doubling after a split allowed', () => {
		for (const key of ['8-5', '8-6']) {
			expect(fourHands.get(key)!.countEvPercent).toBeGreaterThan(
				withoutDas.get(key)!.countEvPercent
			);
		}
	});

	it('is worth more the more hands the split limit allows', () => {
		expect(fourHands.get('8-5')!.countEvPercent).toBeGreaterThan(
			twoHands.get('8-5')!.countEvPercent
		);
	});

	it('spends one shared hand budget rather than one per hand', () => {
		// The budget belongs to the round, so the third and fourth permitted
		// hands are worth the same thing: one hand that may split once, in
		// place of one that may not. When each hand carried its own budget,
		// "limit 3" was already modelling four hands and the 2->3 step came
		// out several times larger than the 3->4 step.
		const ev = (rows: typeof twoHands) => rows.get('8-5')!.countEvPercent;
		const gainFromThird = ev(threeHands) - ev(twoHands);
		const gainFromFourth = ev(fourHands) - ev(threeHands);

		expect(gainFromThird).toBeGreaterThan(0);
		expect(gainFromFourth).toBeCloseTo(gainFromThird, 9);
		// More slots still help, with diminishing returns rather than a
		// doubling ladder.
		expect(ev(eightHands)).toBeGreaterThan(ev(fourHands));
		expect(ev(eightHands) - ev(fourHands)).toBeLessThan(gainFromThird);
	});

	it('is worth more when split aces may be drawn to', () => {
		// A split ace normally takes one card and stands, so A,7 or A,2 is
		// stuck where it lands. Hitting them is a large gain, and one that
		// belongs to the ace row alone -- no other pair is affected.
		expect(withHsa.get('A-6')!.countEvPercent).toBeGreaterThan(
			fourHands.get('A-6')!.countEvPercent
		);
		for (const key of ['4-5', '4-6', '8-5', '8-6', '8-T']) {
			expect(withHsa.get(key)!.countEvPercent).toBeCloseTo(
				fourHands.get(key)!.countEvPercent,
				9
			);
		}
	});

	it('lets a drawn-to split ace double when the table allows doubling after a split', () => {
		// A split ace that may be hit is an ordinary hand, so DAS reaches it
		// like any other split hand -- worth several points against a weak
		// upcard. While the one-card rule stands the hand never acts, so DAS
		// cannot touch it and the two grids agree exactly.
		expect(withHsa.get('A-5')!.countEvPercent).toBeGreaterThan(
			withHsaNoDas.get('A-5')!.countEvPercent
		);
		expect(withHsa.get('A-6')!.countEvPercent).toBeGreaterThan(
			withHsaNoDas.get('A-6')!.countEvPercent
		);
		expect(fourHands.get('A-6')!.countEvPercent).toBeCloseTo(
			withoutDas.get('A-6')!.countEvPercent,
			9
		);
	});

	it('raises the split limit for aces only when resplitting them is allowed', () => {
		expect(fourHands.get('A-6')!.countEvPercent).toBeCloseTo(
			twoHands.get('A-6')!.countEvPercent,
			9
		);
		expect(fourHandsRsa.get('A-6')!.countEvPercent).toBeGreaterThan(
			fourHands.get('A-6')!.countEvPercent
		);
	});
});

describe('dealer bust probability', () => {
	/**
	 * Unconditional dealer bust chance per upcard, 6 decks, from Wizard of
	 * Odds Appendix 2B. Independent of anything this codebase computes, and
	 * sensitive to both the soft-ace handling in `addValue` and the size of a
	 * card removal -- either defect moves the ace column by roughly 2pp.
	 *
	 * Only the upcards the published table is quoted at to four decimals are
	 * asserted; the rest of the column is covered by the golden EV fixtures.
	 */
	const bustPercentByUpcard = (dealerHitsSoft17: boolean) =>
		new Map(
			computeEvComparison(
				{
					...RULE_SET,
					decks: 6,
					dealerHitsSoft17,
					// No peek keeps naturals in the distribution, which is the
					// frame the published table is in.
					dealerPeek: false,
				},
				0,
				ACE_FIVE_TAGS,
				[20],
				RANKS
			).rows.map((row) => [row.upcard, row.dealerBustPercent])
		);

	type BustPercents = ReturnType<typeof bustPercentByUpcard>;
	let s17: BustPercents;
	let h17: BustPercents;

	beforeAll(() => {
		s17 = bustPercentByUpcard(false);
		h17 = bustPercentByUpcard(true);
	}, GRID_TIMEOUT_MS);

	it.each([
		['A', 11.5473],
		['2', 35.3504],
		['3', 37.4194],
		['4', 39.5805],
		['5', 41.8406],
	] as const)('matches the published S17 value for a dealer %s', (upcard, expected) => {
		expect(s17.get(upcard)!).toBeCloseTo(expected, 3);
	});

	it('matches the published H17 value for a dealer ace', () => {
		expect(h17.get('A')!).toBeCloseTo(13.9149, 3);
	});

	it('busts more often on every low upcard when the dealer hits soft 17', () => {
		for (const upcard of ['2', '3', '4', '5', '6', 'A'] as const) {
			expect(h17.get(upcard)!).toBeGreaterThan(s17.get(upcard)!);
		}
	});
});

describe('soft 12 and A,A', () => {
	it(
		'values hitting A,A the same as hitting the soft 12 it is',
		() => {
			// A,A is soft 12, not hard 12. The two tables reach it by different
			// routes -- `analyzeGrid`'s soft row and `analyzeSplitGrid`'s pair row
			// -- and used to disagree by ~20pp because `pairTotal('A')` hardened
			// the hand. Picked at an upcard where hitting is the optimal action in
			// both tables, so both cells report the hit EV.
			const rules = { ...RULE_SET, dealerPeek: false };
			const soft12 = computeEvComparison(rules, 0, ACE_FIVE_TAGS, [12], ['A'], true)
				.rows[0];
			const pairOfAces = computeSplitEvComparison(rules, 0, ACE_FIVE_TAGS, ['A'], ['A'])
				.rows[0];

			expect(soft12.optimalAction).toBe('H');
			expect(pairOfAces.optimalAction).toBe('H');
			expect(pairOfAces.baseEvPercent).toBeCloseTo(soft12.baseEvPercent, 9);
		},
		GRID_TIMEOUT_MS
	);
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
