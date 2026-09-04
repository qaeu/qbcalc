/**
 * A Play session in a form that survives a reload: the round on the felt, the
 * shoe it is being dealt out of, and the money around it, flattened to JSON and
 * read back under a guard. See docs/play-model.md §The bookkeeping around it.
 *
 * Two things are deliberately *not* stored and are re-injected on the way back
 * in: the rule set and the tag vector. Both are the sidebar's to own, and a
 * session is only ever restored under a matching `shoeKey` -- so the ones the
 * app is live with are by definition the ones the shoe was dealt under.
 */

import { RANKS, type Rank } from '../ev/cards';
import type { TagValues } from '../ev/composition';
import type { RuleSet } from '../ev/rules';
import type { GameState, PlayPhase } from './game';
import { restoreShoe, type ShoeSnapshot } from './shoe';

/** Everything the view holds about a session in progress. */
export interface PlaySession {
	game: GameState;
	/** The bet being built on the rail. */
	bet: number;
	/** What the last round was dealt for, which `Repeat` puts back. */
	lastBet: number;
	/** The seed the session's shoes are dealt from. */
	seed: number;
	/** Which shoe of the session this is; `seed + shoeIndex` shuffles the next one. */
	shoeIndex: number;
}

/** The round, minus the two things rebuilt rather than stored. */
type StoredGame = Omit<GameState, 'shoe' | 'ruleSet'>;

export interface StoredPlaySession {
	/**
	 * The game the shoe was dealt for, as `PlayView` keys it. A stored session
	 * whose key no longer matches is dropped rather than restored: the rules it
	 * was dealt and graded under are not the rules now being played.
	 */
	shoeKey: string;
	seed: number;
	shoeIndex: number;
	bet: number;
	lastBet: number;
	shoe: ShoeSnapshot;
	game: StoredGame;
}

const PHASES: readonly PlayPhase[] = ['bet', 'insurance', 'act', 'dealer', 'settled'];

const HAND_RESULTS: readonly string[] = [
	'blackjack',
	'win',
	'push',
	'lose',
	'bust',
	'surrendered',
];

function isRank(value: unknown): value is Rank {
	return RANKS.includes(value as Rank);
}

function isRankArray(value: unknown): value is Rank[] {
	return Array.isArray(value) && value.every(isRank);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isPlayHand(value: unknown): boolean {
	if (!isRecord(value)) return false;
	return (
		isRankArray(value.cards)
		&& Number.isFinite(value.bet)
		&& Number.isFinite(value.total)
		&& typeof value.soft === 'boolean'
		&& typeof value.fromSplit === 'boolean'
		&& typeof value.fromSplitAces === 'boolean'
		&& typeof value.doubled === 'boolean'
		&& typeof value.surrendered === 'boolean'
		&& typeof value.busted === 'boolean'
		&& typeof value.blackjack === 'boolean'
		&& (value.result === null
			|| (typeof value.result === 'string' && HAND_RESULTS.includes(value.result)))
		&& Number.isFinite(value.net)
	);
}

function isDealerHand(value: unknown): boolean {
	if (!isRecord(value)) return false;
	return (
		isRankArray(value.cards)
		&& typeof value.holeHidden === 'boolean'
		&& Number.isFinite(value.total)
		&& typeof value.soft === 'boolean'
		&& typeof value.blackjack === 'boolean'
		&& typeof value.busted === 'boolean'
	);
}

function isShoeSnapshot(value: unknown): value is ShoeSnapshot {
	if (!isRecord(value)) return false;
	return (
		isRankArray(value.cards)
		&& isRankArray(value.hidden)
		&& Number.isInteger(value.dealt)
		&& (value.dealt as number) >= 0
		// A cursor past the end of the shoe would throw on the next draw rather
		// than deal a bad card, so it is checked here instead.
		&& (value.dealt as number) <= value.cards.length
		&& Number.isFinite(value.count)
		&& Number.isInteger(value.cutCard)
		&& Number.isInteger(value.rng)
	);
}

function isStoredGame(value: unknown): value is StoredGame {
	if (!isRecord(value)) return false;
	return (
		PHASES.includes(value.phase as PlayPhase)
		&& Array.isArray(value.hands)
		&& value.hands.every(isPlayHand)
		&& Number.isInteger(value.activeHandIndex)
		// -1 outside the `act` phase, and otherwise a hand that is really there.
		&& (value.activeHandIndex as number) >= -1
		&& (value.activeHandIndex as number) < value.hands.length
		&& isDealerHand(value.dealer)
		&& Number.isFinite(value.insuranceBet)
		&& Number.isFinite(value.net)
		&& typeof value.insuranceOffered === 'boolean'
	);
}

export function isStoredPlaySession(value: unknown): value is StoredPlaySession {
	if (!isRecord(value)) return false;
	return (
		typeof value.shoeKey === 'string'
		&& Number.isFinite(value.seed)
		&& Number.isInteger(value.shoeIndex)
		&& Number.isFinite(value.bet)
		&& Number.isFinite(value.lastBet)
		&& isShoeSnapshot(value.shoe)
		&& isStoredGame(value.game)
	);
}

/** The session as JSON, under the `shoeKey` the shoe was dealt for. */
export function toStoredSession(
	session: PlaySession,
	shoeKey: string
): StoredPlaySession {
	const game = session.game;
	return {
		shoeKey,
		seed: session.seed,
		shoeIndex: session.shoeIndex,
		bet: session.bet,
		lastBet: session.lastBet,
		shoe: game.shoe.snapshot(),
		// Field by field rather than spread-and-delete, so a field added to
		// `GameState` fails to compile here instead of quietly going unstored.
		game: {
			phase: game.phase,
			hands: game.hands,
			activeHandIndex: game.activeHandIndex,
			dealer: game.dealer,
			insuranceBet: game.insuranceBet,
			net: game.net,
			insuranceOffered: game.insuranceOffered,
		},
	};
}

/**
 * The session a `stored` record describes, dealing on under the live `ruleSet`
 * and `tags`. Only call it for a record whose `shoeKey` matches theirs.
 */
export function sessionFromStored(
	stored: StoredPlaySession,
	ruleSet: RuleSet,
	tags: TagValues
): PlaySession {
	return {
		game: { ...stored.game, ruleSet, shoe: restoreShoe(tags, stored.shoe) },
		bet: stored.bet,
		lastBet: stored.lastBet,
		seed: stored.seed,
		shoeIndex: stored.shoeIndex,
	};
}
