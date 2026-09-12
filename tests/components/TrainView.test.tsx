import { describe, it, expect, afterEach, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { fireEvent, render, screen, within } from '@solidjs/testing-library';

import type { RuleSet } from '#utils/ev/rules';
import type { TrainGrids } from '#utils/evWorkerProtocol';
import { createGame, preRound, type GameState } from '#utils/play/game';
import { createShoe } from '#utils/play/shoe';
import {
	loadTrainConfig,
	loadTrainScores,
	type AnimationSpeed,
} from '#utils/settings/storage';
import { CARD_DEAL_DELAY_MS } from '#utils/play/reveal';
import {
	checkpointRounds,
	COUNTING_PACE,
	dealCountingCards,
	dealCountingRound,
	planDrill,
} from '#utils/train/drills';

import TrainView from '#c/train/TrainView';

import { RULE_SET, TAGS, trainGrids } from '../utils/train/trainGrids';

const SEED = 2024;
const allCounts = planDrill('deviation', 'hard', RULE_SET, TAGS).counts;
const GRIDS = trainGrids(allCounts);

interface Harness {
	setRuleSet: (ruleSet: RuleSet) => void;
	setGrids: (grids: TrainGrids | null) => void;
	requests: (readonly number[])[];
	/** How many times the view has said it no longer wants its grids. */
	cancels: () => number;
	/** The check the view hands the app for a tab switch, while it has one. */
	leaveGuard: () => ((to: string) => boolean) | null;
}

function renderView(
	options: { grids?: TrainGrids | null; speed?: AnimationSpeed } = {}
): Harness {
	const [ruleSet, setRuleSet] = createSignal(RULE_SET);
	const [grids, setGrids] = createSignal<TrainGrids | null>(
		options.grids === undefined ? GRIDS : options.grids
	);
	const requests: (readonly number[])[] = [];
	let cancels = 0;
	let leaveGuard: ((to: string) => boolean) | null = null;
	render(() => (
		<TrainView
			ruleSet={ruleSet()}
			tags={TAGS}
			system="hi-lo"
			animationSpeed={options.speed ?? 'instant'}
			grids={grids()}
			onRequestGrids={(counts) => requests.push(counts)}
			onCancelGrids={() => (cancels += 1)}
			onLeaveGuard={(guard) => (leaveGuard = guard)}
			error={null}
			seed={SEED}
		/>
	));
	return {
		setRuleSet,
		setGrids,
		requests,
		cancels: () => cancels,
		leaveGuard: () => leaveGuard,
	};
}

/** The panel on the picker for one drill. */
function drillPanel(name: string): HTMLElement {
	const heading = screen.getByRole('heading', { name });
	return heading.closest('article') as HTMLElement;
}

function startDrill(name: string, mode: 'Easy' | 'Hard' | 'Test'): void {
	const panel = drillPanel(name);
	fireEvent.click(within(panel).getByRole('radio', { name: mode }));
	fireEvent.click(within(panel).getByRole('button', { name: 'Start' }));
}

const key = (name: string) => fireEvent.keyDown(document, { key: name });

afterEach(() => {
	vi.useRealTimers();
	localStorage.clear();
});

describe('TrainView', () => {
	describe('the picker', () => {
		it('offers the three drills under the sidebar’s game', () => {
			renderView();
			expect(screen.getByRole('heading', { name: 'Basic strategy' })).toBeDefined();
			expect(screen.getByRole('heading', { name: 'Counting accuracy' })).toBeDefined();
			expect(screen.getByRole('heading', { name: 'Deviation recall' })).toBeDefined();
			expect(screen.getByText(/2 decks · S17/)).toBeDefined();
			expect(screen.getAllByText('No run yet')).toHaveLength(3);
		});

		it('remembers the mode each drill was left on', () => {
			renderView();
			const panel = drillPanel('Counting accuracy');
			fireEvent.click(within(panel).getByRole('radio', { name: 'Hard' }));
			expect(within(panel).getByRole('radio', { name: 'Hard' }).ariaChecked).toBe('true');
			expect(panel.querySelector('dd')?.textContent).toBe('5checkpoints');
			expect(loadTrainConfig()?.modes.counting).toBe('hard');
		});

		it('moves a drill’s mode with the arrow keys, as a radio group does', () => {
			renderView();
			const panel = drillPanel('Basic strategy');
			const easy = within(panel).getByRole('radio', { name: 'Easy' });
			fireEvent.click(easy);
			expect(easy.tabIndex).toBe(0);
			fireEvent.keyDown(easy, { key: 'ArrowRight' });
			const hard = within(panel).getByRole('radio', { name: 'Hard' });
			expect(hard.ariaChecked).toBe('true');
			expect(hard.tabIndex).toBe(0);
			expect(easy.tabIndex).toBe(-1);
			expect(document.activeElement).toBe(hard);
			fireEvent.keyDown(hard, { key: 'ArrowLeft' });
			fireEvent.keyDown(easy, { key: 'ArrowLeft' });
			expect(within(panel).getByRole('radio', { name: 'Test' }).ariaChecked).toBe('true');
		});
	});

	describe('a decision drill', () => {
		it('waits on its grids, asking for the counts it needs', () => {
			const harness = renderView({ grids: null });
			startDrill('Deviation recall', 'Hard');
			expect(screen.getByRole('status').textContent).toMatch(/Pricing Deviation recall/);
			expect(harness.requests.at(-1)).toEqual(allCounts);

			harness.setGrids(GRIDS);
			expect(screen.getByText(/Hand/).textContent).toMatch(/1\s*\/\s*20/);
			expect(document.querySelector('.train-drill__puck')).not.toBeNull();
		});

		it('gives a verdict on each answer and a scored board at the end', () => {
			renderView();
			startDrill('Basic strategy', 'Easy');

			for (let hand = 0; hand < 10; hand += 1) {
				expect(document.querySelectorAll('.felt__card').length).toBeGreaterThan(2);
				// Hit is the first slot on the bar, and every question can hit.
				key('1');
				expect(document.querySelector('.felt__verdict')).not.toBeNull();
				expect(document.querySelector('.felt__action.is-answer')).not.toBeNull();
				key(' ');
			}

			expect(screen.getByRole('heading', { name: 'Drill complete' })).toBeDefined();
			expect(screen.getByText('★ New best')).toBeDefined();
			expect(document.querySelector('.train-results__board tr.is-you')).not.toBeNull();

			const boards = loadTrainScores()!;
			const [entry] = Object.values(boards)[0];
			expect(entry).toMatchObject({ total: 10, seed: SEED });

			// Back to the picker, where the run is now the board's best.
			key('Escape');
			const panel = drillPanel('Basic strategy');
			expect(within(panel).getByText(`${entry.correct}/10`)).toBeDefined();
		});

		it('holds a Test’s verdicts back and runs out the clock into a miss', () => {
			vi.useFakeTimers();
			renderView();
			startDrill('Basic strategy', 'Test');
			expect(screen.getByRole('timer')).toBeDefined();

			key('1');
			expect(document.querySelector('.felt__verdict')).toBeNull();
			vi.advanceTimersByTime(300);
			expect(screen.getByText(/Hand/).textContent).toMatch(/2\s*\/\s*40/);

			// Nothing pressed: the clock answers for the player.
			vi.advanceTimersByTime(5_000 + 300);
			expect(screen.getByText(/Hand/).textContent).toMatch(/3\s*\/\s*40/);
		});

		it('starts the clock only once the last card has landed', () => {
			vi.useFakeTimers();
			renderView({ speed: '1x' });
			startDrill('Basic strategy', 'Easy');
			// Mid-deal the bar is locked, so a key press has nothing to answer.
			key('1');
			expect(document.querySelector('.felt__verdict')).toBeNull();
			vi.advanceTimersByTime(800 * 4);
			key('1');
			expect(document.querySelector('.felt__verdict')).not.toBeNull();
		});

		it('abandons the drill when the rules change under it', () => {
			const harness = renderView();
			startDrill('Basic strategy', 'Easy');
			harness.setRuleSet({ ...RULE_SET, dealerHitsSoft17: true });
			expect(screen.getByText(/the drill was abandoned/)).toBeDefined();
			expect(screen.getByRole('heading', { name: 'Basic strategy' })).toBeDefined();
		});

		it('stops wanting its grids once it stops waiting on them', () => {
			const harness = renderView({ grids: null });
			startDrill('Deviation recall', 'Hard');
			expect(harness.cancels()).toBe(0);
			fireEvent.click(screen.getByRole('button', { name: 'Back to drills' }));
			expect(harness.cancels()).toBe(1);
		});

		it('says so on the hint only where there are keys to press', () => {
			renderView();
			startDrill('Basic strategy', 'Easy');
			const keys = document.querySelector('.train-drill__verdict .train-drill__keys');
			expect(keys?.textContent).toMatch(/keys 1–\d/);
		});

		describe('leaving', () => {
			const drillOnScreen = () => document.querySelector('.train-drill') !== null;

			it('quits on Escape before anything is answered', () => {
				renderView();
				startDrill('Deviation recall', 'Easy');
				key('Escape');
				expect(screen.getAllByRole('button', { name: 'Start' })).toHaveLength(3);
			});

			it('asks twice once an answer is in', () => {
				renderView();
				startDrill('Basic strategy', 'Easy');
				key('1');
				key('Escape');
				expect(drillOnScreen()).toBe(true);
				expect(screen.getByRole('button', { name: /Quit anyway · 1 answer lost/ }));
				key('Escape');
				expect(drillOnScreen()).toBe(false);
			});

			it('stands the armed quit down after a few seconds', () => {
				vi.useFakeTimers();
				renderView();
				startDrill('Basic strategy', 'Easy');
				key('1');
				fireEvent.click(screen.getByRole('button', { name: /Quit drill/ }));
				expect(screen.getByRole('button', { name: /Quit anyway/ })).toBeDefined();
				vi.advanceTimersByTime(4000);
				expect(screen.getByRole('button', { name: /Quit drill/ })).toBeDefined();
				key('Escape');
				expect(drillOnScreen()).toBe(true);
			});

			it('leaves Escape to an open list in the sidebar', () => {
				renderView();
				startDrill('Deviation recall', 'Easy');
				const list = document.createElement('div');
				list.setAttribute('role', 'listbox');
				list.tabIndex = -1;
				document.body.append(list);
				fireEvent.keyDown(list, { key: 'Escape' });
				expect(drillOnScreen()).toBe(true);
				list.remove();
			});

			it('asks for a tab twice, the same way', () => {
				const harness = renderView();
				startDrill('Basic strategy', 'Easy');
				expect(harness.leaveGuard()!('Bankroll')).toBe(true);
				key('1');
				expect(harness.leaveGuard()!('Bankroll')).toBe(false);
				expect(screen.getByText(/Click Bankroll again to leave/)).toBeDefined();
				expect(harness.leaveGuard()!('Bankroll')).toBe(true);
			});
		});
	});

	describe('the counting drill', () => {
		/**
		 * The first checkpoint, dealt the drill's own way: the running count at it,
		 * and when it is asked. Each card lands on a beat of its mode's speed, the
		 * hole card turns over on one more, and then the round is left to count.
		 */
		function firstCheckpoint(mode: 'easy' | 'hard'): { count: number; atMs: number } {
			const { speed, countMs } = COUNTING_PACE[mode];
			const rounds = checkpointRounds(mode, SEED + 1)[0];
			let game = createGame(RULE_SET, createShoe(RULE_SET, TAGS, SEED));
			let atMs = 0;
			for (let round = 0; round < rounds; round += 1) {
				game = dealDrill(game, mode);
				atMs += beats(game, mode) * CARD_DEAL_DELAY_MS[speed] + countMs;
			}
			return { count: game.shoe.runningCount(), atMs };
		}

		it('deals rounds on its own, then asks for the running count', () => {
			vi.useFakeTimers();
			renderView();
			startDrill('Counting accuracy', 'Easy');
			const input = screen.getByRole('textbox', { name: 'Running count' });
			expect((input as HTMLInputElement).disabled).toBe(true);

			const { count, atMs } = firstCheckpoint('easy');
			vi.advanceTimersByTime(atMs);
			expect(screen.getByText('Checkpoint 1 of 5')).toBeDefined();
			expect((input as HTMLInputElement).disabled).toBe(false);

			fireEvent.input(input, { target: { value: String(count) } });
			fireEvent.submit(input.closest('form')!);
			expect(document.querySelector('.felt__verdict.is-right')).not.toBeNull();
			expect(document.querySelector('.felt__verdict')!.textContent).toMatch(/exact/);
		});

		/** The next deal, the drill's own way: Easy's loose cards, or a played round. */
		function dealDrill(game: GameState, mode: 'easy' | 'hard'): GameState {
			const { cardsPerRound } = COUNTING_PACE[mode];
			return cardsPerRound === undefined ?
					dealCountingRound(preRound(game), GRIDS.get(0)!)
				:	dealCountingCards(preRound(game), cardsPerRound);
		}

		/** The beats the felt takes to land a deal; a round turns its hole card too. */
		function beats(game: GameState, mode: 'easy' | 'hard'): number {
			const cards =
				game.dealer.cards.length
				+ game.hands.reduce((sum, hand) => sum + hand.cards.length, 0);
			return COUNTING_PACE[mode].cardsPerRound === undefined ? cards + 1 : cards;
		}

		/** When the first deal's last card has landed and its time to count begins. */
		function firstRoundDealtMs(mode: 'easy' | 'hard'): number {
			const game = dealDrill(
				createGame(RULE_SET, createShoe(RULE_SET, TAGS, SEED)),
				mode
			);
			return beats(game, mode) * CARD_DEAL_DELAY_MS[COUNTING_PACE[mode].speed];
		}

		const roundsPlayed = () =>
			document.querySelectorAll('.train-drill__rounds .is-on').length;

		it('deals on early on Space, once a round is on the felt', () => {
			vi.useFakeTimers();
			renderView();
			startDrill('Counting accuracy', 'Easy');
			// Mid-deal there is nothing to cut short.
			key(' ');
			vi.advanceTimersByTime(firstRoundDealtMs('easy'));
			expect(roundsPlayed()).toBe(0);
			key(' ');
			expect(roundsPlayed()).toBe(1);
			expect(document.querySelectorAll('.felt__cards .felt__card')).toHaveLength(0);
		});

		it('deals on early on a tap of the felt', () => {
			vi.useFakeTimers();
			renderView();
			startDrill('Counting accuracy', 'Easy');
			vi.advanceTimersByTime(firstRoundDealtMs('easy'));
			fireEvent.click(document.querySelector('.felt')!);
			expect(roundsPlayed()).toBe(1);
		});

		it("leaves each round its mode's time to count after the last card lands", () => {
			vi.useFakeTimers();
			renderView();
			startDrill('Counting accuracy', 'Hard');
			const { atMs } = firstCheckpoint('hard');
			vi.advanceTimersByTime(atMs - 1);
			expect(screen.queryByText('Checkpoint 1 of 5')).toBeNull();
			vi.advanceTimersByTime(1);
			expect(screen.getByText('Checkpoint 1 of 5')).toBeDefined();
		});

		it.each([
			['Easy', 400],
			['Hard', 200],
		] as const)("deals at %s's own speed, whatever the Play view's", (mode, beatMs) => {
			vi.useFakeTimers();
			renderView({ speed: 'instant' });
			startDrill('Counting accuracy', mode);
			expect(document.querySelectorAll('.felt__cards .felt__card')).toHaveLength(0);
			vi.advanceTimersByTime(beatMs - 1);
			expect(document.querySelectorAll('.felt__cards .felt__card')).toHaveLength(0);
			vi.advanceTimersByTime(1);
			expect(document.querySelectorAll('.felt__cards .felt__card')).toHaveLength(1);
		});

		it('takes an answer one out as wrong at Easy, and gives the count', () => {
			vi.useFakeTimers();
			renderView();
			startDrill('Counting accuracy', 'Easy');
			const { count, atMs } = firstCheckpoint('easy');
			vi.advanceTimersByTime(atMs);
			const input = screen.getByRole('textbox', { name: 'Running count' });
			fireEvent.input(input, { target: { value: String(count + 1) } });
			fireEvent.submit(input.closest('form')!);
			expect(document.querySelector('.felt__verdict.is-right')).toBeNull();
			expect(document.querySelector('.felt__verdict')!.textContent).toMatch(
				new RegExp(`The RC was .?${Math.abs(count)}`)
			);
		});

		it('deals Easy four loose cards at a time, every one counted', () => {
			let game = createGame(RULE_SET, createShoe(RULE_SET, TAGS, SEED));
			let shown = 0;
			for (let round = 0; round < 20; round += 1) {
				if (game.shoe.needsShuffle()) shown = 0;
				game = dealCountingCards(preRound(game), 4);
				expect(game.dealer.cards).toHaveLength(0);
				expect(game.hands).toHaveLength(1);
				expect(game.hands[0].cards).toHaveLength(4);
				shown += game.hands[0].cards.reduce((sum, rank) => sum + TAGS[rank], 0);
				expect(game.shoe.runningCount()).toBe(shown);
			}
		});
	});
});
