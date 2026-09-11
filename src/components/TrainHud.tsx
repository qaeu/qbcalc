/**
 * The strip across the top of a drill: which drill, how far through it, how each
 * answer went, and the clock -- or, in a Test, the draining countdown that
 * replaces it. Given everything it shows; the drill owns the timing.
 */

import { For, Show, type Component, type JSX } from 'solid-js';

import { TEST_TIME_LIMIT_MS, type DrillId, type DrillMode } from '#utils/train/drills';
import { DRILL_NAMES, formatClock, MODE_NAMES } from '#utils/train/run';

import '#styles/TrainHud';

/** How one step of the progress strip reads. */
export type StepMark = 'right' | 'miss' | 'done' | null;

/** Under the last `LOW_TIME_MS` of a Test's clock the countdown turns ruby. */
const LOW_TIME_MS = 1500;

interface TrainHudProps {
	drill: DrillId;
	mode: DrillMode;
	/** 'Hand' or 'Checkpoint'. */
	unit: string;
	/** From 0: the question in front of the player. */
	current: number;
	/** One per question: how it went, or null while unanswered. */
	marks: readonly StepMark[];
	/** Right so far -- shown only where each answer gets a verdict. */
	correct: number | null;
	/** The answering time so far, for the clock. Unread in a Test, whose countdown replaces it. */
	clockMs: number;
	/** A Test's time left on this question, or null while none is being asked. */
	remainingMs?: number | null;
	/** Whatever else the drill reads out at the far end: the rounds, the pace. */
	children?: JSX.Element;
}

const TrainHud: Component<TrainHudProps> = (props) => {
	const test = () => props.mode === 'test';
	const remaining = () => props.remainingMs ?? TEST_TIME_LIMIT_MS;

	return (
		<div class="train-hud">
			<span class="train-hud__drill">
				{DRILL_NAMES[props.drill]} <em>· {MODE_NAMES[props.mode]}</em>
			</span>
			<span class="train-hud__read">
				{props.unit} <b>{Math.min(props.current + 1, props.marks.length)}</b> /{' '}
				{props.marks.length}
			</span>
			<div
				class={`train-hud__steps ${props.marks.length > 20 ? 'is-dense' : ''}`}
				aria-hidden="true"
			>
				<For each={props.marks}>
					{(mark, index) => (
						<span
							class={`train-hud__step ${mark ? `is-${mark}` : ''} ${
								index() === props.current ? 'is-current' : ''
							}`}
						/>
					)}
				</For>
			</div>
			<div class="train-hud__end">
				{props.children}
				<Show when={props.correct !== null}>
					<span class="train-hud__read">
						✓ <b>{props.correct}</b>
					</span>
				</Show>
				<Show
					when={test()}
					fallback={
						<span class="train-hud__read">
							Time <b>{formatClock(props.clockMs)}</b>
						</span>
					}
				>
					<div class="train-hud__countdown" role="timer">
						<div class="train-hud__countdown-track">
							<div
								class={`train-hud__countdown-range ${
									remaining() < LOW_TIME_MS ? 'is-low' : ''
								}`}
								style={{ width: `${(remaining() / TEST_TIME_LIMIT_MS) * 100}%` }}
							/>
						</div>
						<span class="train-hud__read">
							<b>{(remaining() / 1000).toFixed(1)}</b> s
						</span>
					</div>
				</Show>
			</div>
		</div>
	);
};

export default TrainHud;
