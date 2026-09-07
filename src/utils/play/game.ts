/**
 * One round of blackjack as a state machine: the deal, what the player may do
 * next, and how the money settles. Every rule in `RuleSet` reaches it -- the EV
 * engine's grids and this module have to describe the same game, or the coach
 * would grade a hand that was never on the felt. See docs/play-model.md.
 *
 * Every exported function is pure: it returns a new `GameState` rather than
 * mutating the one it was handed. The `DealtShoe` inside is the one deliberate
 * exception -- a shoe is a physical thing being dealt out of, shared by
 * reference, and un-dealing a card is not a transition anyone can make.
 */

import { addValue, type Rank } from '../ev/cards';
import type { BlackjackPayout, PlayerAction, RuleSet } from '../ev/rules';
import type { DealtShoe } from './shoe';

/** Where a round is: betting, offered insurance, acting, dealer's turn, paid. */
export type PlayPhase = 'bet' | 'insurance' | 'act' | 'dealer' | 'settled';

/** How a settled hand finished, for the felt's per-hand label. */
export type HandResult = 'blackjack' | 'win' | 'push' | 'lose' | 'bust' | 'surrendered';

export interface PlayHand {
	cards: Rank[];
	/** Money on this hand, already doubled if it doubled. */
	bet: number;
	total: number;
	soft: boolean;
	/** Came out of a split, so it can never be a natural. */
	fromSplit: boolean;
	/** Came out of a split of aces -- one card only unless `hitSplitAces`. */
	fromSplitAces: boolean;
	doubled: boolean;
	surrendered: boolean;
	busted: boolean;
	/** Two cards totalling 21 on the opening deal (never after a split). */
	blackjack: boolean;
	/** Set once the round settles. */
	result: HandResult | null;
	/** Net money won (negative for a loss), set once the round settles. */
	net: number;
}

export interface DealerHand {
	cards: Rank[];
	/** The hole card is dealt but not shown. */
	holeHidden: boolean;
	/** While `holeHidden`, the upcard alone -- all the player is allowed to know. */
	total: number;
	soft: boolean;
	blackjack: boolean;
	busted: boolean;
}

export interface GameState {
	phase: PlayPhase;
	shoe: DealtShoe;
	ruleSet: RuleSet;
	hands: PlayHand[];
	/** Index into `hands`; -1 outside the `act` phase. */
	activeHandIndex: number;
	dealer: DealerHand;
	/** The insurance side bet, 0 if not taken or not offered. */
	insuranceBet: number;
	/** Net money settled for the whole round, valid in `settled`. */
	net: number;
	/** Insurance is offered this round and has not been answered yet. */
	insuranceOffered: boolean;
}

/** What a natural returns per unit wagered, as the felt writes it. */
const BLACKJACK_PAYOUT_VALUE: Record<BlackjackPayout, number> = {
	'3:2': 1.5,
	'6:5': 1.2,
	'1:1': 1,
};

/**
 * The same figure as a function, for a caller that has to price a natural rather
 * than pay one: the sim, which needs a round nobody acted in to have an
 * expectation as well as a result. See docs/sim-model.md §Accumulating EV.
 */
export function blackjackPayoutValue(payout: BlackjackPayout): number {
	return BLACKJACK_PAYOUT_VALUE[payout];
}

function totalOf(cards: readonly Rank[]): [number, boolean] {
	let total = 0;
	let soft = false;
	for (const card of cards) [total, soft] = addValue(total, soft, card);
	return [total, soft];
}

function cloneHand(hand: PlayHand): PlayHand {
	return { ...hand, cards: [...hand.cards] };
}

/** A fresh state object per entry point, so callers can hold the old one. */
function cloneState(state: GameState): GameState {
	return {
		...state,
		dealer: { ...state.dealer, cards: [...state.dealer.cards] },
		hands: state.hands.map(cloneHand),
	};
}

function newHand(cards: Rank[], bet: number, partial?: Partial<PlayHand>): PlayHand {
	const [total, soft] = totalOf(cards);
	return {
		cards,
		bet,
		total,
		soft,
		fromSplit: false,
		fromSplitAces: false,
		doubled: false,
		surrendered: false,
		busted: total > 21,
		blackjack: cards.length === 2 && total === 21,
		result: null,
		net: 0,
		...partial,
	};
}

