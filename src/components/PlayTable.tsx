/**
 * The felt: the shoe's state, the cards on the table, and the one row of
 * buttons that is live in the current phase. Presentational -- every decision
 * belongs to `PlayView`, which owns the game and the coach.
 */

import { Progress } from '@ark-ui/solid/progress';
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	Show,
	type Component,
} from 'solid-js';

import { ACTION_CLASS } from '#utils/actionStyle';
import { addValue, type Rank } from '#utils/ev/cards';
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
import type { AnimationSpeed, PlayConfig } from '#utils/storage';

import '#styles/PlayTable';

/**
 * The chips on the rail, smallest first. Standard casino denominations rather
 * than anything derived from the bankroll: a rail is a physical thing, and the
 * unit decides which of them a bet may stop at, not which exist.
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

/**
 * The pause before each new card lands, per animation speed. `instant` is a
 * flat zero rather than a fast version of the others, so it skips the reveal
 * queue below entirely instead of racing through it.
 */
const CARD_DEAL_DELAY_MS: Record<AnimationSpeed, number> = {
	'1x': 800,
	'2x': 400,
	'4x': 200,
	instant: 0,
};

/** How many of each seat's cards are currently shown, for the reveal queue below. */
interface RevealCounts {
	dealer: number;
	hands: number[];
}

function targetCounts(state: GameState): RevealCounts {
	return {
		dealer: state.dealer.cards.length,
		hands: state.hands.map((hand) => hand.cards.length),
	};
}

function countsReached(revealed: RevealCounts, target: RevealCounts): boolean {
	return (
		revealed.dealer >= target.dealer
		&& target.hands.every((count, index) => (revealed.hands[index] ?? 0) >= count)
	);
}

/**
 * One more card than `revealed`, toward `target` -- the dealer's seat first,
 * then each hand left to right. Dealing order within a single state jump
 * (a split, or the dealer's whole draw-out settling in one transition) is
 * therefore only approximate, but the point is a card at a time, not a replay
 * of the table's exact order.
 */
function revealOneMore(revealed: RevealCounts, target: RevealCounts): RevealCounts {
	if (revealed.dealer < target.dealer) {
		return { ...revealed, dealer: revealed.dealer + 1 };
	}
	const hands = [...revealed.hands];
	for (let index = 0; index < target.hands.length; index += 1) {
		const have = hands[index] ?? 0;
		if (have < target.hands[index]) {
			hands[index] = have + 1;
			return { dealer: revealed.dealer, hands };
		}
	}
	return revealed;
}

/**
 * The total of just the cards dealt so far -- `PlayHand.total` and
 * `DealerHand.total` are the hand's *final* total, computed the instant the
 * state machine deals the card, which would say "bust" or "21" before the
 * felt has shown the card that made it true. Mirrors `totalOf` in game.ts.
 */
function partialTotal(cards: readonly Rank[]): [number, boolean] {
	let total = 0;
	let soft = false;
	for (const card of cards) [total, soft] = addValue(total, soft, card);
	return [total, soft];
}

/**
 * How a hand reads aloud as its cards land: "hard 16", "soft 18", "blackjack".
 * Read off `visibleCount` cards rather than the hand's own total, so the
 * total only ever reflects what has actually been dealt onto the felt.
 */
