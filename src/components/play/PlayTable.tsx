/**
 * The felt: the shoe's state, the cards on the table, and every phase's
 * controls on one shelf, of which only the live phase's are shown.
 * Presentational -- every decision belongs to `PlayView`, which owns the game
 * and the coach.
 */

import { Progress } from '@ark-ui/solid/progress';
import { createMemo, For, Show, type Component } from 'solid-js';

import { CARDS_PER_DECK } from '#utils/ev/composition';
import type { PlayerAction } from '#utils/ev/rules';
import {
	formatActionLabel,
	formatCellEvPercent,
	formatCount,
	formatCurrency,
} from '#utils/ui/format';
import { createGlobalKeydown, isKeyConsumingTarget } from '#utils/app/keyboard';
import {
	legalActions,
	offeredActions,
	type GameState,
	type HandResult,
} from '#utils/play/game';
import type { Grading } from '#utils/play/coach';
import { CARD_DEAL_DELAY_MS } from '#utils/play/reveal';
import type { PlayConfig } from '#utils/settings/storage';

import { ActionBar, createRevealQueue, Felt, FeltVerdict } from '#c/common/Felt';

import '#styles/play/PlayTable';

/**
 * The chips on the rail, smallest first. Standard casino denominations rather
 * than anything derived from the bankroll: a rail is a physical thing, and the
 * unit decides which of them a bet may stop at, not which exist.
 */
export const CHIP_DENOMINATIONS: readonly number[] = [1, 5, 25, 100, 500, 1000];

const RESULT_LABELS: Record<HandResult, string> = {
	blackjack: 'Blackjack',
	win: 'Win',
	push: 'Push',
	lose: 'Lose',
	bust: 'Bust',
	surrendered: 'Surrendered',
};

/** Money on the felt, where nothing is a gain or a loss and so nothing is signed. */
function money(value: number): string {
	return formatCurrency(value).replace(/^\+/, '');
}

interface PlayTableProps {
	state: GameState;
	/** Money behind the player: the bankroll plus everything settled since. */
	stack: number;
	/** What the next round is being bet, or what the live round was bet.  */
	bet: number;
	/** Floor for the chip rail, off the Bankroll tab's own unit. */
	unit: number;
	config: PlayConfig;
	/** The most recent graded decision, or null when there is nothing to say. */
	grading: Grading | null;
	onAction: (action: PlayerAction) => void;
	onInsurance: (take: boolean) => void;
	onChip: (amount: number) => void;
	onClear: () => void;
	onRepeat: () => void;
	onDeal: () => void;
	/** Shuffles up: abandons the shoe on the felt and deals the next one. */
	onNewShoe: () => void;
	/** Clears the settled round off the felt and returns to bet sizing. */
	onNextHand: () => void;
}

