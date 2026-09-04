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
import { createShoe } from '#utils/play/shoe';
import {
	EMPTY_PLAY_STATS,
	recordDecision,
	recordRound,
	type PlayStats as PlayStatsRecord,
} from '#utils/play/stats';
import {
	loadPlayStats,
	resetPlayStats,
	savePlayStats,
	type PlayConfig,
} from '#utils/storage';

import PlayStats from '#c/PlayStats';
import PlayTable from '#c/PlayTable';

import '#styles/PlayView';

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
	// Bumped per shuffle-from-scratch so consecutive shoes differ while a seeded
	// session still replays exactly.
	let shoeIndex = 0;
	// Read once and deliberately: a session's seed is what it started with, and a
	// later change to any of these is not something to re-derive it from.
	const baseSeed = untrack(() => props.seed) ?? Date.now();
	const openingBet = untrack(() => props.unit);

	const freshGame = (): GameState =>
		createGame(
			props.ruleSet,
			createShoe(props.ruleSet, props.tags, baseSeed + shoeIndex)
		);

	const [game, setGame] = createSignal<GameState>(freshGame());
	const [bet, setBet] = createSignal(openingBet);
	const [lastBet, setLastBet] = createSignal(openingBet);
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

	createEffect(
		on(
			shoeKey,
			() => {
				shoeIndex += 1;
				setGrading(null);
				setGame(freshGame());
			},
			{ defer: true }
		)
	);

	// The coach grades against the count's own shoe, so the app is told which one
	// to price as soon as the felt moves to it.
	createEffect(() => props.onCountChange(Math.round(game().shoe.trueCount())));

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
