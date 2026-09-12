/**
 * The Play view: a dealt shoe under the sidebar's own rules and counting
 * system, the coach grading each decision against the engine's prices, and the
 * lifetime record both feed. Everything stateful about a session lives here --
 * `PlayTable` and `PlayStats` are given what to draw. See docs/play-model.md.
 */

import { Tabs } from '@ark-ui/solid/tabs';
import {
	createEffect,
	createMemo,
	createSignal,
	on,
	untrack,
	type Component,
} from 'solid-js';

import { RANKS } from '#utils/ev/cards';
import type { TagValues } from '#utils/ev/composition';
import { ruleSetKey, type PlayerAction, type RuleSet } from '#utils/ev/rules';
import type { PlayGrids } from '#utils/evWorkerProtocol';
import { gradeDecision, type Grading } from '#utils/play/coach';
import {
	applyAction,
	createGame,
	preRound,
	resolveInsurance,
	settleRound,
	startRound,
	type GameState,
} from '#utils/play/game';
import { sessionFromStored, toStoredSession } from '#utils/play/session';
import { createShoe } from '#utils/play/shoe';
import {
	EMPTY_PLAY_STATS,
	recordDecision,
	recordRound,
	type PlayStats as PlayStatsRecord,
} from '#utils/play/stats';
import {
	loadPlaySession,
	loadPlayStats,
	resetPlayStats,
	savePlaySession,
	savePlayStats,
	type PlayConfig,
} from '#utils/settings/storage';

import PlayStats from '#c/play/PlayStats';
import PlayTable from '#c/play/PlayTable';

import '#styles/play/PlayView';

interface PlayViewProps {
	ruleSet: RuleSet;
	tags: TagValues;
	config: PlayConfig;
	/** The bankroll the stack starts from, off the sidebar's Bankroll tab. */
	bankroll: number;
	/** What one betting unit is worth, off the sidebar's Bankroll tab. Doubles as the chip rail's floor. */
	unit: number;
	/** The grids the coach grades against, or null until the first pair lands. */
	grids: PlayGrids | null;
	/**
	 * The count the view now needs grids for, whole. Called on every transition;
	 * the app answers from its own cache where it can.
	 */
	onCountChange: (trueCount: number) => void;
	/** Fixed by tests; a session otherwise takes a shoe nobody has seen. */
	seed?: number;
}

