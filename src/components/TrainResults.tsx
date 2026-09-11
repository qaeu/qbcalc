/**
 * The end of a drill: the score, where it landed on its board, the board itself,
 * and every miss laid out again beside what was right.
 */

import { For, Show, type Component } from 'solid-js';

import { labelForSystem, type CountingSystemId } from '#utils/countingSystems';
import { ACTION_CLASS } from '#utils/actionStyle';
import { formatActionLabel, formatCellEvPercent, formatCount } from '#utils/format';
import {
	createGlobalKeydown,
	isEscapeConsumingTarget,
	isKeyConsumingTarget,
} from '#utils/keyboard';
import { COUNTING_PACE } from '#utils/train/drills';
import {
	DRILL_NAMES,
	formatClock,
	indexPhrase,
	MODE_NAMES,
	type CheckpointRecord,
	type DecisionRecord,
	type DrillRun,
} from '#utils/train/run';
import type { RecordedScore, ScoreEntry } from '#utils/train/scores';

import { PlayingCard } from '#c/Felt';
import StatBand, { type StatFigure } from '#c/StatBand';

import '#styles/TrainResults';

interface TrainResultsProps {
	run: DrillRun;
	/** The run as its board took it. */
	entry: ScoreEntry;
	recorded: RecordedScore;
	/** The board's best before this run, if it had one. */
	previousBest?: ScoreEntry;
	system: CountingSystemId;
	onRetry: () => void;
	onBack: () => void;
}

