/**
 * The felt: the shoe's state, the cards on the table, and every phase's
 * controls on one shelf, of which only the live phase's are shown.
 * Presentational -- every decision belongs to `PlayView`, which owns the game
 * and the coach.
 */

import { Progress } from '@ark-ui/solid/progress';
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	Index,
	onCleanup,
	Show,
	type Component,
} from 'solid-js';

import { ACTION_CLASS } from '#utils/actionStyle';
import { addValue, type Rank } from '#utils/ev/cards';
import { CARDS_PER_DECK } from '#utils/ev/composition';
import type { BlackjackPayout, PlayerAction, RuleSet } from '#utils/ev/rules';
import {
	formatActionLabel,
	formatCellEvPercent,
	formatCount,
	formatCurrency,
} from '#utils/format';
import { createGlobalKeydown, isKeyConsumingTarget } from '#utils/keyboard';
import {
	legalActions,
	offeredActions,
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
 * Purely cosmetic: the engine is rank-only, so a card's suit carries no
 * information at all. Derived from where the card sits rather than drawn from
 * the shoe's own stream, so a re-render never re-suits a card already on the
 * felt.
 */
const SUITS = ['♠', '♥', '♦', '♣'] as const;

/**
 * The layout lettering, in the words a real table carries it in. Printed onto
 * the felt because that is where a player reads these rules -- they are the
 * terms of the hand in front of them, not a setting.
 */
const PAYOUT_PRINT: Record<BlackjackPayout, string> = {
	'3:2': 'Blackjack pays 3 to 2',
	'6:5': 'Blackjack pays 6 to 5',
	'1:1': 'Blackjack pays even money',
};

/** The dealer's standing instruction, as the felt states it. */
function dealerPrint(ruleSet: RuleSet): string {
	return ruleSet.dealerHitsSoft17 ?
			'Dealer must draw to 16 and hit soft 17'
		:	'Dealer must draw to 16 and stand on all 17s';
}

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

/** How much of the table is currently shown, for the reveal queue below. */
interface RevealCounts {
	dealer: number;
	hands: number[];
	/**
	 * Whether the hole card has been turned over on the felt. Its own step in
	 * the queue rather than something read off the state: turning it over is a
	 * move the dealer makes, and it has to land on a beat of its own.
	 */
	hole: boolean;
}

const NOTHING_REVEALED: RevealCounts = { dealer: 0, hands: [], hole: false };

function targetCounts(state: GameState): RevealCounts {
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

function countsReached(revealed: RevealCounts, target: RevealCounts): boolean {
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
function revealOneMore(revealed: RevealCounts, target: RevealCounts): RevealCounts {
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
function dealerTotalLabel(
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
			<span class="play-table__card-rank">
				{rankLabel(props.rank)}
				<span class="play-table__card-pip" aria-hidden="true">
					{suit()}
				</span>
			</span>
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
	 * What is actually drawn on the felt right now, which lags `props.state`
	 * while new cards queue up one at a time. Clamped down rather than reset on
	 * every state change, since a fresh round's empty hands are themselves a
	 * lower target and a split's two-card hands already carry one revealed card
	 * each.
	 */
	const [revealed, setRevealed] = createSignal<RevealCounts>(NOTHING_REVEALED);
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
			const baseline = freshlyDealt ? NOTHING_REVEALED : current;
			return {
				dealer: Math.min(baseline.dealer, target.dealer),
				hands: target.hands.map((count, index) =>
					Math.min(baseline.hands[index] ?? 0, count)
				),
				// A hole card cannot stay turned over into a round that has not
				// dealt one yet, so the next deal puts it back face down.
				hole: baseline.hole && target.hole,
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

	/**
	 * Whether the felt has caught up with the state machine. A round settles in
	 * one transition, so its outcome is known well before the cards that decided
	 * it have landed -- everything the round's end says is held back until they
	 * have, rather than announcing "win +$5" over a half-dealt hand.
	 */
	const fullyDealt = createMemo(() =>
		countsReached(revealed(), targetCounts(props.state))
	);
	const settled = () => phase() === 'settled' && fullyDealt();

	/**
	 * Whether the felt still shows the hole card face down -- the queue's own
	 * answer, not the state machine's. The machine turns it over in the same
	 * transition that plays the dealer out, which on a bust is the transition the
	 * player's last card is still queued behind, so the felt turns it on the beat
	 * the queue reaches rather than the one the state changed on.
	 */
	const holeHidden = createMemo(() => !revealed().hole);

	const dealerLabel = createMemo(() =>
		dealerTotalLabel(props.state, revealed().dealer, holeHidden())
	);

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

			<div class="play-table__felt">
				{/* Decorative in the sense that it is never the thing being
				    operated, but not decoration: it is the live rule set, stated
				    where the hand is being played rather than in the sidebar. */}
				<div class="play-table__layout-print">
					<span class="play-table__pays">
						{PAYOUT_PRINT[props.state.ruleSet.blackjackPayout]}
					</span>
					<span class="play-table__house-rule">
						{dealerPrint(props.state.ruleSet)}
						<Show when={props.state.ruleSet.insurance}>{' · Insurance pays 2 to 1'}</Show>
					</span>
				</div>

				<div class="play-table__seat">
					<span class="play-table__seat-label">Dealer</span>
					<div class="play-table__cards">
						<For each={props.state.dealer.cards.slice(0, revealed().dealer)}>
							{(rank, index) => (
								<Show
									when={!(holeHidden() && index() === 1)}
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
					{/* Keyed by seat rather than by hand: the state machine hands back a
					    fresh `PlayHand` on every transition, and a keyed loop would tear
					    the whole seat down and rebuild it -- re-running the deal
					    animation on every card already lying on the felt. A seat is
					    positional anyway, and a split splices into place. */}
					<Index each={props.state.hands}>
						{(hand, handIndex) => (
							<div
								class={`play-table__seat ${
									// Only worth marking when there is more than one hand to
									// tell apart -- on a single hand the ring says nothing and
									// reads as a stray box around the only seat in play.
									(
										props.state.hands.length > 1
										&& handIndex === props.state.activeHandIndex
									) ?
										'is-active'
									:	''
								}`}
							>
								<span class="play-table__seat-label">
									You
									<Show when={props.state.hands.length > 1}>
										{' '}
										<span class="play-table__hand-index">#{handIndex + 1}</span>
									</Show>
								</span>
								<div class="play-table__cards">
									<For each={hand().cards.slice(0, revealed().hands[handIndex] ?? 0)}>
										{(rank, index) => (
											<Card rank={rank} row={handIndex + 1} index={index()} />
										)}
									</For>
								</div>
								<span class="play-table__total">
									{totalLabel(hand(), revealed().hands[handIndex] ?? 0)}
								</span>
							</div>
						)}
					</Index>
				</Show>
			</div>

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
				</div>

				<div
					class={`play-table__panel ${phase() === 'act' ? 'is-shown' : ''}`}
					aria-hidden={phase() !== 'act'}
				>
					<div class="play-table__actions">
						<For each={offered()}>
							{(action, index) => (
								// Only the actions this hand can actually take are drawn -- no
								// split on a hard 16, no double once it has hit. The key each
								// one answers to is still its slot on the table's bar rather
								// than its position in the row, so a digit means the same
								// action every hand however few buttons are showing.
								<Show when={legal().includes(action)}>
									<button
										type="button"
										class={`play-table__action ${ACTION_CLASS[action]}`}
										onClick={() => props.onAction(action)}
									>
										<span class="play-table__key">{index() + 1}</span>
										{formatActionLabel(action)}
									</button>
								</Show>
							)}
						</For>
					</div>
				</div>
			</div>

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
