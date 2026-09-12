/**
 * The Train view's front page: the three drills side by side, each with its mode,
 * its length and the best run on its board under the sidebar's current game.
 */

import { For, Show, type Component, type JSX } from 'solid-js';

import { labelForSystem, type CountingSystemId } from '#utils/settings/countingSystems';
import type { Rank } from '#utils/ev/cards';
import type { TagValues } from '#utils/ev/composition';
import type { RuleSet } from '#utils/ev/rules';
import { formatCount } from '#utils/ui/format';
import type { TrainConfig } from '#utils/settings/storage';
import {
	COUNTING_PACE,
	DRILL_IDS,
	DRILL_MODES,
	drillLength,
	type DrillId,
	type DrillMode,
} from '#utils/train/drills';
import { DRILL_NAMES, formatClock, MODE_NAMES } from '#utils/train/run';
import { bestOn, boardKey, describeRules, type ScoreBoards } from '#utils/train/scores';

import { PlayingCard } from '#c/common/Felt';

import '#styles/train/TrainPicker';

const DESCRIPTIONS: Record<DrillId, string> = {
	basic: 'A hand is dealt; pick the play basic strategy makes under these rules.',
	counting:
		'Rounds deal themselves to basic strategy. Keep the running count and give it at each checkpoint.',
	deviation:
		'A hand and a true count; pick the play the count calls for — which is sometimes still basic.',
};

/** What each mode means for a drill, in a line. */
function modeNote(drill: DrillId, mode: DrillMode): string {
	if (drill === 'counting') {
		const pace = COUNTING_PACE[mode];
		const rounds =
			pace.minRounds === pace.maxRounds ?
				`${pace.minRounds}`
			:	`${pace.minRounds}–${pace.maxRounds}`;
		const pacing = `dealt at ${pace.speed}, up to ${pace.countMs / 1000} s to count each`;
		if (mode === 'test')
			return `${rounds} rounds per checkpoint, ${pacing}. 5 s to answer, verdicts held until the end.`;
		// Easy deals loose cards, not rounds, so it counts them rather than hands.
		const unit =
			pace.cardsPerRound === undefined ?
				'rounds'
			:	`deals of ${pace.cardsPerRound} cards`;
		return pace.tolerance > 0 ?
				`${rounds} ${unit} per checkpoint, ${pacing}. Within ±${pace.tolerance} counts as right.`
			:	`${rounds} ${unit} per checkpoint, ${pacing}. Exact counts only.`;
	}
	if (mode === 'test')
		return 'The hard pool against the clock. Verdicts held until the end.';
	if (drill === 'basic') {
		return mode === 'easy' ?
				'Hands as often as they are dealt. A verdict after every answer.'
			:	'Rare and borderline cells, soft doubles, surrenders and multi-card hands.';
	}
	return mode === 'easy' ?
			'Common counts and common hands. A verdict after every answer.'
		:	'Rare indices: extreme and negative counts, split and surrender plays.';
}

/** The length's unit, under the figure. */
function lengthUnit(drill: DrillId, mode: DrillMode): string {
	if (mode === 'test') return drill === 'counting' ? '5 s to answer' : '5 s a hand';
	return drill === 'counting' ? 'checkpoints' : 'hands';
}

/**
 * The mode an arrow key moves a radio group to from `mode`, round the ends, or
 * null for any other key -- the keyboard a radio group owes its reader.
 */
function arrowedMode(key: string, mode: DrillMode): DrillMode | null {
	const step =
		key === 'ArrowRight' || key === 'ArrowDown' ? 1
		: key === 'ArrowLeft' || key === 'ArrowUp' ? -1
		: 0;
	if (step === 0) return null;
	const at = DRILL_MODES.indexOf(mode) + step;
	return DRILL_MODES[(at + DRILL_MODES.length) % DRILL_MODES.length];
}

/** A hand laid out small: the cards, a `v`, the upcard. */
const MiniHand: Component<{ cards: Rank[]; upcard: Rank }> = (props) => (
	<div class="train-picker__hand">
		<div class="train-picker__fan">
			<For each={props.cards}>
				{(rank, index) => <PlayingCard rank={rank} row={1} index={index()} mini />}
			</For>
		</div>
		<span class="train-picker__v">v</span>
		<PlayingCard rank={props.upcard} row={0} index={0} mini />
	</div>
);

