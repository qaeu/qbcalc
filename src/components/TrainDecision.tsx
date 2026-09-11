/**
 * A Basic or Deviation drill on the felt: each question dealt card by card as a
 * live hand is, answered from the action bar, and -- outside a Test -- given its
 * verdict before the next. Hands its answers up when the last is given; the view
 * scores them. See docs/train-model.md §Grading.
 */

import {
	createEffect,
	createMemo,
	createSignal,
	For,
	on,
	onCleanup,
	Show,
	untrack,
	type Component,
} from 'solid-js';

import type { TagValues } from '#utils/ev/composition';
import type { PlayerAction, RuleSet } from '#utils/ev/rules';
import type { TrainGrids } from '#utils/evWorkerProtocol';
import { formatActionLabel, formatCellEvPercent, formatCount } from '#utils/format';
import { createGlobalKeydown, isKeyConsumingTarget } from '#utils/keyboard';
import { legalActions, offeredActions } from '#utils/play/game';
import { CARD_DEAL_DELAY_MS } from '#utils/play/reveal';
import type { AnimationSpeed } from '#utils/storage';
import { createAnswerClock } from '#utils/train/clock';
import {
	hasFeedback,
	questionState,
	TEST_TIME_LIMIT_MS,
	type DecisionQuestion,
	type DrillMode,
} from '#utils/train/drills';
import { gradeAnswer } from '#utils/train/grade';
import { handPhrase, indexPhrase, type DecisionRecord } from '#utils/train/run';

import { ActionBar, createRevealQueue, Felt, FeltVerdict } from '#c/Felt';
import TrainHud, { type StepMark } from '#c/TrainHud';

import '#styles/TrainDrill';

/** How long a Test leaves an answered hand on the felt before dealing the next. */
const TEST_ADVANCE_MS = 220;

interface TrainDecisionProps {
	drill: 'basic' | 'deviation';
	mode: DrillMode;
	questions: readonly DecisionQuestion[];
	grids: TrainGrids;
	ruleSet: RuleSet;
	tags: TagValues;
	animationSpeed: AnimationSpeed;
	onFinish: (records: DecisionRecord[]) => void;
	/** How many questions have been answered, each time one is. */
	onAnswered: (count: number) => void;
}

type Phase = 'dealing' | 'asking' | 'answered';

