/**
 * The felt: the shoe's state, the cards on the table, and the one row of
 * buttons that is live in the current phase. Presentational -- every decision
 * belongs to `PlayView`, which owns the game and the coach.
 */

import { Progress } from '@ark-ui/solid/progress';
import { createMemo, For, Show, type Component } from 'solid-js';

import { ACTION_CLASS } from '#utils/actionStyle';
import type { Rank } from '#utils/ev/cards';
import { CARDS_PER_DECK } from '#utils/ev/composition';
import type { PlayerAction } from '#utils/ev/rules';
import {
	formatActionLabel,
	formatCellEvPercent,
	formatCount,
	formatCurrency,
} from '#utils/format';
import { createGlobalKeydown, isKeyConsumingTarget } from '#utils/keyboard';
import {
	legalActions,
	type GameState,
	type HandResult,
	type PlayHand,
} from '#utils/play/game';
import type { Grading } from '#utils/play/coach';
import type { PlayConfig } from '#utils/storage';

import '#styles/PlayTable';

/**
 * The chips on the rail, smallest first. Standard casino denominations rather
 * than anything derived from the bankroll: a rail is a physical thing, and the
 * table minimum decides which of them a bet may stop at, not which exist.
 */
export const CHIP_DENOMINATIONS: readonly number[] = [1, 5, 25, 100, 500, 1000];

/**
 * The key each action answers to, fixed so that muscle memory survives a hand
 * that cannot split or double. The phases are disjoint, so the same digits mean
 * chips while betting and yes/no on the insurance offer without ever colliding.
 */
const ACTION_KEYS: readonly PlayerAction[] = ['H', 'S', 'D', 'P', 'R'];

/**
 * Purely cosmetic: the engine is rank-only, so a card's suit carries no
 * information at all. Derived from where the card sits rather than drawn from
 * the shoe's own stream, so a re-render never re-suits a card already on the
 * felt.
 */
const SUITS = ['♠', '♥', '♦', '♣'] as const;

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

function suitFor(row: number, index: number, rank: Rank): (typeof SUITS)[number] {
	return SUITS[(row * 7 + index * 3 + rank.charCodeAt(0)) % SUITS.length];
}

/** 'T' is a ten on the felt, whatever the engine calls it. */
function rankLabel(rank: Rank): string {
	return rank === 'T' ? '10' : rank;
}

/** How a hand reads aloud: "hard 16", "soft 18", "blackjack". */
function totalLabel(hand: PlayHand): string {
	if (hand.blackjack) return 'blackjack';
	return `${hand.soft ? 'soft' : 'hard'} ${hand.total}`;
}

interface CardProps {
	rank: Rank;
	row: number;
	index: number;
}

const Card: Component<CardProps> = (props) => {
	const suit = createMemo(() => suitFor(props.row, props.index, props.rank));
	const red = createMemo(() => suit() === '♥' || suit() === '♦');
	return (
		<span class={`play-table__card ${red() ? 'is-red' : ''}`}>
			<span class="play-table__card-rank">{rankLabel(props.rank)}</span>
			<span class="play-table__card-suit" aria-hidden="true">
				{suit()}
			</span>
		</span>
	);
};

interface PlayTableProps {
	state: GameState;
	/** Money behind the player: the bankroll plus everything settled since. */
	stack: number;
	/** What the next round is being bet, or what the live round was bet.  */
	bet: number;
	config: PlayConfig;
	/** The most recent graded decision, or null when there is nothing to say. */
	grading: Grading | null;
	onAction: (action: PlayerAction) => void;
	onInsurance: (take: boolean) => void;
	onChip: (amount: number) => void;
	onClear: () => void;
	onRepeat: () => void;
	onDeal: () => void;
}