function retotal(hand: PlayHand): void {
	const [total, soft] = totalOf(hand.cards);
	hand.total = total;
	hand.soft = soft;
	hand.busted = total > 21;
}

function upcardOf(state: GameState): Rank {
	return state.dealer.cards[0];
}

function dealerHasNatural(state: GameState): boolean {
	const [total] = totalOf(state.dealer.cards);
	return state.dealer.cards.length === 2 && total === 21;
}

/**
 * Whether the dealer's hole-card check waits for the player's first action. An
 * early surrender is taken *before* the dealer looks -- which is exactly what
 * makes it worth taking against a ten or an ace (docs/ev-model.md §Surrender
 * frames) -- so at a table offering one the check cannot happen at the deal.
 */
function peekDeferred(state: GameState): boolean {
	const { surrender } = state.ruleSet;
	if (surrender === 'early') return true;
	return surrender === 'es10' && upcardOf(state) === 'T';
}

/**
 * The dealer's hole-card check, where the table has one. A natural ends the
 * round there and then; anything else leaves the cells the coach grades against
 * in the world they are priced in -- one where the dealer has already missed.
 *
 * Safe to ask more than once, which is what saves a flag on the state: a natural
 * always sends the round straight to the dealer, so a state still being acted on
 * is one whose check either has not happened or found nothing.
 */
function peekEndsRound(state: GameState): boolean {
	return state.ruleSet.dealerPeek && dealerHasNatural(state);
}

/** Whether a hand still has a decision to make. */
function canAct(hand: PlayHand, ruleSet: RuleSet): boolean {
	if (hand.surrendered || hand.total >= 21) return false;
	// A split ace takes exactly one card at most tables, so it never acts.
	return !(hand.fromSplitAces && !ruleSet.hitSplitAces);
}

/** Hands the round over to the dealer, whoever was acting. */
function toDealer(state: GameState): GameState {
	state.activeHandIndex = -1;
	state.phase = 'dealer';
	return state;
}

/** Moves to the next hand with a decision, or hands over to the dealer. */
function advance(state: GameState, from: number): GameState {
	let index = from;
	while (index < state.hands.length && !canAct(state.hands[index], state.ruleSet)) {
		index += 1;
	}
	if (index >= state.hands.length) return toDealer(state);
	state.activeHandIndex = index;
	state.phase = 'act';
	return state;
}

/** From the deal (or the insurance decision) to the player's first action. */
function openRound(state: GameState): GameState {
	if (!peekDeferred(state) && peekEndsRound(state)) return toDealer(state);
	return advance(state, 0);
}

function settleHand(hand: PlayHand, ruleSet: RuleSet, dealer: DealerHand): void {
	if (hand.surrendered) {
		// The stake is off the table before the dealer draws, so even the no-peek
		// natural below has nothing left to take it -- §Surrender frames.
		hand.result = 'surrendered';
		hand.net = -hand.bet / 2;
		return;
	}
	if (hand.blackjack) {
		hand.result = dealer.blackjack ? 'push' : 'blackjack';
		hand.net =
			dealer.blackjack ? 0 : hand.bet * BLACKJACK_PAYOUT_VALUE[ruleSet.blackjackPayout];
		return;
	}
	if (hand.busted) {
		hand.result = 'bust';
		hand.net = -hand.bet;
		return;
	}
	// No peek, dealer natural: the whole wager goes, doubled and split money
	// included -- "all bets lost", per docs/ev-model.md §Simplifications (5).
	if (dealer.blackjack || (!dealer.busted && dealer.total > hand.total)) {
		hand.result = 'lose';
		hand.net = -hand.bet;
		return;
	}
	if (!dealer.busted && dealer.total === hand.total) {
		hand.result = 'push';
		hand.net = 0;
		return;
	}
	hand.result = 'win';
	hand.net = hand.bet;
}

