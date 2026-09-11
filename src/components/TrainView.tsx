/**
 * The Train view: short graded drills on the Play felt -- basic strategy, the
 * running count, and the count's deviations -- scored onto a top five per board.
 * Everything stateful lives here: which screen is up, the drill being played,
 * and the boards. `TrainPicker`, `TrainDecision`, `TrainCounting` and
 * `TrainResults` are each handed what to show. See docs/train-model.md.
 */

import {
	createEffect,
	createSignal,
	Match,
	on,
	onCleanup,
	onMount,
	Show,
	Switch,
	untrack,
	type Component,
} from 'solid-js';

import { labelForSystem, type CountingSystemId } from '#utils/countingSystems';
import type { TagValues } from '#utils/ev/composition';
import type { RuleSet } from '#utils/ev/rules';
import type { PlayGrids, TrainGrids } from '#utils/evWorkerProtocol';
import { createGlobalKeydown, isEscapeConsumingTarget } from '#utils/keyboard';
import {
	DEFAULT_TRAIN_CONFIG,
	loadTrainConfig,
	loadTrainScores,
	saveTrainConfig,
	saveTrainScores,
	type AnimationSpeed,
	type TrainConfig,
} from '#utils/storage';
import {
	basicQuestions,
	deviationQuestions,
	planDrill,
	type DecisionQuestion,
	type DrillId,
	type DrillMode,
} from '#utils/train/drills';
import { DRILL_NAMES, scoreEntry, type DrillRun } from '#utils/train/run';
import {
	bestOn,
	boardKey,
	describeRules,
	recordScore,
	type RecordedScore,
	type ScoreBoards,
	type ScoreEntry,
} from '#utils/train/scores';

import TrainCounting from '#c/TrainCounting';
import TrainDecision from '#c/TrainDecision';
import TrainPicker from '#c/TrainPicker';
import TrainResults from '#c/TrainResults';

import '#styles/TrainView';

interface TrainViewProps {
	ruleSet: RuleSet;
	tags: TagValues;
	system: CountingSystemId;
	/** The Play view's deal speed, which every drill deals at too. */
	animationSpeed: AnimationSpeed;
	/** Every count priced for the drills so far under the live settings, or null. */
	grids: TrainGrids | null;
	/** Asks the app to price the grids at `counts`. */
	onRequestGrids: (counts: readonly number[]) => void;
	/** Tells the app the drill that asked no longer wants its grids. */
	onCancelGrids: () => void;
	/**
	 * Hands the app the check a tab switch goes through, or null on unmount. The
	 * check is given the tab's name and says whether to switch now -- see `mayLeave`.
	 */
	onLeaveGuard?: (guard: ((to: string) => boolean) | null) => void;
	/** The worker's last error, shown while a drill waits on its grids. */
	error: string | null;
	/** Fixed by tests; a drill otherwise deals from a seed nobody has seen. */
	seed?: number;
}

type Screen =
	| { kind: 'picker' }
	| { kind: 'loading'; drill: DrillId; mode: DrillMode; seed: number; counts: number[] }
	| {
			kind: 'decision';
			drill: 'basic' | 'deviation';
			mode: DrillMode;
			seed: number;
			questions: DecisionQuestion[];
			grids: TrainGrids;
	  }
	| { kind: 'counting'; mode: DrillMode; seed: number; grids: PlayGrids }
	| {
			kind: 'results';
			run: DrillRun;
			entry: ScoreEntry;
			recorded: RecordedScore;
			previousBest?: ScoreEntry;
	  };

/** A leave asked for once and waiting on its second ask: where to, and at what cost. */
interface Leaving {
	/** 'quit', or the name of the tab asked for. */
	to: string;
	answers: number;
}

/** How long an armed leave waits for its second ask before standing down. */
const LEAVE_ARM_MS = 4000;

/** A fresh 32-bit seed. */
function newSeed(): number {
	return Math.floor(Math.random() * 2 ** 32);
}

/** What the way out reads, armed or not. */
function quitLabel(leaving: Leaving | null): string {
	if (leaving === null) return 'Quit drill';
	const lost = `${leaving.answers} ${leaving.answers === 1 ? 'answer' : 'answers'} lost`;
	return leaving.to === 'quit' ?
			`Quit anyway · ${lost}`
		:	`Click ${leaving.to} again to leave · ${lost}`;
}

