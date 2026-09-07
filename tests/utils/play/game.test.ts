import { describe, it, expect } from 'vitest';

import type { Rank } from '#utils/ev/cards';
import { DEFAULT_RULE_SET, type RuleSet } from '#utils/ev/rules';
import { HI_LO_TAGS } from '#utils/countingSystems';
import {
	applyAction,
	createGame,
	legalActions,
	preRound,
	resolveInsurance,
	settleRound,
	startRound,
	type GameState,
} from '#utils/play/game';
import { createShoe, type DealtShoe } from '#utils/play/shoe';

import { scriptedShoe } from './scriptedShoe';

/** Insurance off by default, so a round against an ace opens straight into `act`. */
const NO_INSURANCE: RuleSet = { ...DEFAULT_RULE_SET, insurance: false };

function rules(overrides: Partial<RuleSet> = {}): RuleSet {
	return { ...NO_INSURANCE, ...overrides };
}

function deal(ruleSet: RuleSet, script: readonly Rank[], bet = 10): GameState {
	return startRound(createGame(ruleSet, scriptedShoe(script)), bet);
}

describe('the dealt shoe', () => {
	it('deals the same cards from the same seed, and different ones from another', () => {
		const first = createShoe(DEFAULT_RULE_SET, HI_LO_TAGS, 12345);
		const second = createShoe(DEFAULT_RULE_SET, HI_LO_TAGS, 12345);
		const other = createShoe(DEFAULT_RULE_SET, HI_LO_TAGS, 999);

		const draw = (shoe: DealtShoe, cards: number) =>
			Array.from({ length: cards }, () => shoe.draw()).join('');
		const dealt = draw(first, 40);
		expect(draw(second, 40)).toBe(dealt);
		expect(draw(other, 40)).not.toBe(dealt);
	});

	it('holds a whole shoe, and reaches the cut card at the penetration', () => {
		const shoe = createShoe(rules({ decks: 2, penetrationPercent: 75 }), HI_LO_TAGS, 7);
		expect(shoe.cardsRemaining()).toBe(104);
		expect(shoe.decksRemaining()).toBe(2);
		expect(shoe.needsShuffle()).toBe(false);

		for (let card = 0; card < 77; card += 1) shoe.draw();
		expect(shoe.needsShuffle()).toBe(false);
		shoe.draw();
		expect(shoe.needsShuffle()).toBe(true);

		shoe.shuffle();
		expect(shoe.needsShuffle()).toBe(false);
		expect(shoe.cardsRemaining()).toBe(104);
	});

	it('counts what has been seen, and not the hole card until it turns', () => {
		const shoe = scriptedShoe(['T', 'T', 'T', '5']);
		shoe.draw();
		shoe.drawHidden();
		expect(shoe.runningCount()).toBe(-1);
		shoe.revealHidden();
		expect(shoe.runningCount()).toBe(-2);
	});

	it('is reshuffled by the next round once the cut card is passed', () => {
		const shoe = createShoe(rules({ decks: 1, penetrationPercent: 10 }), HI_LO_TAGS, 3);
		for (let card = 0; card < 10; card += 1) shoe.draw();
		expect(shoe.needsShuffle()).toBe(true);
		startRound(createGame(rules(), shoe), 10);
		expect(shoe.needsShuffle()).toBe(false);
		// Four cards off a fresh 52, one of them the hole card.
		expect(shoe.cardsRemaining()).toBe(48);
	});
});

describe('the dealer', () => {
	const softSeventeen: Rank[] = ['T', '6', 'T', 'A', '4'];

	it('stands on soft 17 at an S17 table', () => {
		const ruleSet = rules({ dealerHitsSoft17: false });
		const state = settleRound(applyAction(deal(ruleSet, softSeventeen), 'S'));
		expect(state.phase).toBe('settled');
		expect(state.dealer.total).toBe(17);
		expect(state.hands[0].result).toBe('win');
		expect(state.net).toBe(10);
	});

	it('hits soft 17 at an H17 table', () => {
		const ruleSet = rules({ dealerHitsSoft17: true });
		const state = settleRound(applyAction(deal(ruleSet, softSeventeen), 'S'));
		expect(state.dealer.total).toBe(21);
		expect(state.hands[0].result).toBe('lose');
		expect(state.net).toBe(-10);
	});

	it('keeps the hole card back until the round is paid', () => {
		const dealt = deal(rules(), ['T', '9', 'T', '8']);
		expect(dealt.dealer.holeHidden).toBe(true);
		expect(dealt.dealer.total).toBe(9);

		const state = settleRound(applyAction(dealt, 'S'));
		expect(state.dealer.holeHidden).toBe(false);
		expect(state.dealer.total).toBe(17);
	});

	it('does not draw when there is nothing left to beat', () => {
		// Player busts, so the dealer's 14 stands where it is.
		const busted = applyAction(deal(rules(), ['T', '9', '6', '5', 'T']), 'H');
		const state = settleRound(busted);
		expect(state.hands[0].result).toBe('bust');
		expect(state.dealer.cards).toHaveLength(2);
		expect(state.net).toBe(-10);
	});
});

