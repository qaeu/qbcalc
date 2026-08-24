/**
 * The lifetime training record: what was won, how much of the play was optimal,
 * and what the mistakes cost. Live, so switching to it mid-shoe shows the
 * session so far already folded into the totals.
 */

import { createSignal, Show, type Component } from 'solid-js';

import { signClass } from '#utils/actionStyle';
import { formatEvCurrency, formatPercent, formatRounds } from '#utils/format';
import {
	evDeviation,
	optimalPlayPercent,
	type PlayStats as PlayStatsRecord,
} from '#utils/play/stats';

import '#styles/PlayStats';

/** What a figure with nothing behind it yet reads as. */
const NO_FIGURE = '—';

interface StatCardProps {
	label: string;
	value: string;
	unit?: string;
	/** The figure the +/- colouring keys off, where its sign carries meaning. */
	sign?: number;
}

const StatCard: Component<StatCardProps> = (props) => (
	<div class="play-stats__card">
		<span class="play-stats__label">{props.label}</span>
		<span
			class={`play-stats__value ${
				props.sign === undefined ? '' : (signClass(props.sign) ?? '')
			}`}
		>
			{props.value}
			<Show when={props.unit}>
				<span class="play-stats__unit">{props.unit}</span>
			</Show>
		</span>
	</div>
);

interface PlayStatsProps {
	stats: PlayStatsRecord;
	onReset: () => void;
}

const PlayStats: Component<PlayStatsProps> = (props) => {
	// Two-step rather than a dialog: the record is the only thing on this panel,
	// and losing it to a stray click is the one mistake it cannot recover from.
	const [confirming, setConfirming] = createSignal(false);
	const optimal = () => optimalPlayPercent(props.stats);
	const deviation = () => evDeviation(props.stats);

	return (
		<div class="play-stats">
			<div class="play-stats__grid">
				<StatCard
					label="AV"
					value={formatEvCurrency(props.stats.av)}
					sign={props.stats.av}
				/>
				<StatCard
					label="EV"
					value={formatEvCurrency(props.stats.ev)}
					sign={props.stats.ev}
				/>
				<StatCard label="Hands played" value={formatRounds(props.stats.hands)} />
				<StatCard
					label="Optimal play"
					value={optimal() === null ? NO_FIGURE : formatPercent(optimal()!)}
				/>
				<StatCard
					label="Basic-strategy errors"
					value={formatRounds(props.stats.basicErrors)}
				/>
				<StatCard
					label="Deviation errors"
					value={formatRounds(props.stats.deviationErrors)}
				/>
				<StatCard
					label="EV lost"
					value={formatEvCurrency(-props.stats.evLost)}
					sign={props.stats.evLost > 0 ? -1 : 0}
				/>
				<StatCard
					label="EV deviation"
					value={deviation() === null ? NO_FIGURE : deviation()!.toFixed(2)}
					unit={deviation() === null ? undefined : 'σ'}
					sign={deviation() ?? undefined}
				/>
			</div>
			<div class="play-stats__reset">
				<Show
					when={confirming()}
					fallback={
						<button
							type="button"
							class="play-stats__reset-button"
							onClick={() => setConfirming(true)}
						>
							Reset stats
						</button>
					}
				>
					<button
						type="button"
						class="play-stats__reset-button is-confirming"
						onClick={() => {
							props.onReset();
							setConfirming(false);
						}}
					>
						Confirm reset?
					</button>
					<button
						type="button"
						class="play-stats__reset-button"
						onClick={() => setConfirming(false)}
					>
						Cancel
					</button>
				</Show>
			</div>
		</div>
	);
};

export default PlayStats;
