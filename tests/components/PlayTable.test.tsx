import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';

import type { Rank } from '#utils/ev/cards';
import { DEFAULT_RULE_SET, type PlayerAction, type RuleSet } from '#utils/ev/rules';
import type { Grading } from '#utils/play/coach';
import {
	applyAction,
	createGame,
	preRound,
	settleRound,
	startRound,
	type GameState,
} from '#utils/play/game';
import { DEFAULT_PLAY_CONFIG, type PlayConfig } from '#utils/storage';

import PlayTable from '#c/PlayTable';

import { scriptedShoe } from '../utils/play/scriptedShoe';

/**
 * A round dealt to order. The script is the table's own deal order -- player,
 * upcard, player, hole card -- padded out so the shoe has a plausible depth
 * behind it for the HUD to report.
 */
function dealtState(
	script: readonly Rank[],
	rules: Partial<RuleSet> = {},
	padding = 0
): GameState {
	const filler = Array.from({ length: padding }, (): Rank => '5');
	const ruleSet = { ...DEFAULT_RULE_SET, ...rules };
	const game = createGame(ruleSet, scriptedShoe([...script, ...filler]));
	return startRound(game, 25);
}

/** Hard 16 against a nine: hit, stand and double are live; split and surrender are not. */
const HARD_16 = ['T', '9', '6', '5'] as const;

function renderTable(overrides: Partial<Parameters<typeof PlayTable>[0]> = {}): {
	onAction: ReturnType<typeof vi.fn>;
} {
	const onAction = vi.fn();
	// Instant unless a case says otherwise: everything outside the animation's
	// own tests is about the felt once the cards are down, and the reveal queue
	// holds the round's end back until they are.
	const config: PlayConfig = { ...DEFAULT_PLAY_CONFIG, animationSpeed: 'instant' };
	render(() => (
		<PlayTable
			state={dealtState(HARD_16)}
			stack={1000}
			bet={25}
			unit={10}
			config={config}
			grading={null}
			onAction={onAction}
			onInsurance={() => {}}
			onChip={() => {}}
			onClear={() => {}}
			onRepeat={() => {}}
			onDeal={() => {}}
			onNewShoe={() => {}}
			onNextHand={() => {}}
			{...overrides}
		/>
	));
	return { onAction };
}

/** A graded decision, with only the fields a banner reads set meaningfully. */
function grading(overrides: Partial<Grading> = {}): Grading {
	return {
		chosen: 'H',
		basicAction: 'S',
		countAction: 'S',
		evLostPercent: -2.1,
		chosenEvPercent: -20,
		// Never read by the banner -- the variance it feeds belongs to the stats.
		chosenSecondMoment: 1,
		basicError: true,
		deviationError: false,
		trueCount: 2,
		...overrides,
	};
}

