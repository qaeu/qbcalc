import { Show, type Component } from 'solid-js';

import type { AverageEvAnalysis } from '#utils/ev/tables';
import { formatCount, formatEvPercent } from '#utils/format';
import { signClass } from '#utils/actionStyle';

import '#styles/EvSummary';

interface SummaryCardProps {
	label: string;
	/** Signed figure to show, or `undefined` while there isn't one yet. */
	value: number | undefined;
	/** Unit the figure is in, e.g. a percentage or percentage points. */
	unit: string;
	loading: boolean;
}

const SummaryCard: Component<SummaryCardProps> = (props) => (
	<div class="ev-summary__card">
		<span class="ev-summary__label">{props.label}</span>
		<Show
			when={!props.loading && props.value !== undefined}
			fallback={<span class="ev-summary__skeleton" aria-hidden="true" />}
		>
			<span class={`ev-summary__value ${signClass(props.value!) ?? ''}`}>
				{formatEvPercent(props.value!)}
				<span class="ev-summary__unit">{props.unit}</span>
			</span>
		</Show>
	</div>
);

interface EvSummaryProps {
	average: AverageEvAnalysis | undefined;
	loading: boolean;
	count: number;
}

/**
 * The three grids in one figure: what a round is worth on average over every
 * hand the shoe can deal. The delta card only appears at a count that moves the
 * shoe -- at a neutral one it would read zero on every recalculation.
 */
const EvSummary: Component<EvSummaryProps> = (props) => (
	<div class="ev-summary">
		<SummaryCard
			label="Player Edge"
			value={props.average?.countEvPercent}
			unit="%"
			loading={props.loading}
		/>
		<Show when={props.count !== 0}>
			<SummaryCard
				label={`${formatCount(props.count)} EVΔ`}
				value={props.average?.deltaPercentPoints}
				unit=" pts"
				loading={props.loading}
			/>
		</Show>
	</div>
);

export default EvSummary;
