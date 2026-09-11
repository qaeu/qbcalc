/**
 * The felt both card views deal onto: the layout print, the seats and the card
 * stock, the reveal queue that lands one card at a time, the action bar and the
 * verdict banner. The Play and Train views each own a game and hand it here to be
 * drawn, so the two can never drift apart in how a hand looks or lands. See
 * docs/play-model.md §The round.
 */

import {
	createEffect,
	createMemo,
	createSignal,
	For,
	Index,
	onCleanup,
	Show,
	type Component,
	type JSX,
} from 'solid-js';

import { ACTION_CLASS } from '#utils/actionStyle';
import type { Rank } from '#utils/ev/cards';
import type { BlackjackPayout, PlayerAction, RuleSet } from '#utils/ev/rules';
import { formatActionLabel } from '#utils/format';
import type { GameState } from '#utils/play/game';
import {
	clampRevealed,
	countsReached,
	dealerTotalLabel,
	NOTHING_REVEALED,
	revealOneMore,
	targetCounts,
	totalLabel,
	type RevealCounts,
} from '#utils/play/reveal';

import '#styles/Felt';

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

function suitFor(row: number, index: number, rank: Rank): (typeof SUITS)[number] {
	return SUITS[(row * 7 + index * 3 + rank.charCodeAt(0)) % SUITS.length];
}

/** 'T' is a ten on the felt, whatever the engine calls it. */
function rankLabel(rank: Rank): string {
	return rank === 'T' ? '10' : rank;
}

/** What the felt has shown of the round so far, and whether it has caught up. */
export interface RevealQueue {
	revealed: () => RevealCounts;
	/**
	 * Whether the felt has caught up with the state machine. A round settles in
	 * one transition, so its outcome is known well before the cards that decided
	 * it have landed -- everything the round's end says is held back until they
	 * have.
	 */
	fullyDealt: () => boolean;
	/**
	 * Whether the felt still shows the hole card face down -- the queue's own
	 * answer, not the state machine's. The machine turns it over in the same
	 * transition that plays the dealer out, which on a bust is the transition the
	 * player's last card is still queued behind, so the felt turns it on the beat
	 * the queue reaches rather than the one the state changed on.
	 */
	holeHidden: () => boolean;
}

/**
 * Lands the cards `state` holds one at a time, `delayMs` apart, in the table's
 * order (`revealOneMore`). A delay of zero skips the queue outright. A change of
 * `dealKey` deals the felt again from nothing -- how a drill's next question,
 * the same shape as the last, still lands card by card.
 */
export function createRevealQueue(
	state: () => GameState,
	delayMs: () => number,
	dealKey?: () => unknown
): RevealQueue {
	/**
	 * Lags `state` while new cards queue up. Clamped down rather than reset on
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
	let lastKey: unknown;

	const clearDealTimer = () => {
		if (dealTimer !== undefined) {
			clearTimeout(dealTimer);
			dealTimer = undefined;
		}
	};
	onCleanup(clearDealTimer);

	createEffect(() => {
		const current = state();
		const target = targetCounts(current);
		const delay = delayMs();
		const key = dealKey?.();
		const freshlyDealt =
			(lastPhase === 'settled' && current.phase !== 'settled') || key !== lastKey;
		lastPhase = current.phase;
		lastKey = key;

		clearDealTimer();

		if (delay === 0) {
			setRevealed(target);
			return;
		}

		setRevealed((shown) => clampRevealed(shown, target, freshlyDealt));

		const step = () => {
			setRevealed((shown) => revealOneMore(shown, target));
			if (!countsReached(revealed(), target)) {
				dealTimer = setTimeout(step, delay);
			}
		};
		if (!countsReached(revealed(), target)) {
			dealTimer = setTimeout(step, delay);
		}
	});

	const fullyDealt = createMemo(() => countsReached(revealed(), targetCounts(state())));
	const holeHidden = createMemo(() => !revealed().hole);
	return { revealed, fullyDealt, holeHidden };
}

interface PlayingCardProps {
	rank: Rank;
	/** The seat the card lies at, which with `index` picks its suit. */
	row: number;
	index: number;
	/** The small size a review list lays a hand out in, off the felt. */
	mini?: boolean;
}