const TrainDecision: Component<TrainDecisionProps> = (props) => {
	const feedback = () => hasFeedback(props.mode);
	const [index, setIndex] = createSignal(0);
	const [phase, setPhase] = createSignal<Phase>('dealing');
	const [records, setRecords] = createSignal<DecisionRecord[]>([]);

	const question = createMemo(() => props.questions[index()]);
	const state = createMemo(() =>
		questionState(
			question(),
			untrack(() => props.ruleSet),
			untrack(() => props.tags)
		)
	);
	const offered = createMemo(() => offeredActions(props.ruleSet));
	const legal = createMemo(() => legalActions(state()));
	const last = () => records()[records().length - 1];
	const answered = () => (phase() === 'answered' ? last() : undefined);

	const queue = createRevealQueue(
		state,
		() => CARD_DEAL_DELAY_MS[props.animationSpeed],
		index
	);

	let advanceTimer: ReturnType<typeof setTimeout> | undefined;
	onCleanup(() => clearTimeout(advanceTimer));

	// The mode is fixed for the drill's life: a new one is a new drill.
	const clock = createAnswerClock(
		untrack(() => props.mode) === 'test' ? TEST_TIME_LIMIT_MS : null,
		() => answer(null)
	);

	// The clock starts on the last card landing, not on the deal: time spent
	// watching cards arrive is the animation's, not the player's. The question is
	// tracked too, since with no animation the felt never stops being dealt.
	createEffect(
		on([queue.fullyDealt, index], ([dealt]) => {
			if (!dealt || untrack(phase) !== 'dealing') return;
			setPhase('asking');
			clock.start();
		})
	);

	const next = () => {
		if (index() + 1 >= props.questions.length) {
			props.onFinish(records());
			return;
		}
		setPhase('dealing');
		setIndex(index() + 1);
	};

	function answer(chosen: PlayerAction | null) {
		if (phase() !== 'asking') return;
		const timeMs = clock.stop();
		const q = question();
		const graded = gradeAnswer(
			state(),
			chosen,
			props.grids.get(q.trueCount)!,
			q.trueCount
		);
		// Every question was drawn off these same grids, so they reach every hand.
		if (graded === null) throw new Error('A drill question fell outside its grids.');
		setRecords([...records(), { question: q, graded, timeMs }]);
		props.onAnswered(records().length);
		setPhase('answered');
		if (!feedback()) advanceTimer = setTimeout(next, TEST_ADVANCE_MS);
	}

	const marks = createMemo<StepMark[]>(() =>
		props.questions.map((_, at) => {
			const record = records()[at];
			if (record === undefined) return null;
			if (!feedback()) return 'done';
			return record.graded.correct ? 'right' : 'miss';
		})
	);
	const clockMs = () =>
		records().reduce((sum, record) => sum + record.timeMs, 0) + clock.elapsed();

	createGlobalKeydown((event) => {
		if (isKeyConsumingTarget(event.target, { allowButtons: true })) return;
		if (phase() === 'asking') {
			const digit = Number(event.key);
			if (!Number.isInteger(digit) || digit < 1) return;
			const action = offered()[digit - 1];
			if (action !== undefined && legal().includes(action)) {
				event.preventDefault();
				answer(action);
			}
			return;
		}
		if (event.key === ' ' && phase() === 'answered' && feedback()) {
			event.preventDefault();
			// Off whatever button was last pressed, so the key's release cannot
			// press it again on the hand this one deals.
			(document.activeElement as HTMLElement | null)?.blur?.();
			next();
		}
	});

	const isLast = () => index() + 1 >= props.questions.length;

	return (
		<div class="train-drill">
			<TrainHud
				drill={props.drill}
				mode={props.mode}
				unit="Hand"
				current={index()}
				marks={marks()}
				correct={
					feedback() ? records().filter((record) => record.graded.correct).length : null
				}
				clockMs={clockMs()}
				remainingMs={clock.running() ? TEST_TIME_LIMIT_MS - clock.elapsed() : null}
			/>

			<Felt state={state()} queue={queue}>
				<Show when={props.drill === 'deviation'}>
					<div class="train-drill__tc">
						{/* Keyed on the question, so the counter lands again each hand. */}
						<For each={[question()]}>
							{(shown) => (
								<span class="train-drill__puck">{formatCount(shown.trueCount)}</span>
							)}
						</For>
						<span class="train-drill__tc-label">True count</span>
					</div>
				</Show>
			</Felt>

			<div class="train-drill__verdict">
				<Show
					when={feedback() ? answered() : undefined}
					fallback={
						<Show when={feedback()}>
							<span class="train-drill__hint">
								<Show when={phase() === 'asking'} fallback="Dealing…">
									Pick the play
									<span class="train-drill__keys"> · keys 1–{offered().length}</span>
								</Show>
							</span>
						</Show>
					}
				>
					{(record) => (
						<FeltVerdict
							right={record().graded.correct}
							aside={
								<button type="button" class="highlight" onClick={next}>
									<span class="train-drill__key">Space</span>
									{isLast() ? 'Results' : 'Next hand'}
								</button>
							}
						>
							<DecisionVerdict record={record()} />
						</FeltVerdict>
					)}
				</Show>
			</div>

			<div class={`train-drill__shelf ${phase() === 'dealing' ? '' : 'is-shown'}`}>
				<ActionBar
					offered={offered()}
					legal={legal()}
					onAction={answer}
					locked={phase() !== 'asking'}
					answer={feedback() ? answered()?.graded.answer : undefined}
					picked={feedback() ? answered()?.graded.chosen : undefined}
				/>
			</div>

			<Show when={!feedback()}>
				<p class="train-drill__hint">Test · 5 s a hand · verdicts held until the end</p>
			</Show>
		</div>
	);
};

/** What the banner says about one answer. */
const DecisionVerdict: Component<{ record: DecisionRecord }> = (props) => {
	const q = () => props.record.question;
	const graded = () => props.record.graded;
	const right = () => formatActionLabel(graded().answer);
	const hand = () => handPhrase(q().cards, q().upcard);
	const cost = () =>
		graded().evLostPercent === null ?
			''
		:	` · ${formatCellEvPercent(graded().evLostPercent!)}% EV`;

	return (
		<Show
			when={q().index}
			fallback={
				<Show
					when={graded().correct}
					fallback={
						<>
							<b>{right()}</b> was right here{' '}
							<small>
								· {hand()}
								{cost()}
							</small>
						</>
					}
				>
					<b>{right()}</b> — {hand()}
				</Show>
			}
		>
			{(index) => (
				<Show
					when={graded().correct}
					fallback={
						<>
							<b>{right()}</b> was right — {indexPhrase(index(), q().kind)} (you're at{' '}
							{formatCount(q().trueCount)}){' '}
							<small>
								· {hand()}
								{cost()}
							</small>
						</>
					}
				>
					{/* A control's index is the play it did not make yet, not the one made. */}
					<b>{right()}</b> —{' '}
					{q().kind === 'control' ?
						`${indexPhrase(index(), 'deviation')}, not yet`
					:	indexPhrase(index(), q().kind)}{' '}
					<small>· {hand()}</small>
				</Show>
			)}
		</Show>
	);
};

export default TrainDecision;
