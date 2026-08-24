import { describe, it, expect, vi } from 'vitest';
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
	const config: PlayConfig = { ...DEFAULT_PLAY_CONFIG };
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

			const outcome = document.querySelector('.play-table__outcome');
			expect(outcome?.textContent).toContain('Lose');
			expect(outcome?.textContent).toContain('£25');
			// No longer sat inline on the hand itself.
			expect(document.querySelector('.play-table__seat .play-table__result')).toBeNull();
		});

		it('clears the felt and offers the chip rail once Next hand is chosen', () => {
			const settled = settleRound(applyAction(dealtState(HARD_16, {}, 20), 'S'));
			const [state, setState] = createSignal<GameState>(settled);
			const config: PlayConfig = { ...DEFAULT_PLAY_CONFIG };
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

		it('renders an illegal action disabled rather than dropping it', () => {
			const { onAction } = renderTable();

			// Hard 16 is no pair and the default table has no surrender, so both
			// buttons are on the bar and neither does anything.
			expect(
				screen.getByRole<HTMLButtonElement>('button', { name: /Split/ }).disabled
			).toBe(true);
			expect(
				screen.getByRole<HTMLButtonElement>('button', { name: /Surrender/ }).disabled
			).toBe(true);

			fireEvent.keyDown(document.body, { key: '4' });
			expect(onAction).not.toHaveBeenCalled();
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
});