export const PlayingCard: Component<PlayingCardProps> = (props) => {
	const suit = createMemo(() => suitFor(props.row, props.index, props.rank));
	const red = createMemo(() => suit() === '♥' || suit() === '♦');
	return (
		<span
			class={`felt__card ${red() ? 'is-red' : ''} ${props.mini ? 'felt__card--mini' : ''}`}
		>
			<span class="felt__card-rank">
				{rankLabel(props.rank)}
				<span class="felt__card-pip" aria-hidden="true">
					{suit()}
				</span>
			</span>
			<span class="felt__card-suit" aria-hidden="true">
				{suit()}
			</span>
		</span>
	);
};

/** The hole card: a back, not a rank. */
export const CardBack: Component<{ mini?: boolean }> = (props) => (
	<span
		class={`felt__card felt__card--back ${props.mini ? 'felt__card--mini' : ''}`}
		aria-label="Hole card"
	/>
);

interface FeltProps {
	state: GameState;
	queue: RevealQueue;
	/** What the player's seat is called. 'You' where omitted. */
	playerLabel?: string;
	/**
	 * While a notice holds the felt, the seats keep their room but not their print,
	 * so the table does not change height under the notice.
	 */
	quiet?: boolean;
	/**
	 * A tap anywhere on the table. Only ever a shortcut for a key the view also
	 * binds, never the one way to do something.
	 */
	onTap?: () => void;
	/** Laid over the felt: a notice, a counter. */
	children?: JSX.Element;
}

/**
 * The table surface proper: the layout print, the dealer's seat, and one seat
 * per player hand, each drawn only as far as the reveal queue has reached.
 */
export const Felt: Component<FeltProps> = (props) => {
	const revealed = () => props.queue.revealed();
	const holeHidden = () => props.queue.holeHidden();
	const dealerLabel = createMemo(() =>
		dealerTotalLabel(props.state, revealed().dealer, holeHidden())
	);
	const playerLabel = () => props.playerLabel ?? 'You';

	return (
		<div class={`felt ${props.quiet ? 'is-quiet' : ''}`} onClick={() => props.onTap?.()}>
			{/* Decorative in the sense that it is never the thing being operated,
			    but not decoration: it is the live rule set, stated where the hand
			    is being played rather than in the sidebar. */}
			<div class="felt__layout-print">
				<span class="felt__pays">
					{PAYOUT_PRINT[props.state.ruleSet.blackjackPayout]}
				</span>
				<span class="felt__house-rule">
					{dealerPrint(props.state.ruleSet)}
					<Show when={props.state.ruleSet.insurance}>{' · Insurance pays 2 to 1'}</Show>
				</span>
			</div>

			<div class="felt__seat">
				<span class="felt__seat-label">Dealer</span>
				<div class="felt__cards">
					<For each={props.state.dealer.cards.slice(0, revealed().dealer)}>
						{(rank, index) => (
							<Show
								when={!(holeHidden() && index() === 1)}
								fallback={
									// ENHC tables never deal a hole card at all until the
									// player's turn is over, so there is nothing to draw face
									// down -- unlike a peek table, which has already dealt it.
									<Show when={props.state.ruleSet.dealerPeek}>
										<CardBack />
									</Show>
								}
							>
								<PlayingCard rank={rank} row={0} index={index()} />
							</Show>
						)}
					</For>
				</div>
				<span class="felt__total">{dealerLabel() ?? ''}</span>
			</div>

			<Show
				when={props.state.hands.length > 0}
				fallback={
					// Before the first card is dealt there is no hand yet to loop over,
					// but the seat itself -- and the space it holds -- is there the
					// whole time, same as the dealer's.
					<div class="felt__seat">
						<span class="felt__seat-label">{props.playerLabel ?? 'Player'}</span>
						<div class="felt__cards" />
						<span class="felt__total" />
					</div>
				}
			>
				{/* Keyed by seat rather than by hand: the state machine hands back a
				    fresh `PlayHand` on every transition, and a keyed loop would tear
				    the whole seat down and rebuild it -- re-running the deal animation
				    on every card already lying on the felt. A seat is positional
				    anyway, and a split splices into place. */}
				<Index each={props.state.hands}>
					{(hand, handIndex) => (
						<div
							class={`felt__seat ${
								// Only worth marking when there is more than one hand to tell
								// apart -- on a single hand the ring says nothing and reads as
								// a stray box around the only seat in play.
								(
									props.state.hands.length > 1
									&& handIndex === props.state.activeHandIndex
								) ?
									'is-active'
								:	''
							}`}
						>
							<span class="felt__seat-label">
								{playerLabel()}
								<Show when={props.state.hands.length > 1}>
									{' '}
									<span class="felt__hand-index">#{handIndex + 1}</span>
								</Show>
							</span>
							<div class="felt__cards">
								<For each={hand().cards.slice(0, revealed().hands[handIndex] ?? 0)}>
									{(rank, index) => (
										<PlayingCard rank={rank} row={handIndex + 1} index={index()} />
									)}
								</For>
							</div>
							<span class="felt__total">
								{totalLabel(hand(), revealed().hands[handIndex] ?? 0)}
							</span>
						</div>
					)}
				</Index>
			</Show>

			{props.children}
		</div>
	);
};