/** A few cards in a run, each with the tag the counting system gives it. */
const CountRun: Component<{ tags: TagValues }> = (props) => (
	<div class="train-picker__run">
		<For each={['5', 'T', '8', '3', 'A'] as Rank[]}>
			{(rank, index) => (
				<div class="train-picker__run-col">
					<PlayingCard rank={rank} row={2} index={index()} mini />
					<span class="train-picker__run-tag">{formatCount(props.tags[rank])}</span>
				</div>
			)}
		</For>
	</div>
);

interface TrainPickerProps {
	ruleSet: RuleSet;
	tags: TagValues;
	system: CountingSystemId;
	config: TrainConfig;
	boards: ScoreBoards;
	/** Said above the drills: why the last one ended early, where it did. */
	notice?: string | null;
	onModeChange: (drill: DrillId, mode: DrillMode) => void;
	onStart: (drill: DrillId, mode: DrillMode) => void;
}

const TrainPicker: Component<TrainPickerProps> = (props) => {
	const system = () => labelForSystem(props.system);
	const boardLabel = (drill: DrillId) =>
		drill === 'basic' ? 'these rules'
		: drill === 'counting' ? system()
		: `these rules · ${system()}`;

	const art = (drill: DrillId): JSX.Element =>
		drill === 'basic' ? <MiniHand cards={['A', '7']} upcard="2" />
		: drill === 'counting' ? <CountRun tags={props.tags} />
		: <>
				<MiniHand cards={['T', '2']} upcard="3" />
				<span class="train-picker__puck">+3</span>
			</>;

	return (
		<section class="train-picker">
			<div class="train-picker__head">
				<h2 class="train-picker__title">Train</h2>
				<p class="train-picker__rules">
					Graded against the sidebar:{' '}
					<b>
						{describeRules(props.ruleSet)} · {props.ruleSet.blackjackPayout}
					</b>{' '}
					· <b>{system()}</b>
				</p>
			</div>

			<Show when={props.notice}>
				<p class="train-picker__notice" role="status">
					{props.notice}
				</p>
			</Show>

			<div class="train-picker__drills">
				<For each={DRILL_IDS}>
					{(drill) => {
						const mode = () => props.config.modes[drill];
						const best = () =>
							bestOn(props.boards, boardKey(drill, mode(), props.ruleSet, props.tags));
						return (
							<article class="train-picker__drill">
								<div class="train-picker__art" aria-hidden="true">
									{art(drill)}
								</div>
								<div class="train-picker__intro">
									<h3 class="train-picker__name">{DRILL_NAMES[drill]}</h3>
									<p class="train-picker__desc">{DESCRIPTIONS[drill]}</p>
								</div>
								<div
									class="train-picker__modes"
									role="radiogroup"
									aria-label={`${DRILL_NAMES[drill]} difficulty`}
								>
									<For each={DRILL_MODES}>
										{(option) => (
											<button
												type="button"
												role="radio"
												aria-checked={mode() === option}
												// One stop in the tab order; the arrows move within it.
												tabIndex={mode() === option ? 0 : -1}
												class={mode() === option ? 'active' : ''}
												onClick={() => props.onModeChange(drill, option)}
												onKeyDown={(event) => {
													const next = arrowedMode(event.key, option);
													if (next === null) return;
													event.preventDefault();
													props.onModeChange(drill, next);
													const radios =
														event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
															'[role="radio"]'
														);
													radios?.[DRILL_MODES.indexOf(next)]?.focus();
												}}
											>
												{MODE_NAMES[option]}
											</button>
										)}
									</For>
								</div>
								<p class="train-picker__note">{modeNote(drill, mode())}</p>
								<dl class="train-picker__meta">
									<div>
										<dt>Length</dt>
										<dd>
											{drillLength(drill, mode())}
											<small>{lengthUnit(drill, mode())}</small>
										</dd>
									</div>
									<div>
										<dt>Best</dt>
										<dd>
											<Show
												when={best()}
												fallback={
													<>
														—<small>No run yet</small>
													</>
												}
											>
												{(entry) => (
													<>
														{entry().correct}/{entry().total}
														<small>
															{formatClock(entry().timeMs)} · {boardLabel(drill)}
														</small>
													</>
												)}
											</Show>
										</dd>
									</div>
								</dl>
								<button
									type="button"
									class="highlight train-picker__start"
									onClick={() => props.onStart(drill, mode())}
								>
									Start
								</button>
							</article>
						);
					}}
				</For>
			</div>
		</section>
	);
};

export default TrainPicker;
