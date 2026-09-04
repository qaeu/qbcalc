import { describe, it, expect } from 'vitest';

import type { Rank } from '#utils/ev/cards';
import { DEFAULT_RULE_SET } from '#utils/ev/rules';
import { HI_LO_TAGS } from '#utils/countingSystems';
import { applyAction, createGame, startRound, type GameState } from '#utils/play/game';
import {
	isStoredPlaySession,
	sessionFromStored,
	toStoredSession,
	type PlaySession,
} from '#utils/play/session';
import { createShoe } from '#utils/play/shoe';

const SHOE_KEY = 'test-shoe';

function session(game: GameState, overrides: Partial<PlaySession> = {}): PlaySession {
	return { game, bet: 50, lastBet: 25, seed: 7, shoeIndex: 2, ...overrides };
}

/** A round part-played out of a real seeded shoe: hit once, still acting. */
function midRound(): GameState {
	const shoe = createShoe(DEFAULT_RULE_SET, HI_LO_TAGS, 7);
	let state = startRound(createGame(DEFAULT_RULE_SET, shoe), 50);
	while (state.phase === 'act' && state.hands[0].cards.length < 3) {
		state = applyAction(state, 'H');
	}
	return state;
}

/** JSON round trip, since that is what localStorage actually does to a record. */
function stored(from: PlaySession): unknown {
	return JSON.parse(JSON.stringify(toStoredSession(from, SHOE_KEY)));
}

describe('play session', () => {
	it('restores the round on the felt as it stood', () => {
		const original = session(midRound());
		const parsed = stored(original);
		expect(isStoredPlaySession(parsed)).toBe(true);
		if (!isStoredPlaySession(parsed)) return;

		const restored = sessionFromStored(parsed, DEFAULT_RULE_SET, HI_LO_TAGS);

		expect(restored.game.phase).toBe(original.game.phase);
		expect(restored.game.hands[0].cards).toEqual(original.game.hands[0].cards);
		expect(restored.game.dealer.cards).toEqual(original.game.dealer.cards);
		expect(restored.game.dealer.holeHidden).toBe(true);
		expect(restored.bet).toBe(50);
		expect(restored.lastBet).toBe(25);
		expect(restored.seed).toBe(7);
		expect(restored.shoeIndex).toBe(2);
	});

	it('deals on from where the shoe stopped, count and hole card included', () => {
		const original = session(midRound());
		const parsed = stored(original);
		if (!isStoredPlaySession(parsed))
			throw new Error('the guard rejected its own record');
		const restored = sessionFromStored(parsed, DEFAULT_RULE_SET, HI_LO_TAGS);

		expect(restored.game.shoe.cardsRemaining()).toBe(original.game.shoe.cardsRemaining());
		expect(restored.game.shoe.runningCount()).toBe(original.game.shoe.runningCount());

		// The hole card is still hidden on both, so both move by the same tag when
		// it is turned over -- it was stored as pending, not as counted.
		restored.game.shoe.revealHidden();
		original.game.shoe.revealHidden();
		expect(restored.game.shoe.runningCount()).toBe(original.game.shoe.runningCount());

		const next = (): Rank[] => Array.from({ length: 5 }, () => restored.game.shoe.draw());
		const same = Array.from({ length: 5 }, () => original.game.shoe.draw());
		expect(next()).toEqual(same);
	});

	it('keeps dealing the same shuffles after the shoe is exhausted', () => {
		const original = session(midRound());
		const parsed = stored(original);
		if (!isStoredPlaySession(parsed))
			throw new Error('the guard rejected its own record');
		const restored = sessionFromStored(parsed, DEFAULT_RULE_SET, HI_LO_TAGS);

		// The shuffle stream is stored with the shoe, so the *next* shuffle is the
		// one the uninterrupted session would have dealt, not a rerun of the first.
		restored.game.shoe.shuffle();
		original.game.shoe.shuffle();
		expect(Array.from({ length: 10 }, () => restored.game.shoe.draw())).toEqual(
			Array.from({ length: 10 }, () => original.game.shoe.draw())
		);
	});

	it('rejects a record that is not the shape it claims', () => {
		const parsed = stored(session(midRound())) as Record<string, unknown>;

		expect(isStoredPlaySession({ ...parsed, game: undefined })).toBe(false);
		expect(isStoredPlaySession({ ...parsed, shoe: { cards: ['2'] } })).toBe(false);
		expect(isStoredPlaySession({ ...parsed, bet: 'fifty' })).toBe(false);
		expect(isStoredPlaySession(null)).toBe(false);
	});

	it('rejects a cursor or an active hand pointing past what is there', () => {
		const parsed = stored(session(midRound())) as {
			shoe: Record<string, unknown>;
			game: Record<string, unknown>;
		};

		expect(
			isStoredPlaySession({
				...parsed,
				shoe: { ...parsed.shoe, dealt: (parsed.shoe.cards as Rank[]).length + 1 },
			})
		).toBe(false);
		expect(
			isStoredPlaySession({ ...parsed, game: { ...parsed.game, activeHandIndex: 3 } })
		).toBe(false);
	});

	it('rejects a card that is not a rank', () => {
		const parsed = stored(session(midRound())) as {
			shoe: Record<string, unknown>;
		};
		const cards = [...(parsed.shoe.cards as Rank[])];
		cards[0] = '11' as Rank;

		expect(isStoredPlaySession({ ...parsed, shoe: { ...parsed.shoe, cards } })).toBe(
			false
		);
	});
});