/** A board entry's date, short: `Sep 9`. */
function shortDate(iso: string): string {
	return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const DecisionMiss: Component<{ record: DecisionRecord }> = (props) => {
	const q = () => props.record.question;
	const graded = () => props.record.graded;
	return (
		<li class="train-results__miss">
			<span class="train-results__lead">
				<span class="train-results__hand">
					<For each={q().cards}>
						{(rank, index) => <PlayingCard rank={rank} row={1} index={index()} mini />}
					</For>
					<span class="train-results__v">v</span>
					<PlayingCard rank={q().upcard} row={0} index={0} mini />
				</span>
				<Show when={q().kind !== 'basic'}>
					<span class="train-results__tc" aria-label="True count">
						{formatCount(q().trueCount)}
					</span>
				</Show>
			</span>
			<span class="train-results__calls">
				<span>
					You ·{' '}
					<s class={graded().chosen ? ACTION_CLASS[graded().chosen!] : ''}>
						{graded().chosen ? formatActionLabel(graded().chosen!) : 'Time'}
					</s>
				</span>
				<span>
					Right ·{' '}
					<b class={ACTION_CLASS[graded().answer]}>
						{formatActionLabel(graded().answer)}
					</b>
					<Show when={q().index}>
						{(index) => (
							<small class="train-results__index">
								{' '}
								— {indexPhrase(index(), q().kind)}
							</small>
						)}
					</Show>
				</span>
			</span>
			<span class="train-results__cost">
				{graded().evLostPercent === null ?
					'—'
				:	`${formatCellEvPercent(graded().evLostPercent!)}%`}
			</span>
		</li>
	);
};

const CheckpointMiss: Component<{ record: CheckpointRecord }> = (props) => {
	const graded = () => props.record.graded;
	return (
		<li class="train-results__miss">
			<span class="train-results__lead">
				<span class="train-results__v">Checkpoint {props.record.checkpoint}</span>
			</span>
			<span class="train-results__calls">
				<span>
					You · <s>{graded().answer === null ? 'Time' : formatCount(graded().answer!)}</s>
				</span>
				<span>
					Right · <b>{formatCount(graded().expected)}</b>
					{/* A Test counts on from the last answer given, which can leave the
					    right answer short of the running count itself. */}
					<Show when={graded().expected !== graded().runningCount}>
						<small class="train-results__index">
							{' '}
							— from your last answer; the RC was {formatCount(graded().runningCount)}
						</small>
					</Show>
				</span>
			</span>
			<span class="train-results__cost is-count">
				{graded().answer === null ?
					'—'
				:	`off by ${Math.abs(graded().answer! - graded().expected)}`}
			</span>
		</li>
	);
};

const TrainResults: Component<TrainResultsProps> = (props) => {
	const run = () => props.run;
	const total = () => props.entry.total;
	const accuracy = () => Math.round((props.entry.correct / Math.max(1, total())) * 100);
	const misses = () =>
		run().drill === 'counting' ?
			(run().records as CheckpointRecord[]).filter((record) => !record.graded.correct)
		:	(run().records as DecisionRecord[]).filter((record) => !record.graded.correct);
	const system = () => labelForSystem(props.system);
	const boardName = () =>
		run().drill === 'basic' ? 'these rules'
		: run().drill === 'counting' ? system()
		: `these rules · ${system()}`;
	const tolerance = () =>
		run().drill === 'counting' ? COUNTING_PACE[run().mode].tolerance : 0;

	const figures = (): StatFigure[] => {
		const best = props.previousBest;
		return [
			{
				label: 'Score',
				value: `${props.entry.correct}`,
				unit: `/ ${total()}`,
				note: `${run().drill === 'counting' ? 'checkpoints' : 'hands'} right`,
			},
			{
				label: 'Accuracy',
				value: `${accuracy()}`,
				unit: '%',
				note: tolerance() > 0 ? `±${tolerance()} tolerance` : 'exact answers',
			},
			{
				label: 'Time',
				value: formatClock(props.entry.timeMs),
				note: 'answering only, not dealing',
			},
			{
				label: 'Board',
				value: props.recorded.rank === null ? '—' : `#${props.recorded.rank}`,
				note:
					best ?
						`best was ${best.correct}/${best.total} · ${formatClock(best.timeMs)}`
					:	'first run on this board',
			},
		];
	};

	createGlobalKeydown((event) => {
		if (event.key === 'Escape') {
			if (isEscapeConsumingTarget(event)) return;
			event.preventDefault();
			props.onBack();
			return;
		}
		if (isKeyConsumingTarget(event.target, { allowButtons: true })) return;
		if (event.key === 'r' || event.key === 'R') {
			event.preventDefault();
			props.onRetry();
		}
	});

	return (
		<section class="train-results">
			<div class="train-results__head">
				<div>
					<p class="train-results__eyebrow">
						{DRILL_NAMES[run().drill]} · {MODE_NAMES[run().mode]}
					</p>
					<h2 class="train-results__title">Drill complete</h2>
				</div>
				<Show when={props.recorded.newBest}>
					<span class="train-results__best">★ New best</span>
				</Show>
			</div>

			<StatBand figures={figures()} />

			<div class="train-results__cols">
				<div class="train-results__panel">
					<h3 class="train-results__panel-title">Highscores</h3>
					<p class="train-results__sub">
						Board: {boardName()} · {MODE_NAMES[run().mode]} · ties go to the faster run
					</p>
					<table class="train-results__board">
						<tbody>
							<For each={props.recorded.board}>
								{(entry, index) => (
									<tr class={entry === props.entry ? 'is-you' : ''}>
										<td>{index() + 1}</td>
										<td>
											{entry.correct}/{entry.total}
										</td>
										<td>{formatClock(entry.timeMs)}</td>
										<td class="train-results__dim">
											{entry === props.entry ? 'This run' : shortDate(entry.date)}
										</td>
									</tr>
								)}
							</For>
						</tbody>
					</table>
					<Show when={props.recorded.rank === null}>
						<p class="train-results__sub">This run didn't make the top five.</p>
					</Show>
				</div>

				<div class="train-results__panel">
					<h3 class="train-results__panel-title">Review</h3>
					<p class="train-results__sub">{misses().length} missed</p>
					<Show
						when={misses().length > 0}
						fallback={<p class="train-results__empty">Nothing missed. Clean run.</p>}
					>
						<ul class="train-results__misses">
							<Show
								when={run().drill === 'counting'}
								fallback={
									<For each={misses() as DecisionRecord[]}>
										{(record) => <DecisionMiss record={record} />}
									</For>
								}
							>
								<For each={misses() as CheckpointRecord[]}>
									{(record) => <CheckpointMiss record={record} />}
								</For>
							</Show>
						</ul>
					</Show>
				</div>
			</div>

			<div class="train-results__actions">
				<button type="button" class="highlight" onClick={() => props.onRetry()}>
					<span class="train-results__key">R</span>Retry
				</button>
				<button type="button" onClick={() => props.onBack()}>
					<span class="train-results__key">Esc</span>Back to drills
				</button>
			</div>
		</section>
	);
};

export default TrainResults;
