/**
 * A Counting drill: rounds dealt and played to basic strategy on their own, a
 * checkpoint every few of them asking for the running count, and the shoe
 * shuffling at its cut card as a live one does. Hands its answers up when the
 * last checkpoint is answered. See docs/train-model.md §Counting checkpoints.
 */

import {
	createEffect,
	createSignal,
	For,
	on,
	onCleanup,
	onMount,
	Show,
	untrack,
	type Component,
} from 'solid-js';

import type { TagValues } from '#utils/ev/composition';
import type { RuleSet } from '#utils/ev/rules';
import type { PlayGrids } from '#utils/evWorkerProtocol';
import { formatCount } from '#utils/format';
import { createGlobalKeydown, isKeyConsumingTarget } from '#utils/keyboard';
import { createGame, preRound, type GameState } from '#utils/play/game';
import { CARD_DEAL_DELAY_MS } from '#utils/play/reveal';
import { createShoe } from '#utils/play/shoe';
import { createAnswerClock } from '#utils/train/clock';
import {
	checkpointRounds,
	COUNTING_PACE,
	dealCountingRound,
	hasFeedback,
	TEST_TIME_LIMIT_MS,
	type DrillMode,
} from '#utils/train/drills';
import {
	gradeCheckpoint,
	nextBasis,
	ZERO_BASIS,
	type CountBasis,
} from '#utils/train/grade';
import type { CheckpointRecord } from '#utils/train/run';

import { createRevealQueue, Felt, FeltVerdict } from '#c/Felt';
import TrainHud, { type StepMark } from '#c/TrainHud';

import '#styles/TrainDrill';

/** How long the shuffle notice holds the felt before the next round is dealt. */
const SHUFFLE_NOTICE_MS = 1600;

/** How long a Test leaves an answered checkpoint before dealing on. */
const TEST_ADVANCE_MS = 300;

/** What a typed count reads as: a sign, then digits. Anything else is dropped. */
function sanitizeCount(raw: string): string {
	const normalised = raw.replace(/[−–]/g, '-').replace(/[^\d+-]/g, '');
	const sign = /^[+-]/.exec(normalised)?.[0] ?? '';
	return sign + normalised.replace(/[+-]/g, '');
}

/** The typed count, where there is one; a blank field is a zero, as its placeholder says. */
function parseCount(raw: string): number {
	const digits = raw.replace(/^[+-]/, '');
	if (digits === '') return 0;
	return (raw.startsWith('-') ? -1 : 1) * Number.parseInt(digits, 10);
}

interface TrainCountingProps {
	mode: DrillMode;
	ruleSet: RuleSet;
	tags: TagValues;
	/** The unadjusted grids the seat plays basic strategy off. */
	grids: PlayGrids;
	seed: number;
	onFinish: (records: CheckpointRecord[]) => void;
	/** How many checkpoints have been answered, each time one is. */
	onAnswered: (count: number) => void;
}

type Phase = 'dealing' | 'pause' | 'shuffle' | 'asking' | 'answered';

interface Notice {
	big: string;
	small: string;
}