const TrainView: Component<TrainViewProps> = (props) => {
	const [config, setConfig] = createSignal<TrainConfig>(
		loadTrainConfig() ?? DEFAULT_TRAIN_CONFIG
	);
	const [boards, setBoards] = createSignal<ScoreBoards>(loadTrainScores() ?? {});
	const [screen, showScreen] = createSignal<Screen>({ kind: 'picker' });
	const [notice, setNotice] = createSignal<string | null>(null);
	// The drill's answers so far, and a leave waiting to be confirmed.
	const [answered, setAnswered] = createSignal(0);
	const [leaving, setLeaving] = createSignal<Leaving | null>(null);
	let leaveTimer: ReturnType<typeof setTimeout> | undefined;
	onCleanup(() => clearTimeout(leaveTimer));

	const disarm = () => {
		clearTimeout(leaveTimer);
		setLeaving(null);
	};

	const setScreen = (next: Screen) => {
		disarm();
		setAnswered(0);
		showScreen(next);
	};

	const inDrill = () => {
		const kind = screen().kind;
		return kind === 'decision' || kind === 'counting';
	};

	/**
	 * Whether leaving for `to` can go ahead now. A drill with nothing answered
	 * goes at once; past that, the first ask only arms the leave, and the same
	 * ask again inside `LEAVE_ARM_MS` confirms it. The drill runs on meanwhile.
	 */
	const mayLeave = (to: string): boolean =>
		untrack(() => {
			if (!inDrill() || answered() === 0 || leaving()?.to === to) {
				disarm();
				return true;
			}
			clearTimeout(leaveTimer);
			setLeaving({ to, answers: answered() });
			leaveTimer = setTimeout(() => setLeaving(null), LEAVE_ARM_MS);
			return false;
		});

	onMount(() => {
		props.onLeaveGuard?.(mayLeave);
		onCleanup(() => props.onLeaveGuard?.(null));
	});

	const updateConfig = (next: TrainConfig) => {
		setConfig(next);
		saveTrainConfig(next);
	};

	const start = (drill: DrillId, mode: DrillMode) => {
		setNotice(null);
		updateConfig({ drill, modes: { ...config().modes, [drill]: mode } });
		const { counts } = planDrill(drill, mode, props.ruleSet, props.tags);
		setScreen({ kind: 'loading', drill, mode, seed: props.seed ?? newSeed(), counts });
	};

	const toPicker = () => setScreen({ kind: 'picker' });

	const quit = () => {
		if (mayLeave('quit')) toPicker();
	};

	createGlobalKeydown((event) => {
		if (event.key !== 'Escape' || !inDrill() || isEscapeConsumingTarget(event)) return;
		event.preventDefault();
		quit();
	});

	// Once the loading screen is left -- the drill dealt, backed out of or
	// abandoned, or the view gone -- the app stops holding its counts for it, or
	// would price them for nobody the next time the worker came free.
	createEffect(() => {
		if (screen().kind !== 'loading') return;
		onCleanup(() => props.onCancelGrids());
	});

	// Waits on the grids, then deals the drill off them. Asks every time the grids
	// change without covering it, which the app answers from what it holds.
	createEffect(() => {
		const current = screen();
		if (current.kind !== 'loading') return;
		const grids = props.grids;
		if (grids === null || !current.counts.every((count) => grids.has(count))) {
			props.onRequestGrids(current.counts);
			return;
		}
		untrack(() => {
			const { drill, mode, seed } = current;
			if (drill === 'counting') {
				setScreen({ kind: 'counting', mode, seed, grids: grids.get(0)! });
				return;
			}
			const build = drill === 'basic' ? basicQuestions : deviationQuestions;
			const questions = build(mode, props.ruleSet, props.tags, grids, seed);
			if (questions.length === 0) {
				setNotice(
					`${labelForSystem(props.system)} moves no play inside the counts priced, so there is nothing for ${DRILL_NAMES[drill]} to ask.`
				);
				toPicker();
				return;
			}
			setScreen({ kind: 'decision', drill, mode, seed, questions, grids });
		});
	});

	// A drill is graded against the game it was dealt under. Change the game and
	// the answers it would give are no longer the sidebar's, so it is abandoned
	// rather than finished under rules nobody is looking at.
	createEffect(
		on(
			() => [props.ruleSet, props.tags],
			() => {
				const kind = untrack(screen).kind;
				if (kind === 'picker' || kind === 'results') return;
				setNotice('The settings changed, so the drill was abandoned.');
				toPicker();
			},
			{ defer: true }
		)
	);

	const finish = (run: DrillRun) => {
		const rules =
			run.drill === 'basic' ? describeRules(props.ruleSet)
			: run.drill === 'counting' ? labelForSystem(props.system)
			: `${describeRules(props.ruleSet)} · ${labelForSystem(props.system)}`;
		const entry = scoreEntry(run, rules, new Date());
		const key = boardKey(run.drill, run.mode, props.ruleSet, props.tags);
		const previousBest = bestOn(boards(), key);
		const recorded = recordScore(boards(), key, entry);
		setBoards(recorded.boards);
		saveTrainScores(recorded.boards);
		setScreen({ kind: 'results', run, entry, recorded, previousBest });
	};

	const loadingLabel = (drill: DrillId, counts: readonly number[]) =>
		counts.length > 1 ?
			`Pricing ${DRILL_NAMES[drill]} at ${counts.length} counts…`
		:	`Pricing ${DRILL_NAMES[drill]}…`;

	return (
		<div class="train-view">
			<div
				class={`train-view__screen ${
					screen().kind === 'picker' || screen().kind === 'results' ? 'is-wide' : ''
				}`}
			>
				<Switch>
					<Match when={screen().kind === 'picker'}>
						<TrainPicker
							ruleSet={props.ruleSet}
							tags={props.tags}
							system={props.system}
							config={config()}
							boards={boards()}
							notice={notice()}
							onModeChange={(drill, mode) =>
								updateConfig({ ...config(), modes: { ...config().modes, [drill]: mode } })
							}
							onStart={start}
						/>
					</Match>
					<Match
						when={(() => {
							const current = screen();
							return current.kind === 'loading' ? current : undefined;
						})()}
					>
						{(loading) => (
							<div class="train-view__loading" role="status">
								<p class="train-view__status">
									{props.error ?? loadingLabel(loading().drill, loading().counts)}
								</p>
								<button type="button" onClick={toPicker}>
									Back to drills
								</button>
							</div>
						)}
					</Match>
					<Match
						when={(() => {
							const current = screen();
							return current.kind === 'decision' ? current : undefined;
						})()}
						keyed
					>
						{(drill) => (
							<TrainDecision
								drill={drill.drill}
								mode={drill.mode}
								questions={drill.questions}
								grids={drill.grids}
								ruleSet={props.ruleSet}
								tags={props.tags}
								animationSpeed={props.animationSpeed}
								onFinish={(records) =>
									finish({
										drill: drill.drill,
										mode: drill.mode,
										seed: drill.seed,
										records,
									})
								}
								onAnswered={setAnswered}
							/>
						)}
					</Match>
					<Match
						when={(() => {
							const current = screen();
							return current.kind === 'counting' ? current : undefined;
						})()}
						keyed
					>
						{(drill) => (
							<TrainCounting
								mode={drill.mode}
								ruleSet={props.ruleSet}
								tags={props.tags}
								grids={drill.grids}
								seed={drill.seed}
								onFinish={(records) =>
									finish({
										drill: 'counting',
										mode: drill.mode,
										seed: drill.seed,
										records,
									})
								}
								onAnswered={setAnswered}
							/>
						)}
					</Match>
					<Match
						when={(() => {
							const current = screen();
							return current.kind === 'results' ? current : undefined;
						})()}
						keyed
					>
						{(results) => (
							<TrainResults
								run={results.run}
								entry={results.entry}
								recorded={results.recorded}
								previousBest={results.previousBest}
								system={props.system}
								onRetry={() => start(results.run.drill, results.run.mode)}
								onBack={toPicker}
							/>
						)}
					</Match>
				</Switch>
				<Show when={inDrill()}>
					<div class="train-view__quit" aria-live="polite">
						<button
							type="button"
							class={`train-view__link ${leaving() ? 'is-armed' : ''}`}
							onClick={quit}
						>
							<span class="train-view__key">Esc</span>
							{quitLabel(leaving())}
						</button>
					</div>
				</Show>
			</div>
		</div>
	);
};

export default TrainView;
