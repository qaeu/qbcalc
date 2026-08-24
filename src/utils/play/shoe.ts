/**
 * A shoe that is actually dealt, card by card, for the Play view. The EV engine
 * works in compositions -- how much of each rank a shoe holds -- because it
 * enumerates every card it could turn; a played shoe turns one, so it is an
 * ordered array with a cursor. See docs/play-model.md.
 */

import { RANKS, type Rank } from '../ev/cards';
import { baseComposition, CARDS_PER_DECK, type TagValues } from '../ev/composition';
import type { RuleSet } from '../ev/rules';
import { mulberry32 } from './rng';

/** The dealt shoe, as the round state machine and the HUD read it. */
export interface DealtShoe {
	/** Removes and returns the next card, moving the running count by its tag. */
	draw(): Rank;
	/**
	 * Removes and returns the next card *without* counting it -- the dealer's
	 * hole card, which the player has not seen. `revealHidden` folds it in.
	 */
	drawHidden(): Rank;
	/** Counts every card drawn hidden so far. A no-op when none are pending. */
	revealHidden(): void;
	/** Cards not yet dealt. */
	cardsRemaining(): number;
	/** `cardsRemaining / CARDS_PER_DECK` -- unrounded; the HUD rounds it up. */
	decksRemaining(): number;
	/** Running count of the cards dealt *and seen* so far, under `tags`. */
	runningCount(): number;
	/** `runningCount / decksRemaining`, 0 when no decks remain. */
	trueCount(): number;
	/** The cut card has been passed: shuffle before the next round. */
	needsShuffle(): boolean;
	/** Puts every card back and resets the count. */
	shuffle(): void;
}

/** One `Rank` per card in the shoe, in composition order before the shuffle. */
function shoeCards(ruleSet: RuleSet): Rank[] {
	const comp = baseComposition(ruleSet);
	const cards: Rank[] = [];
	// `baseComposition` counts in half-card units, so a rank holds `halfCards / 2`
	// real cards -- see docs/ev-model.md §Method.
	comp.forEach((halfCards, index) => {
		for (let card = 0; card < halfCards / 2; card += 1) cards.push(RANKS[index]);
	});
	return cards;
}

/** Fisher-Yates, in place: the one buffer is reshuffled rather than rebuilt. */
function shuffleCards(cards: Rank[], random: () => number): void {
	for (let index = cards.length - 1; index > 0; index -= 1) {
		const swap = Math.floor(random() * (index + 1));
		const held = cards[index];
		cards[index] = cards[swap];
		cards[swap] = held;
	}
}

/**
 * A shoe under `ruleSet`, counted with `tags` and shuffled from `seed`. One
 * random stream serves the shoe's whole life, so a session replays exactly from
 * its seed however many times it reshuffles.
 */
export function createShoe(ruleSet: RuleSet, tags: TagValues, seed: number): DealtShoe {
	const cards = shoeCards(ruleSet);
	const random = mulberry32(seed);
	// Held inside the shoe rather than read off the rule set each time: the cut
	// card belongs to the shoe as it was shuffled.
	const cutCard = Math.floor((cards.length * ruleSet.penetrationPercent) / 100);
	let dealt = 0;
	let count = 0;
	let hidden: Rank[] = [];

	const take = (): Rank => {
		if (dealt >= cards.length) throw new Error('The shoe has no cards left to deal.');
		const card = cards[dealt];
		dealt += 1;
		return card;
	};

	const shuffle = (): void => {
		shuffleCards(cards, random);
		dealt = 0;
		count = 0;
		hidden = [];
	};
	shuffle();

	return {
		draw() {
			const card = take();
			// The tag as the system prints it. `countRounds.ts` centres its tags on
			// their own mean instead, because it measures a whole shoe's count
			// distribution; a player at the table adds up what is on the felt.
			count += tags[card];
			return card;
		},
		drawHidden() {
			const card = take();
			hidden.push(card);
			return card;
		},
		revealHidden() {
			for (const card of hidden) count += tags[card];
			hidden = [];
		},
		cardsRemaining: () => cards.length - dealt,
		decksRemaining: () => (cards.length - dealt) / CARDS_PER_DECK,
		runningCount: () => count,
		trueCount() {
			const decks = (cards.length - dealt) / CARDS_PER_DECK;
			return decks > 0 ? count / decks : 0;
		},
		needsShuffle: () => dealt >= cutCard,
		shuffle,
	};
}

/**
 * The names the module was drafted under, kept as aliases so either spelling
 * resolves to the one shoe.
 */
export type PlayShoe = DealtShoe;
export const createPlayShoe = createShoe;