describe('naturals', () => {
	it('pays 3:2, 6:5 and 1:1 as the felt says', () => {
		const natural: Rank[] = ['A', '9', 'T', '5'];
		for (const [payout, paid] of [
			['3:2', 15],
			['6:5', 12],
			['1:1', 10],
		] as const) {
			const dealt = deal(rules({ blackjackPayout: payout }), natural);
			// A natural is no play at all, so the round goes straight to the dealer.
			expect(dealt.phase).toBe('dealer');
			const state = settleRound(dealt);
			expect(state.hands[0].result).toBe('blackjack');
			expect(state.net).toBeCloseTo(paid, 10);
		}
	});

	it('pushes against a dealer natural', () => {
		const state = settleRound(deal(rules({ dealerPeek: true }), ['A', 'T', 'T', 'A']));
		expect(state.hands[0].result).toBe('push');
		expect(state.dealer.blackjack).toBe(true);
		expect(state.net).toBe(0);
	});

	it('takes every hand when the dealer has one at a peeking table', () => {
		const dealt = deal(rules({ dealerPeek: true }), ['9', 'T', '7', 'A']);
		expect(dealt.phase).toBe('dealer');
		const state = settleRound(dealt);
		expect(state.hands[0].result).toBe('lose');
		expect(state.net).toBe(-10);
	});
});

describe('legal actions', () => {
	it('offers everything the table does to a fresh pair, in H,S,D,P,R order', () => {
		const state = deal(rules({ surrender: 'late', dealerPeek: true }), [
			'8',
			'9',
			'8',
			'5',
		]);
		expect(legalActions(state)).toEqual(['H', 'S', 'D', 'P', 'R']);
	});

	it('drops the double, the split and the surrender once a card is drawn', () => {
		const ruleSet = rules({ surrender: 'late', dealerPeek: true });
		const state = applyAction(deal(ruleSet, ['8', '9', '8', '5', '2']), 'H');
		expect(legalActions(state)).toEqual(['H', 'S']);
	});

	it('withholds surrender at a table that does not offer it, and es10 off a ten', () => {
		const none = deal(rules({ surrender: 'none' }), ['8', '9', '8', '5']);
		expect(legalActions(none)).not.toContain('R');

		const es10 = rules({ surrender: 'es10' });
		expect(legalActions(deal(es10, ['8', 'T', '8', '5']))).toContain('R');
		expect(legalActions(deal(es10, ['8', '9', '8', '5']))).not.toContain('R');
	});

	it('has nothing to offer once the hand is 21 or bust', () => {
		const state = applyAction(deal(rules(), ['T', '9', '6', '8', '5']), 'H');
		expect(state.hands[0].total).toBe(21);
		expect(state.phase).toBe('dealer');
		expect(legalActions(state)).toEqual([]);
	});
});