const PlayView: Component<PlayViewProps> = (props) => {
	/**
	 * What a shoe is: change any of it and the one on the felt is describing a
	 * game the sidebar has stopped asking about, so it is dealt again. The
	 * penetration joins the rule-set key, which the grids have no use for but a
	 * dealt shoe does -- it is where the cut card goes.
	 */
	const shoeKey = createMemo(
		() =>
			`${ruleSetKey(props.ruleSet)}|${props.ruleSet.penetrationPercent}|${RANKS.map(
				(rank) => props.tags[rank]
			).join(',')}`
	);

	/**
	 * The session the last load left behind, where there is one under this shoe's
	 * own key. A stored session under any other key is dropped rather than
	 * restored, for the same reason a live shoe is redealt when the key changes.
	 */
	const restored = untrack(() => {
		const stored = loadPlaySession();
		if (stored === null || stored.shoeKey !== shoeKey()) return null;
		return sessionFromStored(stored, props.ruleSet, props.tags);
	});

	// Bumped per shuffle-from-scratch so consecutive shoes differ while a seeded
	// session still replays exactly.
	let shoeIndex = restored?.shoeIndex ?? 0;
	// Read once and deliberately: a session's seed is what it started with, and a
	// later change to any of these is not something to re-derive it from.
	const baseSeed = restored?.seed ?? untrack(() => props.seed) ?? Date.now();
	const openingBet = untrack(() => props.unit);

	const freshGame = (): GameState =>
		createGame(
			props.ruleSet,
			createShoe(props.ruleSet, props.tags, baseSeed + shoeIndex)
		);

	const [game, setGame] = createSignal<GameState>(restored?.game ?? freshGame());
	const [bet, setBet] = createSignal(restored?.bet ?? openingBet);
	const [lastBet, setLastBet] = createSignal(restored?.lastBet ?? openingBet);
	const [grading, setGrading] = createSignal<Grading | null>(null);
	const [stats, setStats] = createSignal<PlayStatsRecord>(
		loadPlayStats() ?? EMPTY_PLAY_STATS
	);

	// AV is lifetime money won or lost, persisted with the rest of the stats, so
	// the stack survives a reload instead of resetting to the bare bankroll.
	const stack = () => props.bankroll + stats().av;

	/**
	 * What the felt calls the bet: what is being built on the rail while betting,
	 * and what the live round was dealt for once it is. Never the money actually
	 * riding on a hand -- a double or a split puts more out than this, and the
	 * felt shows that against the hand itself. Settled shares the rail with
	 * betting -- the next round's wager is being built there too.
	 */
	const roundBet = () =>
		game().phase === 'bet' || game().phase === 'settled' ? bet() : lastBet();

	const updateStats = (update: (stats: PlayStatsRecord) => PlayStatsRecord) => {
		const next = update(stats());
		setStats(next);
		savePlayStats(next);
	};

	/**
	 * Shuffles up: the shoe on the felt is abandoned mid-deal and the next one is
	 * dealt from scratch. What the player asks for with `New shoe`, and what a
	 * change to the game itself forces.
	 */
	const newShoe = () => {
		shoeIndex += 1;
		setGrading(null);
		setGame(freshGame());
	};

	createEffect(on(shoeKey, newShoe, { defer: true }));

	// The coach grades against the count's own shoe, so the app is told which one
	// to price as soon as the felt moves to it.
	createEffect(() => props.onCountChange(Math.round(game().shoe.trueCount())));

	/**
	 * The felt as it stands, written on every transition, so a reload picks the
	 * shoe and the hand back up instead of shuffling a new one. Created after the
	 * redeal effect above, and so runs after it: a shoe the key change has just
	 * abandoned is never what gets stored under the new key. The last verdict is
	 * deliberately left out -- the banner belongs to the decision that was just
	 * made, not to the state of the table.
	 */
	createEffect(() => {
		savePlaySession(
			toStoredSession(
				{ game: game(), bet: bet(), lastBet: lastBet(), seed: baseSeed, shoeIndex },
				shoeKey()
			)
		);
	});

	/**
	 * Takes the round wherever the transition left it. The state machine hands
	 * back `dealer` for a hand nobody can act on -- a natural either way -- and
	 * settling is always the view's call to make.
	 */
	const advanceTo = (next: GameState) => {
		if (next.phase !== 'dealer') {
			setGame(next);
			return;
		}
		const settled = settleRound(next);
		setGame(settled);
		updateStats((current) => recordRound(current, settled.net, settled.hands.length));
	};

	const handleAction = (action: PlayerAction) => {
		const state = game();
		const grids = props.grids;
		// Grading runs whatever the coaching setting says -- the setting decides
		// what is shown, so the record compares across sessions either way.
		const graded =
			grids === null ? null : gradeDecision(state, action, grids, state.shoe.trueCount());
		setGrading(graded);
		if (graded !== null) {
			const wager = state.hands[state.activeHandIndex].bet;
			updateStats((current) => recordDecision(current, graded, wager));
		}
		advanceTo(applyAction(state, action));
	};

	const deal = () => {
		const amount = Math.min(bet(), stack());
		if (amount < props.unit) return;
		setBet(amount);
		setLastBet(amount);
		setGrading(null);
		advanceTo(startRound(game(), amount));
	};

	return (
		<section class="play-view">
			<Tabs.Root defaultValue="table" class="play-view__tabs">
				<Tabs.List class="play-view__tab-list">
					<Tabs.Trigger value="table" class="play-view__tab">
						Table
					</Tabs.Trigger>
					<Tabs.Trigger value="stats" class="play-view__tab">
						Stats
					</Tabs.Trigger>
				</Tabs.List>
				<Tabs.Content value="table" class="play-view__panel">
					<PlayTable
						state={game()}
						stack={stack()}
						bet={roundBet()}
						unit={props.unit}
						config={props.config}
						grading={grading()}
						onAction={handleAction}
						onInsurance={(take) => advanceTo(resolveInsurance(game(), take))}
						onChip={(amount) => setBet(Math.min(bet() + amount, stack()))}
						onClear={() => setBet(props.unit)}
						onRepeat={() => setBet(Math.min(lastBet(), stack()))}
						onDeal={deal}
						onNewShoe={newShoe}
						onNextHand={() => setGame(preRound(game()))}
					/>
				</Tabs.Content>
				<Tabs.Content value="stats" class="play-view__panel">
					<PlayStats
						stats={stats()}
						onReset={() => {
							resetPlayStats();
							setStats(EMPTY_PLAY_STATS);
						}}
					/>
				</Tabs.Content>
			</Tabs.Root>
		</section>
	);
};

export default PlayView;