interface ActionBarProps {
	/** The table's bar: its digits never move, whatever a hand can legally do. */
	offered: readonly PlayerAction[];
	/** What the hand in front of the player may actually do. */
	legal: readonly PlayerAction[];
	onAction: (action: PlayerAction) => void;
	/** Every button stops answering, as it does once a drill question is answered. */
	locked?: boolean;
	/** Once answered: the right play, lit in its own colour. */
	answer?: PlayerAction | null;
	/** Once answered: the play taken, struck through where it was not the answer. */
	picked?: PlayerAction | null;
}

/**
 * The action bar. Only the actions this hand can take are drawn -- no split on a
 * hard 16, no double once it has hit -- but the key each answers to is its slot
 * on the table's bar rather than its place in the row, so a digit means the same
 * action every hand however few buttons are showing.
 */
export const ActionBar: Component<ActionBarProps> = (props) => (
	<div class="felt__actions">
		<For each={props.offered}>
			{(action, index) => (
				<Show when={props.legal.includes(action)}>
					<button
						type="button"
						class={`felt__action ${ACTION_CLASS[action]} ${
							props.answer === action ? 'is-answer' : ''
						} ${props.picked === action && props.answer !== action ? 'is-picked' : ''}`}
						disabled={props.locked}
						onClick={() => props.onAction(action)}
					>
						<span class="felt__key">{index() + 1}</span>
						{formatActionLabel(action)}
					</button>
				</Show>
			)}
		</For>
	</div>
);

interface FeltVerdictProps {
	/** Mint and a tick where the play was right; gold and a cross where it was not. */
	right?: boolean;
	children: JSX.Element;
	/** Set at the banner's far end: the button that moves on from it. */
	aside?: JSX.Element;
}

/**
 * The coach's verdict on the play just made. A wrong play is marked in gold rather
 * than red: it is information, and the felt spends red on losing money.
 */
export const FeltVerdict: Component<FeltVerdictProps> = (props) => (
	<div class={`felt__verdict ${props.right ? 'is-right' : ''}`} role="status">
		<span class="felt__verdict-mark" aria-hidden="true">
			{props.right ? '✓' : '✗'}
		</span>
		<span class="felt__verdict-text">{props.children}</span>
		{props.aside}
	</div>
);