function totalLabel(hand: PlayHand, visibleCount: number): string {
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
function dealerTotalLabel(state: GameState, visibleCount: number): string | null {
	const dealer = state.dealer;
	const cards = dealer.cards
		.slice(0, visibleCount)
		.filter((_, index) => !(dealer.holeHidden && index === 1));
	if (cards.length === 0) return null;
	const [total] = partialTotal(cards);
	if (dealer.holeHidden) return `showing ${total}`;
	const fullyRevealed = visibleCount >= dealer.cards.length;
	return `${fullyRevealed && total > 21 ? 'bust ' : ''}${total}`;
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
	/** Clears the settled round off the felt and returns to bet sizing. */
	onNextHand: () => void;
}

const PlayTable: Component<PlayTableProps> = (props) => {
	const phase = () => props.state.phase;
	const legal = createMemo(() => legalActions(props.state));
	const canDeal = () => props.bet >= props.unit && props.bet <= props.stack;

	/**
	 * What is actually drawn on the felt right now, which lags `props.state`
	 * while new cards queue up one at a time. Clamped down rather than reset on
	 * every state change, since a fresh round's empty hands are themselves a
	 * lower target and a split's two-card hands already carry one revealed card
	 * each.
	 */
	const [revealed, setRevealed] = createSignal<RevealCounts>({ dealer: 0, hands: [] });
	let dealTimer: ReturnType<typeof setTimeout> | undefined;
	// `Redeal same bet` deals straight from `settled` into the next round
	// without passing through `bet` in between, so a same-shaped hand (the
	// common case, no split) would otherwise read as already fully dealt and
	// skip the queue below entirely.
	let lastPhase: GameState['phase'] | undefined;

	const clearDealTimer = () => {
		if (dealTimer !== undefined) {
			clearTimeout(dealTimer);
			dealTimer = undefined;
		}
	};
	onCleanup(clearDealTimer);

	createEffect(() => {
		const target = targetCounts(props.state);
		const delay = CARD_DEAL_DELAY_MS[props.config.animationSpeed];
		const freshlyDealt = lastPhase === 'settled' && props.state.phase !== 'settled';
		lastPhase = props.state.phase;

		clearDealTimer();

		if (delay === 0) {
			setRevealed(target);
			return;
		}

		setRevealed((current) => {
			const baseline = freshlyDealt ? { dealer: 0, hands: [] as number[] } : current;
			return {
				dealer: Math.min(baseline.dealer, target.dealer),
				hands: target.hands.map((count, index) =>
					Math.min(baseline.hands[index] ?? 0, count)
				),
			};
		});

		const step = () => {
			setRevealed((current) => revealOneMore(current, target));
			if (!countsReached(revealed(), target)) {
				dealTimer = setTimeout(step, delay);
			}
		};
		if (!countsReached(revealed(), target)) {
			dealTimer = setTimeout(step, delay);
		}
	});

	const dealerLabel = createMemo(() => dealerTotalLabel(props.state, revealed().dealer));

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
			const action = ACTION_KEYS[digit - 1];
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
		if (phase() === 'settled') {
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
			</div>

			<div class="play-table__money">
				<span>
					Stack <strong>{money(props.stack)}</strong>
				</span>
			</div>

			<div class="play-table__felt">
				<div class="play-table__seat">
					<span class="play-table__seat-label">Dealer</span>
					<div class="play-table__cards">
						<For each={props.state.dealer.cards.slice(0, revealed().dealer)}>
							{(rank, index) => (
								<Show
									when={!(props.state.dealer.holeHidden && index() === 1)}
									fallback={
										// ENHC tables never deal a hole card at all until the
										// player's turn is over, so there is nothing to draw face
										// down -- unlike a peek table, which has already dealt it.
										<Show when={props.state.ruleSet.dealerPeek}>
											<span
												class="play-table__card play-table__card--back"
												aria-label="Hole card"
											/>
										</Show>
									}
								>
									<Card rank={rank} row={0} index={index()} />
								</Show>
							)}
						</For>
					</div>
					<span class="play-table__total">{dealerLabel() ?? ''}</span>
				</div>

				<Show
					when={props.state.hands.length > 0}
					fallback={
						// Before the first card is dealt there is no hand yet to loop
						// over, but the seat itself -- and the space it holds -- is
						// there the whole time, same as the dealer's.
						<div class="play-table__seat">
							<span class="play-table__seat-label">Player</span>
							<div class="play-table__cards" />
							<span class="play-table__total" />
						</div>
					}
				>
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
									<For each={hand.cards.slice(0, revealed().hands[handIndex()] ?? 0)}>
										{(rank, index) => (
											<Card rank={rank} row={handIndex() + 1} index={index()} />
										)}
									</For>
								</div>
								<span class="play-table__total">
									{totalLabel(hand, revealed().hands[handIndex()] ?? 0)}
								</span>
							</div>
						)}
					</For>
				</Show>
			</div>

			<div class="play-table__info">
				<Show
					when={phase() === 'settled'}
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

			<Show when={phase() === 'settled'}>
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
			</Show>

			<Show when={phase() === 'bet'}>
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
									{chip}
								</button>
							</div>
						)}
					</For>
				</div>
				<div class="play-table__rail-controls">
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
				<Show when={props.bet < props.unit}>
					<p class="play-table__hint">Table minimum is {money(props.unit)}.</p>
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
