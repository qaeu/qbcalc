import type { Rank } from '#utils/ev/cards';
import { HI_LO_TAGS } from '#utils/countingSystems';
import type { DealtShoe } from '#utils/play/shoe';

/**
 * A shoe of exactly these cards, in this order, so a round can be dealt to
 * order. It satisfies `DealtShoe` in full, which is what keeps the game module
 * free of any seam that exists only for tests.
 *
 * Deal order is the table's: player, upcard, player, hole card, then every draw.
 */
export function scriptedShoe(script: readonly Rank[]): DealtShoe {
	const cards = [...script];
	let dealt = 0;
	let count = 0;
	let hidden: Rank[] = [];

	const take = (): Rank => {
		if (dealt >= cards.length) throw new Error('scripted shoe exhausted');
		const card = cards[dealt];
		dealt += 1;
		return card;
	};

	return {
		draw: () => {
			const card = take();
			count += HI_LO_TAGS[card];
			return card;
		},
		drawHidden: () => {
			const card = take();
			hidden.push(card);
			return card;
		},
		revealHidden: () => {
			for (const card of hidden) count += HI_LO_TAGS[card];
			hidden = [];
		},
		cardsRemaining: () => cards.length - dealt,
		decksRemaining: () => (cards.length - dealt) / 52,
		runningCount: () => count,
		trueCount: () => 0,
		needsShuffle: () => false,
		shuffle: () => {},
		// A scripted shoe is its own script: the snapshot says exactly what it
		// holds, so a restored one deals the same cards in the same order.
		snapshot: () => ({
			cards: [...cards],
			dealt,
			count,
			hidden: [...hidden],
			cutCard: cards.length,
			rng: 0,
		}),
	};
}