const PlayTable: Component<PlayTableProps> = (props) => {
	const phase = () => props.state.phase;
	const legal = createMemo(() => legalActions(props.state));
	const canDeal = () =>
		props.bet >= props.config.tableMinimum && props.bet <= props.stack;

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
		const digit = Number(event.key);
		if (!Number.isInteger(digit) || digit < 1) return;

		if (phase() === 'act') {
			const action = ACTION_KEYS[digit - 1];
			if (action !== undefined && legal().includes(action)) {
				event.preventDefault();
				props.onAction(action);
			}
			return;
		}
		if (phase() === 'insurance') {
			if (digit > 2) return;
			event.preventDefault();
			props.onInsurance(digit === 1);
			return;
		}
		// Betting and settled share the digit: a chip on the rail before the deal,
		// and the deal itself once the round is paid.
		if (phase() === 'settled') {
			if (digit !== 1) return;
			event.preventDefault();
			props.onDeal();
			return;
		}
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
			</div>

			<div class="play-table__money">
				<span>
					Stack <strong>{money(props.stack)}</strong>
				</span>
				<span>
					Bet <strong>{money(props.bet)}</strong>
				</span>
			</div>

			<div class="play-table__felt">
				<div class="play-table__seat">
					<span class="play-table__seat-label">Dealer</span>
					<div class="play-table__cards">
						<For each={props.state.dealer.cards}>
							{(rank, index) => (
								<Show
									when={!(props.state.dealer.holeHidden && index() === 1)}
									fallback={
										<span
											class="play-table__card play-table__card--back"
											aria-label="Hole card"
										/>
									}
								>
									<Card rank={rank} row={0} index={index()} />
								</Show>
							)}
						</For>
					</div>
					<Show when={props.state.dealer.cards.length > 0}>
						<span class="play-table__total">
							{props.state.dealer.holeHidden ?
								`showing ${props.state.dealer.total}`
							:	`${props.state.dealer.busted ? 'bust ' : ''}${props.state.dealer.total}`}
						</span>
					</Show>
				</div>

				<For each={props.state.hands}>
					{(hand, handIndex) => (
						<div
							class={`play-table__seat ${
								handIndex() === props.state.activeHandIndex ? 'is-active' : ''
							}`}
						>
							<span class="play-table__seat-label">
								You
								<Show when={props.state.hands.length > 1}>
									{' '}
									<span class="play-table__hand-index">#{handIndex() + 1}</span>
								</Show>
							</span>
							<div class="play-table__cards">
								<For each={hand.cards}>
									{(rank, index) => (
										<Card rank={rank} row={handIndex() + 1} index={index()} />
									)}
								</For>
							</div>
							<span class="play-table__total">{totalLabel(hand)}</span>
							<Show when={hand.result}>
								{(result) => (
									<span class={`play-table__result is-${result()}`}>
										{RESULT_LABELS[result()]}
									</span>
								)}
							</Show>
						</div>
					)}
				</For>
			</div>

			<Show when={phase() === 'bet'}>
				<div class="play-table__rail">
					<For each={CHIP_DENOMINATIONS}>
						{(chip, index) => (
							<button
								type="button"
								class={`play-table__chip play-table__chip--${chip}`}
								disabled={props.bet + chip > props.stack}
								onClick={() => props.onChip(chip)}
							>
								<span class="play-table__key">{index() + 1}</span>
								{chip}
							</button>
						)}
					</For>
				</div>
				<div class="play-table__rail-controls">
					<button
						type="button"
						class="play-table__control"
						onClick={() => props.onClear()}
					>
						Clear
					</button>
					<button
						type="button"
						class="play-table__control"
						onClick={() => props.onRepeat()}
					>
						Repeat
					</button>
					<button
						type="button"
						class="play-table__control highlight"
						disabled={!canDeal()}
						onClick={() => props.onDeal()}
					>
						Deal
					</button>
				</div>
				<Show when={props.bet < props.config.tableMinimum}>
					<p class="play-table__hint">
						Table minimum is {money(props.config.tableMinimum)}.
					</p>
				</Show>
			</Show>

			<Show when={phase() === 'insurance'}>
				<div class="play-table__actions">
					<button
						type="button"
						class="play-table__action"
						onClick={() => props.onInsurance(true)}
					>
						<span class="play-table__key">1</span>Insurance
					</button>
					<button
						type="button"
						class="play-table__action"
						onClick={() => props.onInsurance(false)}
					>
						<span class="play-table__key">2</span>No insurance
					</button>
				</div>
			</Show>

			<Show when={phase() === 'act'}>
				<div class="play-table__actions">
					<For each={ACTION_KEYS}>
						{(action, index) => (
							<button
								type="button"
								// Disabled in place rather than dropped: the key an action
								// answers to is the same one every hand, and a bar that
								// reflowed would undo that.
								disabled={!legal().includes(action)}
								class={`play-table__action ${ACTION_CLASS[action]}`}
								onClick={() => props.onAction(action)}
							>
								<span class="play-table__key">{index() + 1}</span>
								{formatActionLabel(action)}
							</button>
						)}
					</For>
				</div>
			</Show>

			<Show when={phase() === 'settled'}>
				<div class="play-table__actions">
					<button
						type="button"
						class="play-table__action highlight"
						onClick={() => props.onDeal()}
					>
						<span class="play-table__key">1</span>Deal
					</button>
					<span
						class={`play-table__net ${props.state.net < 0 ? 'is-negative' : 'is-positive'}`}
					>
						{formatCurrency(props.state.net)}
					</span>
				</div>
			</Show>

			<Show when={correction()}>
				{(shown) => (
					<p class="play-table__correction">
						<span class="play-table__correction-mark" aria-hidden="true">
							✗
						</span>
						{formatActionLabel(shown().right)} was right here
						<Show when={props.config.coaching === 'deviations'}>
							{' '}
							(TC {formatCount(shown().grading.trueCount)})
						</Show>{' '}
						— {formatCellEvPercent(shown().grading.evLostPercent)}% EV
					</p>
				)}
			</Show>
		</div>
	);
};

export default PlayTable;