function emptyState(ruleSet: RuleSet, shoe: DealtShoe): GameState {
	return {
		phase: 'bet',
		shoe,
		ruleSet,
		hands: [],
		activeHandIndex: -1,
		dealer: {
			cards: [],
			holeHidden: false,
			total: 0,
			soft: false,
			blackjack: false,
			busted: false,
		},
		insuranceBet: 0,
		net: 0,
		insuranceOffered: false,
	};
}

export function createGame(ruleSet: RuleSet, shoe: DealtShoe): GameState {
	return emptyState(ruleSet, shoe);
}

/**
 * Leaves the settled round behind for a fresh pre-round felt -- the cards and
 * result of the hand just played are gone, same as a dealer clearing the
 * table before the next bet. A no-op outside `settled`, since there is
 * nothing yet to clear.
 */
export function preRound(state: GameState): GameState {
	if (state.phase !== 'settled') return state;
	return emptyState(state.ruleSet, state.shoe);
}

/**
 * Deals a new round for `bet`. Shuffles first if `shoe.needsShuffle()`, so no
 * round is ever dealt across a cut card.
 *
 * The round opens in `insurance` where the table offers it against an ace, in
 * `act` where there is a decision to make, and in `dealer` where there is not --
 * a player natural, or a dealer natural the peek has just found. Paying is
 * always `settleRound`'s job, never this one's.
 */
export function startRound(state: GameState, bet: number): GameState {
	if (state.phase !== 'bet' && state.phase !== 'settled') {
		throw new Error('A round is already in progress.');
	}
	if (state.shoe.needsShuffle()) state.shoe.shuffle();

	// Dealt as a table deals: player, upcard, player, hole card. The hole card is
	// drawn hidden, so the running count does not move until it is turned over.
	const first = state.shoe.draw();
	const up = state.shoe.draw();
	const second = state.shoe.draw();
	const hole = state.shoe.drawHidden();
	const [upTotal, upSoft] = totalOf([up]);

	const next: GameState = {
		phase: 'act',
		shoe: state.shoe,
		ruleSet: state.ruleSet,
		hands: [newHand([first, second], bet)],
		activeHandIndex: 0,
		dealer: {
			cards: [up, hole],
			holeHidden: true,
			total: upTotal,
			soft: upSoft,
			blackjack: false,
			busted: false,
		},
		insuranceBet: 0,
		net: 0,
		insuranceOffered: state.ruleSet.insurance && up === 'A',
	};

	if (next.insuranceOffered) {
		next.phase = 'insurance';
		next.activeHandIndex = -1;
		return next;
	}
	return openRound(next);
}

/**
 * Answers the insurance offer; `take` false declines. The bet is half the
 * wager, as the felt has it, and is settled 2:1 in `settleRound`.
 */
export function resolveInsurance(state: GameState, take: boolean): GameState {
	if (state.phase !== 'insurance') return state;
	const next = cloneState(state);
	next.insuranceBet = take ? next.hands[0].bet / 2 : 0;
	next.insuranceOffered = false;
	return openRound(next);
}

/**
 * The actions this table ever offers, in H,S,D,P,R order -- what belongs on the
 * action bar at all, as opposed to what the hand in front of the player may do
 * with it. A rule that switches an action off for the whole game (no splitting,
 * no surrender) leaves nothing for the button to ever mean; one that only
 * narrows when it applies (`es10` surrender, doubling after a split) still
 * belongs there, and holds the key it answers to on the hands it doesn't cover
 * even though the bar draws no button for it.
 */
export function offeredActions(ruleSet: RuleSet): PlayerAction[] {
	const actions: PlayerAction[] = ['H', 'S', 'D'];
	if (ruleSet.splitLimit >= 2) actions.push('P');
	if (ruleSet.surrender !== 'none') actions.push('R');
	return actions;
}