const PlayTable: Component<PlayTableProps> = (props) => {
	const phase = () => props.state.phase;
	const legal = createMemo(() => legalActions(props.state));
	/**
	 * The bar itself, and with it the digits the actions answer to. It is the
	 * table's, not the hand's, so muscle memory still survives a hand that cannot
	 * split or double -- only a change to the rules in the sidebar moves a key.
	 */
	const offered = createMemo(() => offeredActions(props.state.ruleSet));
	const canDeal = () => props.bet >= props.unit && props.bet <= props.stack;

	/**
	 * What is actually drawn on the felt right now, which lags `props.state` while
	 * new cards queue up one at a time. Everything the round's end says waits on
	 * it, rather than announcing "win +$5" over a half-dealt hand.
	 */
	const queue = createRevealQueue(
		() => props.state,
		() => CARD_DEAL_DELAY_MS[props.config.animationSpeed]
	);
	const settled = () => phase() === 'settled' && queue.fullyDealt();

	// Rounded up: a shoe with a card left in it is still a shoe you are playing
	// out of, and "0 decks left" would read as one already shuffled.
	const decksLeft = createMemo(() => Math.ceil(props.state.shoe.decksRemaining()));
	const cardsLeft = createMemo(() => props.state.shoe.cardsRemaining());
	const totalCards = createMemo(() => props.state.ruleSet.decks * CARDS_PER_DECK);

	/**
	 * What the banner says, or null for silence. The coaching level decides what
	 * is *shown* and nothing else -- the grading behind it has already happened
	 * and has already reached the stats.
	 */
	const correction = createMemo(() => {
		const grading = props.grading;
		const level = props.config.coaching;
		if (grading === null || level === 'none') return null;
		if (level === 'basic' && !grading.basicError) return null;
		if (!grading.basicError && !grading.deviationError) return null;
		// At the basic level the count is not part of the lesson, so the play the
		// banner names is the one basic strategy would have made.
		const right = level === 'basic' ? grading.basicAction : grading.countAction;
		return { right, grading };
	});

	createGlobalKeydown((event) => {
		// Buttons are transparent here: the action bar is what the number keys
		// drive, and a button that has just been clicked must not swallow them.
		if (isKeyConsumingTarget(event.target, { allowButtons: true })) return;

		if (phase() === 'act') {
			const digit = Number(event.key);
			if (!Number.isInteger(digit) || digit < 1) return;
			const action = offered()[digit - 1];
			if (action !== undefined && legal().includes(action)) {
				event.preventDefault();
				props.onAction(action);
			}
			return;
		}
		if (phase() === 'insurance') {
			const digit = Number(event.key);
			if (!Number.isInteger(digit) || digit < 1 || digit > 2) return;
			event.preventDefault();
			props.onInsurance(digit === 1);
			return;
		}
		// Deliberately the gated `settled`: while the round's last cards are still
		// landing there is nothing on the felt for these keys to answer to yet.
		if (settled()) {
			if (event.key === ' ') {
				event.preventDefault();
				props.onNextHand();
				return;
			}
			if (event.key === 'r' || event.key === 'R') {
				event.preventDefault();
				if (canDeal()) props.onDeal();
				return;
			}
			return;
		}

		if (phase() !== 'bet') return;

		if (event.key === '0') {
			event.preventDefault();
			props.onClear();
			return;
		}
		if (event.key === 'r' || event.key === 'R') {
			event.preventDefault();
			props.onRepeat();
			return;
		}
		if (event.key === 'n' || event.key === 'N') {
			event.preventDefault();
			props.onNewShoe();
			return;
		}
		if (event.key === ' ') {
			event.preventDefault();
			if (canDeal()) props.onDeal();
			return;
		}
		const digit = Number(event.key);
		if (!Number.isInteger(digit) || digit < 1) return;
		const chip = CHIP_DENOMINATIONS[digit - 1];
		if (chip === undefined) return;
		event.preventDefault();
		props.onChip(chip);
	});

	return (
		<div class="play-table">
			<div class="play-table__hud">
				<span class="play-table__decks">{decksLeft()} decks left</span>
				<Progress.Root
					class="play-table__shoe"
					value={cardsLeft()}
					max={totalCards()}
					aria-label="Cards left in the shoe"
				>
					<Progress.Track class="play-table__shoe-track">
						<Progress.Range class="play-table__shoe-range" />
					</Progress.Track>
				</Progress.Root>
				<Show when={props.config.showCount}>
					<span class="play-table__count">
						RC {formatCount(props.state.shoe.runningCount())}
					</span>
					<span class="play-table__count">
						TC {formatCount(Number(props.state.shoe.trueCount().toFixed(1)))}
					</span>
				</Show>
				{/* The money reads as part of the same instrument strip as the shoe:
				    both are the standing state of the table, not of the hand. */}
				<span class="play-table__money">
					Stack <strong>{money(props.stack)}</strong>
				</span>
			</div>

			<Felt state={props.state} queue={queue} />

			<div class="play-table__info">
				<Show
					when={settled()}
					fallback={
						// Between the bet being placed and the round settling there is
						// nothing to report yet, but the amount riding on the hand is
						// still live information -- unlike the rail below, it doesn't
						// belong to the bet phase alone.
						<span class="play-table__bet-amount">
							Bet <strong>{money(props.bet)}</strong>
						</span>
					}
				>
					<div class="play-table__results">
						<For each={props.state.hands}>
							{(hand, handIndex) => (
								<Show when={hand.result}>
									{(result) => (
										<span class={`play-table__result is-${result()}`}>
											<Show when={props.state.hands.length > 1}>
												<span class="play-table__hand-index">
													#{handIndex() + 1}
												</span>{' '}
											</Show>
											{RESULT_LABELS[result()]}
										</span>
									)}
								</Show>
							)}
						</For>
					</div>
					<span
						class={`play-table__net ${props.state.net < 0 ? 'is-negative' : 'is-positive'}`}
					>
						{formatCurrency(props.state.net)}
					</span>
				</Show>
			</div>

			{/* One shelf for all of them: every phase's controls stay mounted, and
			    the hidden panels still size the grid, so the felt keeps its height
			    as the round turns from betting to acting to settled instead of
			    growing and shrinking under the page. */}
			<div class="play-table__controls">
				<div
					class={`play-table__panel ${settled() ? 'is-shown' : ''}`}
					aria-hidden={!settled()}
				>
					<div class="play-table__pause">
						<div class="play-table__slot">
							<span class="play-table__key">Space</span>
							<button
								type="button"
								class="play-table__control highlight"
								onClick={() => props.onNextHand()}
							>
								Next hand
							</button>
						</div>
						<div class="play-table__slot">
							<span class="play-table__key">R</span>
							<button
								type="button"
								class="play-table__control"
								disabled={!canDeal()}
								onClick={() => props.onDeal()}
							>
								Redeal same bet
							</button>
						</div>
					</div>
				</div>

				<div
					class={`play-table__panel ${phase() === 'bet' ? 'is-shown' : ''}`}
					aria-hidden={phase() !== 'bet'}
				>
					<div class="play-table__rail">
						<div class="play-table__slot">
							<span class="play-table__key">0</span>
							<button
								type="button"
								class="play-table__control"
								onClick={() => props.onClear()}
							>
								Clear
							</button>
						</div>
						<For each={CHIP_DENOMINATIONS}>
							{(chip, index) => (
								<div class="play-table__slot">
									<span class="play-table__key">{index() + 1}</span>
									<button
										type="button"
										class={`play-table__chip play-table__chip--${chip}`}
										disabled={props.bet + chip > props.stack}
										onClick={() => props.onChip(chip)}
									>
										{/* Wrapped so it can be lifted above the chip's inlay ring,
									    which is drawn as an ::after over the button's own content. */}
										<span class="play-table__chip-value">{chip}</span>
									</button>
								</div>
							)}
						</For>
					</div>
					<div class="play-table__rail-controls">
						{/* A shuffle-up is the shoe's business rather than the bet's, but
					    between rounds is the only moment it can be asked for, so it
					    sits with the other things the player does while betting. */}
						<div class="play-table__slot">
							<span class="play-table__key">N</span>
							<button
								type="button"
								class="play-table__control"
								onClick={() => props.onNewShoe()}
							>
								New shoe
							</button>
						</div>
						<div class="play-table__slot">
							<span class="play-table__key">R</span>
							<button
								type="button"
								class="play-table__control"
								onClick={() => props.onRepeat()}
							>
								Repeat
							</button>
						</div>
						<div class="play-table__slot">
							<span class="play-table__key">Space</span>
							<button
								type="button"
								class="play-table__control highlight"
								disabled={!canDeal()}
								onClick={() => props.onDeal()}
							>
								Deal
							</button>
						</div>
					</div>
				</div>

				<div
					class={`play-table__panel ${phase() === 'insurance' ? 'is-shown' : ''}`}
					aria-hidden={phase() !== 'insurance'}
				>
					<div class="felt__actions">
						<button
							type="button"
							class="felt__action"
							onClick={() => props.onInsurance(true)}
						>
							<span class="felt__key">1</span>Insurance
						</button>
						<button
							type="button"
							class="felt__action"
							onClick={() => props.onInsurance(false)}
						>
							<span class="felt__key">2</span>No insurance
						</button>
					</div>
				</div>

				<div
					class={`play-table__panel ${phase() === 'act' ? 'is-shown' : ''}`}
					aria-hidden={phase() !== 'act'}
				>
					<ActionBar offered={offered()} legal={legal()} onAction={props.onAction} />
				</div>
			</div>

			<Show when={correction()}>
				{(shown) => (
					<FeltVerdict>
						{formatActionLabel(shown().right)} was right here
						<Show when={props.config.coaching === 'deviations'}>
							{' '}
							(TC {formatCount(shown().grading.trueCount)})
						</Show>{' '}
						— {formatCellEvPercent(shown().grading.evLostPercent)}% EV
					</FeltVerdict>
				)}
			</Show>
		</div>
	);
};

export default PlayTable;