describe('splitting', () => {
	const eights: Rank[] = ['8', '9', '8', '5', '8', '3', '8', '2', 'T', 'T'];

	it('splits into two hands, each carrying the base wager', () => {
		const state = applyAction(
			deal(rules({ splitLimit: 2 }), ['8', '9', '8', '5', '3', '2', 'T']),
			'P'
		);
		expect(state.hands).toHaveLength(2);
		expect(state.hands.map((hand) => hand.cards)).toEqual([
			['8', '3'],
			['8', '2'],
		]);
		expect(state.hands.every((hand) => hand.bet === 10 && hand.fromSplit)).toBe(true);
		expect(state.activeHandIndex).toBe(0);
	});

	it('stops resplitting at the split limit', () => {
		let state = applyAction(deal(rules({ splitLimit: 3 }), eights), 'P');
		expect(legalActions(state)).toContain('P');
		state = applyAction(state, 'P');
		expect(state.hands).toHaveLength(3);
		expect(legalActions(state)).not.toContain('P');
	});

	it('honours doubleAfterSplit', () => {
		const script: Rank[] = ['8', '9', '8', '5', '3', '2', 'T'];
		const das = applyAction(deal(rules({ doubleAfterSplit: true }), script), 'P');
		expect(legalActions(das)).toContain('D');
		const noDas = applyAction(deal(rules({ doubleAfterSplit: false }), script), 'P');
		expect(legalActions(noDas)).not.toContain('D');
	});

	it('gives split aces one card each and no decision', () => {
		const script: Rank[] = ['A', '9', 'A', '5', '4', '3', '8'];
		const state = applyAction(
			deal(rules({ hitSplitAces: false, dealerPeek: true }), script),
			'P'
		);
		// Both hands froze at one card, so the round ran straight to the dealer.
		expect(state.phase).toBe('dealer');
		expect(state.hands.map((hand) => hand.cards.length)).toEqual([2, 2]);
	});

	it('draws to split aces at a table that allows it', () => {
		const script: Rank[] = ['A', '9', 'A', '5', '4', '3', '8'];
		const state = applyAction(
			deal(rules({ hitSplitAces: true, dealerPeek: true }), script),
			'P'
		);
		expect(state.phase).toBe('act');
		expect(legalActions(state)).toContain('H');
	});

	it('pays a ten on a split ace as an ordinary 21, not as a natural', () => {
		// A,A against a dealer ten holding an eight; each half draws a ten.
		const state = settleRound(
			applyAction(deal(rules({ dealerPeek: true }), ['A', 'T', 'A', '8', 'T', 'T']), 'P')
		);
		expect(state.hands.map((hand) => hand.total)).toEqual([21, 21]);
		expect(state.hands.every((hand) => hand.blackjack)).toBe(false);
		expect(state.hands.map((hand) => hand.result)).toEqual(['win', 'win']);
		// Even money on both halves, not the 3:2 a natural would have paid.
		expect(state.net).toBe(20);
	});

	it('loses that 21 to a dealer natural rather than pushing with it', () => {
		const state = settleRound(
			applyAction(deal(rules({ dealerPeek: false }), ['A', 'A', 'A', 'T', 'T', 'T']), 'P')
		);
		expect(state.dealer.blackjack).toBe(true);
		expect(state.hands.map((hand) => hand.result)).toEqual(['lose', 'lose']);
		expect(state.net).toBe(-20);
	});

	it('resplits aces only where the rule allows it', () => {
		const script: Rank[] = ['A', '9', 'A', '5', 'A', 'A', '4', '3', '8'];
		const allowed = applyAction(
			deal(rules({ hitSplitAces: true, resplitAces: true, dealerPeek: true }), script),
			'P'
		);
		expect(legalActions(allowed)).toContain('P');
		const refused = applyAction(
			deal(rules({ hitSplitAces: true, resplitAces: false, dealerPeek: true }), script),
			'P'
		);
		expect(legalActions(refused)).not.toContain('P');
	});
});

describe('doubling', () => {
	it('doubles the wager, takes one card and ends the hand', () => {
		const state = settleRound(
			applyAction(deal(rules(), ['5', '6', '6', '9', 'T', '5']), 'D')
		);
		expect(state.hands[0].doubled).toBe(true);
		expect(state.hands[0].bet).toBe(20);
		expect(state.hands[0].cards).toHaveLength(3);
		// 21 against a dealer 20.
		expect(state.net).toBe(20);
	});
});

describe('surrender', () => {
	// Player 16 against a dealer ace holding a ten: a natural, once looked at.
	const vsNatural: Rank[] = ['T', 'A', '6', 'T'];

	it('early beats a dealer natural', () => {
		const dealt = deal(rules({ surrender: 'early', dealerPeek: true }), vsNatural);
		expect(legalActions(dealt)).toContain('R');
		const state = settleRound(applyAction(dealt, 'R'));
		expect(state.hands[0].result).toBe('surrendered');
		expect(state.net).toBe(-5);
	});

	it('takes the whole wager from a first action that is not the surrender', () => {
		const dealt = deal(rules({ surrender: 'early', dealerPeek: true }), vsNatural);
		// Hitting sends the dealer to the hole card, and the natural is still live.
		const state = settleRound(applyAction(dealt, 'H'));
		expect(state.hands[0].cards).toHaveLength(2);
		expect(state.net).toBe(-10);
	});

	it('late loses the whole wager to a dealer natural, which settles first', () => {
		const dealt = deal(rules({ surrender: 'late', dealerPeek: true }), vsNatural);
		// The peek has already happened, so there is no decision left to make.
		expect(dealt.phase).toBe('dealer');
		expect(settleRound(dealt).net).toBe(-10);
	});

	it('takes half the wager against any other dealer hand', () => {
		const state = settleRound(
			applyAction(
				deal(rules({ surrender: 'late', dealerPeek: true }), ['T', '9', '6', 'T']),
				'R'
			)
		);
		expect(state.hands[0].surrendered).toBe(true);
		expect(state.net).toBe(-5);
	});
});