const TrainCounting: Component<TrainCountingProps> = (props) => {
	// The drill's own game, fixed at its start: a settings change abandons the
	// drill rather than reaching into it.
	const { mode, ruleSet, tags, grids, seed } = untrack(() => ({ ...props }));
	const pace = COUNTING_PACE[mode];
	const feedback = hasFeedback(mode);
	// One seed, two streams: the shoe's shuffles, and the checkpoints' lengths.
	const blocks = checkpointRounds(mode, seed + 1);
	let game: GameState = createGame(ruleSet, createShoe(ruleSet, tags, seed));
	let basis: CountBasis = ZERO_BASIS;

	const [felt, setFelt] = createSignal<GameState>(game);
	const [round, setRound] = createSignal(0);
	const [phase, setPhase] = createSignal<Phase>('pause');
	const [checkpoint, setCheckpoint] = createSignal(0);
	const [inBlock, setInBlock] = createSignal(0);
	const [notice, setNotice] = createSignal<Notice | null>(null);
	const [records, setRecords] = createSignal<CheckpointRecord[]>([]);
	const [entry, setEntry] = createSignal('');
	let input: HTMLInputElement | undefined;

	const queue = createRevealQueue(felt, () => CARD_DEAL_DELAY_MS[pace.speed], round);

	const timers = new Set<ReturnType<typeof setTimeout>>();
	const later = (run: () => void, ms: number) => {
		const timer = setTimeout(() => {
			timers.delete(timer);
			run();
		}, ms);
		timers.add(timer);
		return timer;
	};
	onCleanup(() => timers.forEach(clearTimeout));
	/** The time left to count the round on the felt, while it runs. */
	let pauseTimer: ReturnType<typeof setTimeout> | undefined;

	const clock = createAnswerClock(mode === 'test' ? TEST_TIME_LIMIT_MS : null, () =>
		submit(null)
	);

	const deal = () => {
		game = dealCountingRound(game, grids);
		// The felt clears before the round lands on it. A round no bigger than the
		// last would otherwise read as already shown, and its time to count would
		// start before its first card did.
		setFelt(preRound(game));
		setPhase('dealing');
		setFelt(game);
		setRound(round() + 1);
	};

	/** The next round -- behind a shuffle, where the cut card has come out. */
	const dealNext = () => {
		setNotice(null);
		if (!game.shoe.needsShuffle()) {
			deal();
			return;
		}
		// `startRound` shuffles before it deals; the notice is only the felt saying so.
		basis = ZERO_BASIS;
		setFelt(preRound(game));
		setNotice({ big: 'Shuffle', small: 'The count starts again at 0' });
		setPhase('shuffle');
		later(deal, SHUFFLE_NOTICE_MS);
	};

	const ask = () => {
		setFelt(preRound(game));
		setNotice({
			big: `Checkpoint ${checkpoint() + 1} of ${blocks.length}`,
			small: "What's the running count?",
		});
		setEntry('');
		setPhase('asking');
		clock.start();
		input?.focus({ preventScroll: true });
	};

	/** The round counted: on to the checkpoint, or to the next round. */
	const endPause = () => {
		pauseTimer = undefined;
		const played = inBlock() + 1;
		setInBlock(played);
		if (played >= blocks[checkpoint()]) ask();
		else dealNext();
	};

	/**
	 * Ends the time to count early. The mode's `countMs` is the most a round is
	 * left for; a player who has it counted deals on, and a drill is not mostly
	 * spent watching rounds already counted.
	 */
	const hurry = () => {
		if (phase() !== 'pause' || pauseTimer === undefined) return;
		clearTimeout(pauseTimer);
		timers.delete(pauseTimer);
		endPause();
	};

	// A round's cards are all drawn the moment it is dealt; the time to count
	// them, and the next round, wait on the felt having shown the last of them.
	createEffect(
		on([queue.fullyDealt, round], ([dealt]) => {
			if (!dealt || untrack(phase) !== 'dealing') return;
			setPhase('pause');
			pauseTimer = later(endPause, pace.countMs);
		})
	);

	onMount(dealNext);

	const carryOn = () => {
		if (checkpoint() + 1 >= blocks.length) {
			props.onFinish(records());
			return;
		}
		setCheckpoint(checkpoint() + 1);
		setInBlock(0);
		dealNext();
	};

	function submit(answer: number | null) {
		if (phase() !== 'asking') return;
		const timeMs = clock.stop();
		const graded = gradeCheckpoint(
			answer,
			game.shoe.runningCount(),
			basis,
			pace.tolerance
		);
		basis = nextBasis(graded, feedback);
		setRecords([...records(), { checkpoint: checkpoint() + 1, graded, timeMs }]);
		props.onAnswered(records().length);
		input?.blur();
		setPhase('answered');
		if (feedback) setNotice(null);
		else later(carryOn, TEST_ADVANCE_MS);
	}

	const marks = (): StepMark[] =>
		blocks.map((_, at) => {
			const record = records()[at];
			if (record === undefined) return null;
			if (!feedback) return 'done';
			return record.graded.correct ? 'right' : 'miss';
		});

	createGlobalKeydown((event) => {
		if (isKeyConsumingTarget(event.target, { allowButtons: true })) return;
		if (event.key !== ' ') return;
		if (phase() === 'pause') {
			event.preventDefault();
			// Not on a held key's repeats, which would deal on past every round.
			if (!event.repeat) hurry();
		} else if (phase() === 'answered' && feedback) {
			event.preventDefault();
			(document.activeElement as HTMLElement | null)?.blur?.();
			carryOn();
		}
	});

	const last = () => records()[records().length - 1];
	const isLast = () => checkpoint() + 1 >= blocks.length;

	return (
		<div class="train-drill">
			<TrainHud
				drill="counting"
				mode={mode}
				unit="Checkpoint"
				current={checkpoint()}
				marks={marks()}
				correct={
					feedback ? records().filter((record) => record.graded.correct).length : null
				}
				clockMs={
					records().reduce((sum, record) => sum + record.timeMs, 0) + clock.elapsed()
				}
				remainingMs={clock.running() ? TEST_TIME_LIMIT_MS - clock.elapsed() : null}
			>
				<Show
					when={mode === 'easy'}
					fallback={
						<span class="train-hud__read">
							Rounds{' '}
							<b>
								{blocks.slice(0, checkpoint()).reduce((a, b) => a + b, 0) + inBlock()}
							</b>
						</span>
					}
				>
					{/* Easy shows the checkpoint coming; Hard keeps its length back, so
					    the question cannot be timed. */}
					<span
						class="train-drill__rounds"
						title={`Round ${inBlock()} of ${blocks[checkpoint()]}`}
					>
						<For each={Array.from({ length: blocks[checkpoint()] }, (_, at) => at)}>
							{(at) => <i class={at < inBlock() ? 'is-on' : ''} />}
						</For>
					</span>
				</Show>
				<span class="train-hud__read">
					Count <b>{pace.countMs / 1000} s</b>
				</span>
			</TrainHud>

			<Felt
				state={felt()}
				queue={queue}
				playerLabel="Seat · played to basic"
				quiet={notice() !== null}
				onTap={hurry}
			>
				<Show when={notice()}>
					{(shown) => (
						<div class="felt__notice">
							<span class="felt__notice-big">{shown().big}</span>
							<span class="felt__notice-small">{shown().small}</span>
						</div>
					)}
				</Show>
			</Felt>

			<div class="train-drill__verdict">
				<Show when={feedback && phase() === 'answered' ? last() : undefined}>
					{(record) => (
						<FeltVerdict
							right={record().graded.correct}
							aside={
								<button type="button" class="highlight" onClick={carryOn}>
									<span class="train-drill__key">Space</span>
									{isLast() ? 'Results' : 'Keep dealing'}
								</button>
							}
						>
							<CheckpointVerdict record={record()} />
						</FeltVerdict>
					)}
				</Show>
			</div>

			<div class="train-drill__shelf is-shown">
				<p class={`train-drill__hint ${phase() === 'asking' ? '' : 'is-shown'}`}>
					Keep the running count · <span class="train-drill__keys">Space or </span>tap the
					felt when counted
				</p>
				<form
					class={`train-drill__entry ${phase() === 'asking' ? 'is-shown' : ''}`}
					autocomplete="off"
					onSubmit={(event) => {
						event.preventDefault();
						submit(parseCount(entry()));
					}}
				>
					<label class="train-drill__entry-label" for="train-count-entry">
						Running count
					</label>
					<button
						type="button"
						class="train-drill__sign"
						aria-label="Flip sign"
						disabled={phase() !== 'asking'}
						onClick={() => {
							const value = entry();
							setEntry(
								value.startsWith('-') ? value.slice(1) : `-${value.replace(/^\+/, '')}`
							);
							input?.focus();
						}}
					>
						±
					</button>
					<input
						ref={input}
						id="train-count-entry"
						class="train-drill__input"
						inputmode="numeric"
						placeholder="0"
						disabled={phase() !== 'asking'}
						value={entry()}
						onInput={(event) => {
							const clean = sanitizeCount(event.currentTarget.value);
							event.currentTarget.value = clean;
							setEntry(clean);
						}}
					/>
					<button type="submit" class="highlight" disabled={phase() !== 'asking'}>
						<span class="train-drill__key">Enter</span>Submit
					</button>
				</form>
			</div>

			<Show when={!feedback}>
				<p class="train-drill__hint is-shown">
					Test · 5 s a checkpoint · verdicts held until the end
				</p>
			</Show>
		</div>
	);
};

/** What the banner says about one checkpoint. */
const CheckpointVerdict: Component<{ record: CheckpointRecord }> = (props) => {
	const graded = () => props.record.graded;
	const said = () =>
		graded().answer === null ? 'no answer' : `you said ${formatCount(graded().answer!)}`;
	const exact = () => graded().answer === graded().expected;

	return (
		<Show
			when={graded().correct}
			fallback={
				<>
					The RC was <b>{formatCount(graded().expected)}</b> <small>· {said()}</small>
				</>
			}
		>
			<Show
				when={exact()}
				fallback={
					<>
						<b>Within one</b> — the RC was {formatCount(graded().expected)}{' '}
						<small>· {said()}</small>
					</>
				}
			>
				<b>RC {formatCount(graded().expected)}</b> — exact
			</Show>
		</Show>
	);
};

export default TrainCounting;
