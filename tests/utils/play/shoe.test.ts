import { describe, it, expect } from 'vitest';

import { HI_LO_TAGS } from '#utils/settings/countingSystems';
import { CARDS_PER_DECK } from '#utils/ev/composition';
import { DEFAULT_RULE_SET } from '#utils/ev/rules';
import { createShoe, restoreShoe, type DealtShoe } from '#utils/play/shoe';

const RULE_SET = { ...DEFAULT_RULE_SET, decks: 6, penetrationPercent: 75 };
const TOTAL_CARDS = RULE_SET.decks * CARDS_PER_DECK;
const NOMINAL_CUT = Math.floor((TOTAL_CARDS * RULE_SET.penetrationPercent) / 100);

/** Where the cut card sat for each of `shuffles` consecutive shuffles. */
function cutCards(shoe: DealtShoe, shuffles: number): number[] {
	const cuts: number[] = [];
	for (let index = 0; index < shuffles; index += 1) {
		cuts.push(shoe.snapshot().cutCard);
		shoe.shuffle();
	}
	return cuts;
}

describe('createShoe', () => {
	it('holds the full shoe, counted from zero', () => {
		const shoe = createShoe(RULE_SET, HI_LO_TAGS, 1);
		expect(shoe.cardsRemaining()).toBe(TOTAL_CARDS);
		expect(shoe.runningCount()).toBe(0);
		expect(shoe.decksRemaining()).toBe(RULE_SET.decks);
	});

	it('deals the same order twice from one seed', () => {
		const a = createShoe(RULE_SET, HI_LO_TAGS, 42);
		const b = createShoe(RULE_SET, HI_LO_TAGS, 42);
		expect(b.snapshot().cards).toEqual(a.snapshot().cards);
	});
});

describe('the cut card', () => {
	describe('without a variance option', () => {
		it('sits exactly at the penetration', () => {
			const shoe = createShoe(RULE_SET, HI_LO_TAGS, 1);
			expect(shoe.snapshot().cutCard).toBe(NOMINAL_CUT);
		});

		it('stays there through every shuffle', () => {
			const shoe = createShoe(RULE_SET, HI_LO_TAGS, 1);
			for (const cut of cutCards(shoe, 20)) expect(cut).toBe(NOMINAL_CUT);
		});

		it('deals the shoe the option-less call has always dealt', () => {
			// Byte-identical, not merely equivalent: an omitted option must draw no
			// number at all, or every shuffle after the first would deal a
			// different shoe from the one the Play view has been dealing.
			const bare = createShoe(RULE_SET, HI_LO_TAGS, 7);
			const zero = createShoe(RULE_SET, HI_LO_TAGS, 7, { cutCardVarianceDecks: 0 });
			bare.shuffle();
			zero.shuffle();
			expect(zero.snapshot()).toEqual(bare.snapshot());
		});
	});

	describe('with a variance option', () => {
		const VARIANCE = 0.5;
		const JITTER = VARIANCE * CARDS_PER_DECK;

		it('is redrawn on every shuffle', () => {
			const shoe = createShoe(RULE_SET, HI_LO_TAGS, 1, {
				cutCardVarianceDecks: VARIANCE,
			});
			const cuts = cutCards(shoe, 40);
			expect(new Set(cuts).size).toBeGreaterThan(10);
		});

		it('stays inside the jitter it was given', () => {
			const shoe = createShoe(RULE_SET, HI_LO_TAGS, 3, {
				cutCardVarianceDecks: VARIANCE,
			});
			// The first cut is the nominal one -- the jitter belongs to a shuffle,
			// and `createShoe` shuffles once on the way out, so from there on every
			// cut is drawn.
			for (const cut of cutCards(shoe, 60)) {
				expect(cut).toBeGreaterThanOrEqual(NOMINAL_CUT - JITTER - 1);
				expect(cut).toBeLessThanOrEqual(NOMINAL_CUT + JITTER + 1);
			}
		});

		it('spreads either side of the penetration rather than one way', () => {
			const shoe = createShoe(RULE_SET, HI_LO_TAGS, 5, {
				cutCardVarianceDecks: VARIANCE,
			});
			const cuts = cutCards(shoe, 200);
			expect(cuts.some((cut) => cut < NOMINAL_CUT)).toBe(true);
			expect(cuts.some((cut) => cut > NOMINAL_CUT)).toBe(true);
			const mean = cuts.reduce((sum, cut) => sum + cut, 0) / cuts.length;
			expect(Math.abs(mean - NOMINAL_CUT)).toBeLessThan(JITTER / 2);
		});

		it('always leaves a round dealable behind it', () => {
			// A whole deck of jitter on a shallow shoe is what tests the clamp: an
			// undrawn round is not a shorter shoe, it is a thrown shoe.
			const shallow = { ...RULE_SET, decks: 2, penetrationPercent: 95 };
			const shoe = createShoe(shallow, HI_LO_TAGS, 9, { cutCardVarianceDecks: 1 });
			const total = shallow.decks * CARDS_PER_DECK;
			for (const cut of cutCards(shoe, 100)) {
				expect(cut).toBeGreaterThan(0);
				expect(total - cut).toBeGreaterThanOrEqual(CARDS_PER_DECK);
			}
		});

		it('replays exactly from its seed', () => {
			const a = createShoe(RULE_SET, HI_LO_TAGS, 21, { cutCardVarianceDecks: 1 });
			const b = createShoe(RULE_SET, HI_LO_TAGS, 21, { cutCardVarianceDecks: 1 });
			expect(cutCards(b, 30)).toEqual(cutCards(a, 30));
		});
	});
});

describe('restoreShoe', () => {
	it('picks the shoe up where it was put down, cut card included', () => {
		const shoe = createShoe(RULE_SET, HI_LO_TAGS, 4, { cutCardVarianceDecks: 1 });
		shoe.shuffle();
		for (let card = 0; card < 30; card += 1) shoe.draw();
		const snapshot = shoe.snapshot();

		const restored = restoreShoe(HI_LO_TAGS, snapshot);
		expect(restored.snapshot()).toEqual(snapshot);
		expect(restored.runningCount()).toBe(shoe.runningCount());
		expect(restored.draw()).toBe(shoe.draw());
	});
});
