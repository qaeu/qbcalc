/**
 * The reveal queue's arithmetic: how much of a round the felt has shown, and the
 * next card to show, in the order a table deals them. Pure -- `createRevealQueue`
 * in `#c/Felt` is the reactive half that steps through it on a timer. Shared by
 * the Play and Train felts, so a card lands the same way on both. See
 * docs/play-model.md §The round.
 */

import { addValue, type Rank } from '../ev/cards';
import type { AnimationSpeed } from '../settings/storage';
import type { GameState, PlayHand } from './game';

/**
 * The pause before each new card lands, per animation speed. `instant` is a
 * flat zero rather than a fast version of the others, so it skips the reveal
 * queue entirely instead of racing through it.
 */
export const CARD_DEAL_DELAY_MS: Record<AnimationSpeed, number> = {
	'1x': 800,
	'2x': 400,
	'4x': 200,
	instant: 0,
};

/** How much of the table is currently shown. */
export interface RevealCounts {
	dealer: number;
	hands: number[];
	/**
	 * Whether the hole card has been turned over on the felt. Its own step in
	 * the queue rather than something read off the state: turning it over is a
	 * move the dealer makes, and it has to land on a beat of its own.
	 */
	hole: boolean;
}

export const NOTHING_REVEALED: RevealCounts = { dealer: 0, hands: [], hole: false };

export function targetCounts(state: GameState): RevealCounts {
	return {
		dealer: state.dealer.cards.length,
		hands: state.hands.map((hand) => hand.cards.length),
		// A round with no hole card dealt yet has nothing to turn over, so the
		// queue must not sit waiting on a step that will never come.
		hole: !state.dealer.holeHidden && state.dealer.cards.length > 1,
	};
}

/** Whether every player hand has all of its cards on the felt. */
function handsReached(revealed: RevealCounts, target: RevealCounts): boolean {
	return target.hands.every((count, index) => (revealed.hands[index] ?? 0) >= count);
}

export function countsReached(revealed: RevealCounts, target: RevealCounts): boolean {
	return (
		revealed.dealer >= target.dealer
		&& handsReached(revealed, target)
		&& (revealed.hole || !target.hole)
	);
}

/** One card onto hand `index`, or `null` if that hand already has it. */
function dealToHand(
	revealed: RevealCounts,
	target: RevealCounts,
	index: number,
	upTo: number
): RevealCounts | null {
	const have = revealed.hands[index] ?? 0;
	if (have >= upTo || have >= target.hands[index]) return null;
	const hands = [...revealed.hands];
	hands[index] = have + 1;
	return { ...revealed, hands };
}

/**
 * One more card than `revealed`, toward `target`, in the order a table deals
 * them. The opening deal goes round the seats a card at a time -- player,
 * upcard, player, hole -- so while any seat is still short of its first two
 * cards the reveal follows that rotation. After it, the order is the order of
 * play: every player hand left to right, then the hole card turning over, and
 * only then whatever the dealer draws on it. That tail is what keeps a bust on
 * the felt before the dealer answers it -- a busted round settles the hole card
 * and the whole draw-out in the same transition the bust happens in, so without
 * an order they would all land on the beat the bust does.
 */
export function revealOneMore(
	revealed: RevealCounts,
	target: RevealCounts
): RevealCounts {
	for (let round = 1; round <= 2; round += 1) {
		for (let index = 0; index < target.hands.length; index += 1) {
			const dealt = dealToHand(revealed, target, index, round);
			if (dealt !== null) return dealt;
		}
		if (revealed.dealer < round && revealed.dealer < target.dealer) {
			return { ...revealed, dealer: revealed.dealer + 1 };
		}
	}
	for (let index = 0; index < target.hands.length; index += 1) {
		const dealt = dealToHand(revealed, target, index, Infinity);
		if (dealt !== null) return dealt;
	}
	if (target.hole && !revealed.hole) {
		return { ...revealed, hole: true };
	}
	if (revealed.dealer < target.dealer) {
		return { ...revealed, dealer: revealed.dealer + 1 };
	}
	return revealed;
}

/**
 * `revealed` clamped down to what `target` holds, so a fresh round's empty
 * hands pull the felt back to nothing while a split's two-card hands keep the
 * card each of them already showed. `fromScratch` drops everything instead --
 * a round dealt straight over a settled one has the same shape and would
 * otherwise read as already shown.
 */
export function clampRevealed(
	revealed: RevealCounts,
	target: RevealCounts,
	fromScratch: boolean
): RevealCounts {
	const baseline = fromScratch ? NOTHING_REVEALED : revealed;
	return {
		dealer: Math.min(baseline.dealer, target.dealer),
		hands: target.hands.map((count, index) =>
			Math.min(baseline.hands[index] ?? 0, count)
		),
		// A hole card cannot stay turned over into a round that has not dealt one
		// yet, so the next deal puts it back face down.
		hole: baseline.hole && target.hole,
	};
}

/**
 * The total of just the cards dealt so far -- `PlayHand.total` and
 * `DealerHand.total` are the hand's *final* total, computed the instant the
 * state machine deals the card, which would say "bust" or "21" before the felt
 * has shown the card that made it true. Mirrors `totalOf` in game.ts.
 */
export function partialTotal(cards: readonly Rank[]): [number, boolean] {
	let total = 0;
	let soft = false;
	for (const card of cards) [total, soft] = addValue(total, soft, card);
	return [total, soft];
}

/**
 * How a hand reads aloud as its cards land: "hard 16", "soft 18", "blackjack".
 * Read off `visibleCount` cards rather than the hand's own total, so the total
 * only ever reflects what has actually been dealt onto the felt.
 */
export function totalLabel(hand: PlayHand, visibleCount: number): string {
	const cards = hand.cards.slice(0, visibleCount);
	if (cards.length === 0) return '';
	if (hand.blackjack && visibleCount >= hand.cards.length) return 'blackjack';
	const [total, soft] = partialTotal(cards);
	return `${soft ? 'soft' : 'hard'} ${total}`;
}

/**
 * The dealer's own total, read off `visibleCount` cards the same way -- and,
 * while the hole card is still hidden, off the upcard alone regardless of
 * `visibleCount`, since a hidden card is not information the felt gives out
 * just because the reveal queue has nominally reached its slot.
 */
export function dealerTotalLabel(
	state: GameState,
	visibleCount: number,
	holeHidden: boolean
): string | null {
	const dealer = state.dealer;
	const cards = dealer.cards
		.slice(0, visibleCount)
		.filter((_, index) => !(holeHidden && index === 1));
	if (cards.length === 0) return null;
	const [total] = partialTotal(cards);
	if (holeHidden) return `showing ${total}`;
	const fullyRevealed = visibleCount >= dealer.cards.length;
	return `${fullyRevealed && total > 21 ? 'bust ' : ''}${total}`;
}