describe('PlayTable', () => {
	describe('the betting rail', () => {
		it('pauses on the result instead of dropping straight into bet sizing', () => {
			// Stand on 16 against a 9 with plenty of shoe left for the dealer to
			// draw out on, then settle -- the round that pauses.
			const settled = settleRound(applyAction(dealtState(HARD_16, {}, 20), 'S'));
			expect(settled.phase).toBe('settled');

			renderTable({ state: settled, bet: 0 });

			expect(document.querySelector('.play-table__chip--25')).toBeNull();
			expect(screen.getByRole('button', { name: 'Next hand' })).toBeDefined();
			expect(screen.getByRole('button', { name: 'Redeal same bet' })).toBeDefined();
		});

		it('reports the result alongside the win/loss amount, below the table', () => {
			const settled = settleRound(applyAction(dealtState(HARD_16, {}, 20), 'S'));

			renderTable({ state: settled, bet: 0 });

			const outcome = document.querySelector('.play-table__info');
			expect(outcome?.textContent).toContain('Lose');
			expect(outcome?.textContent).toContain('£25');
			// No longer sat inline on the hand itself.
			expect(document.querySelector('.play-table__seat .play-table__result')).toBeNull();
		});

		it('clears the felt and offers the chip rail once Next hand is chosen', () => {
			const settled = settleRound(applyAction(dealtState(HARD_16, {}, 20), 'S'));
			const [state, setState] = createSignal<GameState>(settled);
			const config: PlayConfig = {
				...DEFAULT_PLAY_CONFIG,
				animationSpeed: 'instant',
			};
			render(() => (
				<PlayTable
					state={state()}
					stack={1000}
					bet={0}
					unit={10}
					config={config}
					grading={null}
					onAction={() => {}}
					onInsurance={() => {}}
					onChip={() => {}}
					onClear={() => {}}
					onRepeat={() => {}}
					onDeal={() => {}}
					onNewShoe={() => {}}
					onNextHand={() => setState((current) => preRound(current))}
				/>
			));

			expect(screen.getByText('Lose')).toBeDefined();
			fireEvent.click(screen.getByRole('button', { name: 'Next hand' }));

			expect(document.querySelector('.play-table__chip--25')).not.toBeNull();
			expect(screen.getByRole('button', { name: 'Repeat' })).toBeDefined();
			expect(screen.queryByText('Lose')).toBeNull();
			expect(document.querySelector('.play-table__card')).toBeNull();
		});

		it('redeals immediately at the same bet without visiting the rail', () => {
			const onDeal = vi.fn();
			const settled = settleRound(applyAction(dealtState(HARD_16, {}, 20), 'S'));

			renderTable({ state: settled, bet: 25, onDeal });
			fireEvent.click(screen.getByRole('button', { name: 'Redeal same bet' }));

			expect(onDeal).toHaveBeenCalledOnce();
			expect(document.querySelector('.play-table__chip--25')).toBeNull();
		});

		it('answers 0, r and space for Clear, Repeat and Deal', () => {
			const onClear = vi.fn();
			const onRepeat = vi.fn();
			const onDeal = vi.fn();
			const betting = createGame(DEFAULT_RULE_SET, scriptedShoe([...HARD_16]));
			renderTable({ state: betting, bet: 25, onClear, onRepeat, onDeal });

			fireEvent.keyDown(document.body, { key: '0' });
			fireEvent.keyDown(document.body, { key: 'r' });
			fireEvent.keyDown(document.body, { key: ' ' });

			expect(onClear).toHaveBeenCalledOnce();
			expect(onRepeat).toHaveBeenCalledOnce();
			expect(onDeal).toHaveBeenCalledOnce();
		});
	});

	describe('the action bar', () => {
		it('fires the action each number key is bound to', () => {
			const { onAction } = renderTable();

			fireEvent.keyDown(document.body, { key: '1' });
			fireEvent.keyDown(document.body, { key: '2' });
			fireEvent.keyDown(document.body, { key: '3' });

			expect(onAction.mock.calls.map(([action]) => action)).toEqual<PlayerAction[]>([
				'H',
				'S',
				'D',
			]);
		});

		it('still answers the number keys with an action button focused', () => {
			const { onAction } = renderTable();
			const hit = screen.getByRole('button', { name: /Hit/ });
			hit.focus();

			// The press lands on the button, which `isKeyConsumingTarget` would
			// ordinarily treat as having its own use for the key.
			fireEvent.keyDown(hit, { key: '2' });

			expect(onAction).toHaveBeenCalledWith('S');
		});

		it('draws no button for an action this hand cannot take', () => {
			const { onAction } = renderTable({
				state: dealtState(HARD_16, { surrender: 'late' }),
			});

			// Hard 16 is no pair, so the table's split button has nothing to mean on
			// this hand and the bar simply does not draw it.
			expect(screen.queryByRole('button', { name: /Split/ })).toBeNull();

			fireEvent.keyDown(document.body, { key: '4' });
			expect(onAction).not.toHaveBeenCalled();
		});

		it('keeps a shown action on its own key when an earlier one is hidden', () => {
			// Eights against a nine, split into another pair of eights at a table
			// that does not allow doubling after a split: the third slot goes
			// undrawn and the fourth is a live resplit, which still answers to 4.
			const split = applyAction(
				dealtState(['8', '9', '8', '6', '8', '3'], { doubleAfterSplit: false }),
				'P'
			);
			const { onAction } = renderTable({ state: split });

			expect(screen.queryByRole('button', { name: /Double/ })).toBeNull();
			expect(screen.getByRole('button', { name: /Split/ }).textContent).toContain('4');

			fireEvent.keyDown(document.body, { key: '4' });
			expect(onAction).toHaveBeenCalledWith('P');
		});

		it('leaves an action the rules never offer off the bar entirely', () => {
			// The default table has no surrender at all, so the button would never
			// mean anything -- unlike a split, which this pair of eights can take.
			renderTable({ state: dealtState(['8', '9', '8', '6']) });

			expect(screen.queryByRole('button', { name: /Surrender/ })).toBeNull();
			expect(screen.getByRole('button', { name: /Split/ })).toBeDefined();
		});

		it('drops split off the bar at a table that does not allow it', () => {
			const { onAction } = renderTable({
				state: dealtState(HARD_16, { splitLimit: 1, surrender: 'late' }),
			});

			expect(screen.queryByRole('button', { name: /Split/ })).toBeNull();
			// Surrender takes the vacated slot, and its key with it.
			expect(screen.getByRole('button', { name: /Surrender/ }).textContent).toContain(
				'4'
			);
			fireEvent.keyDown(document.body, { key: '4' });
			expect(onAction).toHaveBeenCalledWith('R');
		});
	});

	describe('the shoe HUD', () => {
		it('rounds the decks remaining up', () => {
			// 215 cards left after the four dealt: 4.1 decks, which is still five
			// decks of shoe to play out of.
			renderTable({ state: dealtState(HARD_16, {}, 215) });

			expect(screen.getByText('5 decks left')).toBeDefined();
		});

		it('hides the count unless it is switched on', () => {
			renderTable();
			expect(screen.queryByText(/^RC/)).toBeNull();
		});

		it('shows the running and true counts when it is', () => {
			renderTable({
				config: { ...DEFAULT_PLAY_CONFIG, showCount: true },
				// Both tens and the nine are seen, for -2. The hole card is a five
				// and is not, which is the whole point of drawing it hidden.
				state: dealtState(['T', '9', 'T', '5']),
			});

			expect(screen.getByText(/^RC/).textContent).toContain('RC -2');
			expect(screen.getByText(/^TC/)).toBeDefined();
		});
	});

	describe('the correction banner', () => {
		it('says nothing when coaching is off', () => {
			renderTable({
				config: { ...DEFAULT_PLAY_CONFIG, coaching: 'none' },
				grading: grading(),
			});

			expect(screen.queryByText(/was right here/)).toBeNull();
		});

		it('flags a basic-strategy error at the basic level', () => {
			renderTable({
				config: { ...DEFAULT_PLAY_CONFIG, coaching: 'basic' },
				grading: grading(),
			});

			const banner = screen.getByText(/was right here/);
			expect(banner.textContent).toContain('Stand was right here');
			expect(banner.textContent).toContain('-2.1% EV');
			// The count is not part of the lesson at this level.
			expect(banner.textContent).not.toContain('TC');
		});

		it('leaves a missed deviation alone at the basic level', () => {
			renderTable({
				config: { ...DEFAULT_PLAY_CONFIG, coaching: 'basic' },
				grading: grading({
					chosen: 'H',
					basicAction: 'H',
					countAction: 'S',
					basicError: false,
					deviationError: true,
				}),
			});

			expect(screen.queryByText(/was right here/)).toBeNull();
		});

		it('names the count that moved the play at the deviations level', () => {
			renderTable({
				config: { ...DEFAULT_PLAY_CONFIG, coaching: 'deviations' },
				grading: grading({
					chosen: 'H',
					basicAction: 'H',
					countAction: 'S',
					basicError: false,
					deviationError: true,
					trueCount: 4,
				}),
			});

			const banner = screen.getByText(/was right here/);
			expect(banner.textContent).toContain('Stand was right here');
			expect(banner.textContent).toContain('TC +4');
		});
	});

	describe('the deal animation', () => {
		beforeEach(() => vi.useFakeTimers());
		afterEach(() => vi.useRealTimers());

		it('deals every card at once when the speed is instant', () => {
			renderTable({
				state: dealtState(HARD_16),
				config: { ...DEFAULT_PLAY_CONFIG, animationSpeed: 'instant' },
			});

			// The dealer's up card plus both of the player's -- the default rule
			// set is ENHC, so the hole card is not dealt at all until settling.
			expect(document.querySelectorAll('.play-table__card').length).toBe(3);
		});

		it('reveals one card at a time, 800ms apart at 1x', () => {
			renderTable({
				state: dealtState(HARD_16),
				config: { ...DEFAULT_PLAY_CONFIG, animationSpeed: '1x' },
			});

			expect(document.querySelectorAll('.play-table__card').length).toBe(0);

			// Round the table as a dealer deals it: player's first card...
			vi.advanceTimersByTime(800);
			expect(document.querySelectorAll('.play-table__card').length).toBe(1);

			// ...the up card...
			vi.advanceTimersByTime(800);
			expect(document.querySelectorAll('.play-table__card').length).toBe(2);

			// ...the player's second...
			vi.advanceTimersByTime(800);
			expect(document.querySelectorAll('.play-table__card').length).toBe(3);

			// ...and the hole card, which an ENHC table has nothing to draw for.
			vi.advanceTimersByTime(800);
			expect(document.querySelectorAll('.play-table__card').length).toBe(3);
		});

		it('reveals a card every 200ms at 4x', () => {
			renderTable({
				state: dealtState(HARD_16),
				config: { ...DEFAULT_PLAY_CONFIG, animationSpeed: '4x' },
			});

			vi.advanceTimersByTime(200);
			expect(document.querySelectorAll('.play-table__card').length).toBe(1);
		});

		it("shows a hand's total as its own cards land, not the final total up front", () => {
			// Player cards are T, 6 -- hard 10 once the first is down, hard 16
			// only once both are, never the finished total before then.
			renderTable({
				state: dealtState(HARD_16),
				config: { ...DEFAULT_PLAY_CONFIG, animationSpeed: '1x' },
			});

			const totals = () =>
				Array.from(document.querySelectorAll('.play-table__total')).map(
					(node) => node.textContent
				);

			vi.advanceTimersByTime(800); // player's first card
			expect(totals()).toContain('hard 10');
			expect(totals()).not.toContain('hard 16');

			vi.advanceTimersByTime(800); // dealer's up card
			expect(totals()).not.toContain('hard 16');

			vi.advanceTimersByTime(800); // player's second card
			expect(totals()).toContain('hard 16');
		});

		it("shows the dealer's total as its own cards land through the draw-out", () => {
			// Stand on 16 against a 9, with an all-fives shoe behind it: the
			// dealer draws to 9 + 5 + 5 = 19, deterministically, three cards the
			// felt should read out one at a time rather than jumping to 19.
			const settled = settleRound(applyAction(dealtState(HARD_16, {}, 20), 'S'));
			expect(settled.dealer.cards).toEqual(['9', '5', '5']);
			renderTable({
				state: settled,
				config: { ...DEFAULT_PLAY_CONFIG, animationSpeed: '1x' },
			});

			const dealerTotal = () =>
				document.querySelector('.play-table__seat .play-table__total')?.textContent;

			// The player's own two cards go down first, the up card between them.
			vi.advanceTimersByTime(800);
			expect(dealerTotal()).toBe('');

			vi.advanceTimersByTime(800);
			expect(dealerTotal()).toBe('showing 9');

			// The player's second and the hole card, still face down: the upcard is
			// all the dealer is showing until the player's hand is finished with.
			vi.advanceTimersByTime(800 * 2);
			expect(dealerTotal()).toBe('showing 9');

			// The hole card turns on a beat of its own, and the draw-out follows it
			// one card at a time rather than jumping to 19.
			vi.advanceTimersByTime(800);
			expect(dealerTotal()).toBe('14');

			vi.advanceTimersByTime(800);
			expect(dealerTotal()).toBe('19');
		});

		it('lands the card that busts the player before the dealer answers it', () => {
			// T, 6 against a nine, hit into a ten: the hand busts, and the very
			// same transition turns the hole card over and settles the round. The
			// bust is the player's own card, so it goes down on a beat of its own,
			// with the dealer's hand still reading as the player last saw it.
			const busted = settleRound(
				applyAction(dealtState(['T', '9', '6', '5', 'T'], {}, 20), 'H')
			);
			expect(busted.hands[0].busted).toBe(true);
			renderTable({
				state: busted,
				config: { ...DEFAULT_PLAY_CONFIG, animationSpeed: '1x' },
			});

			const totals = () =>
				Array.from(document.querySelectorAll('.play-table__total')).map(
					(node) => node.textContent
				);

			// The opening deal: player, up card, player, hole card.
			vi.advanceTimersByTime(800 * 4);
			expect(totals()).toEqual(['showing 9', 'hard 16']);

			// The bust lands alone: the dealer is still showing nine.
			vi.advanceTimersByTime(800);
			expect(totals()).toEqual(['showing 9', 'hard 26']);
			expect(screen.queryByText('Bust')).toBeNull();

			// Only then does the dealer turn over the card that answers it.
			vi.advanceTimersByTime(800);
			expect(totals()).toEqual(['14', 'hard 26']);
			expect(screen.getByText('Bust')).toBeDefined();
		});

		it('holds the round back until the cards that decided it have landed', () => {
			// The same 9, 5, 5 draw-out: the state is settled from the first
			// frame, but nothing about the result may be said until the third
			// dealer card is on the felt.
			const settled = settleRound(applyAction(dealtState(HARD_16, {}, 20), 'S'));
			const onNextHand = vi.fn();
			renderTable({
				state: settled,
				bet: 25,
				onNextHand,
				config: { ...DEFAULT_PLAY_CONFIG, animationSpeed: '1x' },
			});

			const info = () => document.querySelector('.play-table__info')?.textContent;

			expect(info()).toContain('Bet');
			expect(screen.queryByText('Lose')).toBeNull();
			expect(screen.queryByRole('button', { name: 'Next hand' })).toBeNull();

			// Space is the settled phase's key, and it is just as early as the banner.
			fireEvent.keyDown(document.body, { key: ' ' });
			expect(onNextHand).not.toHaveBeenCalled();

			// Both player cards, the dealer's two, and the hole card turning over.
			vi.advanceTimersByTime(800 * 5);
			expect(screen.queryByText('Lose')).toBeNull();

			vi.advanceTimersByTime(800); // the dealer's last card
			expect(screen.getByText('Lose')).toBeDefined();
			expect(info()).toContain('£25');
			expect(screen.getByRole('button', { name: 'Next hand' })).toBeDefined();

			fireEvent.keyDown(document.body, { key: ' ' });
			expect(onNextHand).toHaveBeenCalledOnce();
		});

		it('leaves the cards already on the felt in place as a new one lands', () => {
			// The deal gesture is a mount animation, so a card that stays on the
			// felt has to stay the same element -- the state machine hands back
			// fresh `PlayHand` objects every transition, and a seat rebuilt around
			// them would re-deal every card the player is already looking at.
			const dealt = dealtState(HARD_16, {}, 20);
			const [state, setState] = createSignal<GameState>(dealt);
			render(() => (
				<PlayTable
					state={state()}
					stack={1000}
					bet={25}
					unit={10}
					config={{ ...DEFAULT_PLAY_CONFIG, animationSpeed: 'instant' }}
					grading={null}
					onAction={() => {}}
					onInsurance={() => {}}
					onChip={() => {}}
					onClear={() => {}}
					onRepeat={() => {}}
					onDeal={() => {}}
					onNewShoe={() => {}}
					onNextHand={() => {}}
				/>
			));

			const playerCards = () =>
				Array.from(
					document
						.querySelectorAll('.play-table__seat')[1]
						.querySelectorAll('.play-table__card')
				);

			const before = playerCards();
			expect(before.length).toBe(2);

			setState(applyAction(dealt, 'H'));

			const after = playerCards();
			expect(after.length).toBe(3);
			expect(after[0]).toBe(before[0]);
			expect(after[1]).toBe(before[1]);
		});

		it('does not skip the delay when a redeal follows a settled round', () => {
			const settled = settleRound(applyAction(dealtState(HARD_16, {}, 20), 'S'));
			const [state, setState] = createSignal<GameState>(settled);
			const config: PlayConfig = { ...DEFAULT_PLAY_CONFIG, animationSpeed: '1x' };
			render(() => (
				<PlayTable
					state={state()}
					stack={1000}
					bet={25}
					unit={10}
					config={config}
					grading={null}
					onAction={() => {}}
					onInsurance={() => {}}
					onChip={() => {}}
					onClear={() => {}}
					onRepeat={() => {}}
					onDeal={() => {}}
					onNewShoe={() => {}}
					onNextHand={() => {}}
				/>
			));

			// Redeals straight from `settled` without visiting `bet`, and the new
			// hand happens to be the same shape (one dealer up card, two player
			// cards) as the one just cleared off the felt.
			setState(dealtState(HARD_16, {}, 20));

			expect(document.querySelectorAll('.play-table__card').length).toBe(0);
			vi.advanceTimersByTime(800);
			expect(document.querySelectorAll('.play-table__card').length).toBe(1);
		});
	});
});