describe('a no-peek table', () => {
	it('takes the doubled wager too when the dealer turns a natural', () => {
		const dealt = deal(rules({ dealerPeek: false }), ['5', 'A', '6', 'T', '9']);
		// Nothing warns the player: the hole card is not looked at until the end.
		expect(dealt.phase).toBe('act');
		const state = settleRound(applyAction(dealt, 'D'));
		expect(state.dealer.blackjack).toBe(true);
		expect(state.net).toBe(-20);
	});

	it('takes both halves of a split as well', () => {
		let state = applyAction(
			deal(rules({ dealerPeek: false }), ['8', 'A', '8', 'T', '3', '2', '9', '9']),
			'P'
		);
		state = applyAction(state, 'S');
		state = settleRound(applyAction(state, 'S'));
		expect(state.net).toBe(-20);
	});

	it('leaves a surrendered stake alone -- it was off the table already', () => {
		const state = settleRound(
			applyAction(
				deal(rules({ dealerPeek: false, surrender: 'late' }), ['5', 'A', '6', 'T']),
				'R'
			)
		);
		expect(state.dealer.blackjack).toBe(true);
		expect(state.net).toBe(-5);
	});
});

describe('insurance', () => {
	const offered = (overrides: Partial<RuleSet> = {}): RuleSet => ({
		...DEFAULT_RULE_SET,
		insurance: true,
		dealerPeek: true,
		...overrides,
	});

	it('is offered against an ace and pays 2:1 on a dealer natural', () => {
		const dealt = deal(offered(), ['9', 'A', '7', 'T']);
		expect(dealt.phase).toBe('insurance');
		expect(dealt.insuranceOffered).toBe(true);

		const state = settleRound(resolveInsurance(dealt, true));
		// The insurance stake of 5 pays 10; the hand loses its 10.
		expect(state.net).toBe(0);
	});

	it('loses the stake when the dealer misses', () => {
		const state = resolveInsurance(deal(offered(), ['9', 'A', '7', '5', '5']), true);
		expect(state.phase).toBe('act');
		expect(state.insuranceBet).toBe(5);
		expect(settleRound(applyAction(state, 'S')).net).toBe(-15);
	});

	it('declining costs nothing', () => {
		const state = resolveInsurance(deal(offered(), ['9', 'A', '7', '5', '5']), false);
		expect(state.insuranceBet).toBe(0);
		expect(state.insuranceOffered).toBe(false);
		expect(settleRound(applyAction(state, 'S')).net).toBe(-10);
	});

	it('is not offered where the table does not have it', () => {
		expect(deal(rules({ dealerPeek: true }), ['9', 'A', '7', '5']).phase).toBe('act');
	});
});

describe('the state itself', () => {
	it('hands back a new object rather than editing the old one', () => {
		const state = deal(rules(), ['5', '9', '6', '8', '2', '5']);
		const next = applyAction(state, 'H');
		expect(next).not.toBe(state);
		expect(state.hands[0].cards).toHaveLength(2);
		expect(next.hands[0].cards).toHaveLength(3);
	});

	it('refuses an action the table does not allow', () => {
		const state = deal(rules({ surrender: 'none' }), ['5', '9', '6', '8']);
		expect(() => applyAction(state, 'R')).toThrow();
	});

	it('settles once and only once', () => {
		const settled = settleRound(applyAction(deal(rules(), ['T', '9', 'T', '8']), 'S'));
		expect(settleRound(settled)).toBe(settled);
		expect(settled.net).toBe(10);
	});

	it('refuses to deal a second round over a live one', () => {
		const state = deal(rules(), ['5', '9', '6', '8']);
		expect(() => startRound(state, 10)).toThrow();
	});
});

describe('the pre-round felt', () => {
	it('clears the settled hand off the table but keeps the shoe', () => {
		const settled = settleRound(applyAction(deal(rules(), ['T', '9', 'T', '8']), 'S'));
		const next = preRound(settled);

		expect(next.phase).toBe('bet');
		expect(next.hands).toHaveLength(0);
		expect(next.dealer.cards).toHaveLength(0);
		expect(next.shoe).toBe(settled.shoe);
	});

	it('is a no-op outside settled', () => {
		const state = deal(rules(), ['5', '9', '6', '8']);
		expect(preRound(state)).toBe(state);
	});
});