/** The actions legal for the active hand right now, in H,S,D,P,R order. */
export function legalActions(state: GameState): PlayerAction[] {
	if (state.phase !== 'act') return [];
	const hand = state.hands[state.activeHandIndex];
	if (hand === undefined || !canAct(hand, state.ruleSet)) return [];
	const { ruleSet } = state;

	const actions: PlayerAction[] = ['H', 'S'];
	const twoCards = hand.cards.length === 2;
	if (twoCards && (!hand.fromSplit || ruleSet.doubleAfterSplit)) actions.push('D');
	if (
		twoCards
		&& hand.cards[0] === hand.cards[1]
		&& ruleSet.splitLimit >= 2
		// The limit is a budget belonging to the round -- docs/ev-model.md §The
		// split budget -- so it is the hands on the felt that are counted.
		&& state.hands.length < ruleSet.splitLimit
		&& !(hand.fromSplitAces && !ruleSet.resplitAces)
	) {
		actions.push('P');
	}
	if (
		twoCards
		&& !hand.fromSplit
		&& ruleSet.surrender !== 'none'
		&& (ruleSet.surrender !== 'es10' || upcardOf(state) === 'T')
	) {
		actions.push('R');
	}
	return actions;
}

/**
 * Applies one action to the active hand, advancing the phase as needed. Throws
 * on an action `legalActions` does not offer.
 */
export function applyAction(state: GameState, action: PlayerAction): GameState {
	if (!legalActions(state).includes(action)) {
		throw new Error(`${action} is not a legal action here.`);
	}
	const next = cloneState(state);
	const hand = next.hands[next.activeHandIndex];

	// An early surrender is taken before the dealer looks, so it beats a natural;
	// any other first action is what sends the dealer to the hole card.
	if (action !== 'R' && peekDeferred(next) && peekEndsRound(next)) return toDealer(next);

	// Whether this action ends the hand's turn. A hit does not -- unless it busts
	// or makes 21, which `canAct` reads off the total on its own.
	let handDone = true;

	switch (action) {
		case 'H':
			hand.cards.push(next.shoe.draw());
			retotal(hand);
			handDone = false;
			break;
		case 'S':
			break;
		case 'D':
			hand.bet *= 2;
			hand.doubled = true;
			hand.cards.push(next.shoe.draw());
			retotal(hand);
			break;
		case 'R':
			hand.surrendered = true;
			break;
		case 'P': {
			const fromSplitAces = hand.cards[0] === 'A';
			// Both halves are dealt to at once. A table deals them one at a time,
			// but nothing here depends on the order and a resplit works either way.
			const [left, right] = hand.cards;
			const shared = { fromSplit: true, fromSplitAces };
			// Each of the two carries the same money the one hand did.
			const firstHand = newHand([left, next.shoe.draw()], hand.bet, shared);
			const secondHand = newHand([right, next.shoe.draw()], hand.bet, shared);
			next.hands.splice(next.activeHandIndex, 1, firstHand, secondHand);
			// The first of the two is played next, so the turn stays where it is.
			handDone = false;
			break;
		}
	}

	return advance(next, handDone ? next.activeHandIndex + 1 : next.activeHandIndex);
}

/**
 * Turns the hole card over, plays the dealer out and settles every hand,
 * insurance included. Idempotent once settled, and a no-op before the dealer's
 * turn comes round -- the UI drives it, so the reveal can be animated.
 */
export function settleRound(state: GameState): GameState {
	if (state.phase !== 'dealer') return state;
	const next = cloneState(state);
	const { ruleSet, dealer } = next;

	// The hole card joins the running count exactly here: it has now been seen.
	next.shoe.revealHidden();
	dealer.holeHidden = false;
	dealer.blackjack = dealerHasNatural(next);

	let [total, soft] = totalOf(dealer.cards);
	// Nothing left to beat is nothing left to draw for.
	const live = next.hands.some(
		(hand) => !hand.surrendered && !hand.busted && !hand.blackjack
	);
	if (!dealer.blackjack && live) {
		while (total < 17 || (total === 17 && soft && ruleSet.dealerHitsSoft17)) {
			dealer.cards.push(next.shoe.draw());
			[total, soft] = totalOf(dealer.cards);
		}
	}
	dealer.total = total;
	dealer.soft = soft;
	dealer.busted = total > 21;

	let net = 0;
	for (const hand of next.hands) {
		settleHand(hand, ruleSet, dealer);
		net += hand.net;
	}
	if (next.insuranceBet > 0) {
		net += dealer.blackjack ? 2 * next.insuranceBet : -next.insuranceBet;
	}

	next.net = net;
	next.activeHandIndex = -1;
	next.phase = 'settled';
	return next;
}
