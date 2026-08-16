import { Show, type Component } from 'solid-js';

import type { BankrollAnalysis } from '#utils/bankroll';
import {
	formatCurrency,
	formatEvPercent,
	formatProbabilityPercent,
	formatRounds,
} from '#utils/format';
import { signClass } from '#utils/actionStyle';
import { loadingPhase } from '#utils/loadingPhase';

import '#styles/EvSummary';

interface SummaryCardProps {
	label: string;
	/**
	 * The figure to show, already formatted, or `undefined` while there isn't
	 * one yet. Formatted by the caller because the cards no longer share a unit:
	 * percentages, money and round counts each read differently.
	 */
	value: string | undefined;
	/** Unit the figure is in, e.g. a percentage or percentage points. */
	unit?: string;
	/**
	 * The figure the +/- colouring keys off, where the sign carries meaning.
	 * Omitted for figures that are always positive, like a standard deviation.
	 */
	sign?: number;
	loading: boolean;
	/** Where this card's skeleton starts in the pulse cycle, as with the table cells. */
	phase: number;
}

const SummaryCard: Component<SummaryCardProps> = (props) => (
	<div class="ev-summary__card">
		<span class="ev-summary__label">{props.label}</span>
		<Show
			when={!props.loading && props.value !== undefined}
			fallback={
				<span
					class={`ev-summary__skeleton ev-summary__loading-phase-${props.phase}`}
					aria-hidden="true"
				/>
			}
		>
			<span
				class={`ev-summary__value ${
					props.sign === undefined ? '' : (signClass(props.sign) ?? '')
				}`}
			>
				{props.value}
				<Show when={props.unit}>
					<span class="ev-summary__unit">{props.unit}</span>
				</Show>
			</span>
		</Show>
	</div>
);

interface EvSummaryProps {
	bankroll: BankrollAnalysis | undefined;
	loading: boolean;
	/** Scatters the cards' skeletons across the pulse cycle, as with the table cells. */
	seed: number;
}

/**
 * What the game is worth to the player, above the grids that say what each spot
 * is worth. Player Edge is the whole shoe averaged under the bet spread and the
 * penetration -- not the edge at the count on screen, which is what the cells
 * already show.
 *
 * Every card is derived from the result rather than computed from one, so they
 * all follow a spread edit without a recalculation.
 */
const EvSummary: Component<EvSummaryProps> = (props) => (
	<div class="ev-summary">
		<SummaryCard
			label="Player Edge"
			value={
				props.bankroll === undefined ?
					undefined
				:	formatEvPercent(props.bankroll.edgePercent)
			}
			unit="%"
			sign={props.bankroll?.edgePercent}
			loading={props.loading}
			phase={loadingPhase(props.seed, 0, 0)}
		/>
		<SummaryCard
			label="Win Rate"
			value={
				props.bankroll === undefined ?
					undefined
				:	formatCurrency(props.bankroll.winRatePerHour)
			}
			unit=" /hr"
			sign={props.bankroll?.winRatePerHour}
			loading={props.loading}
			phase={loadingPhase(props.seed, 0, 1)}
		/>
		<SummaryCard
			label="Average Bet"
			value={
				props.bankroll === undefined ?
					undefined
				:	formatCurrency(props.bankroll.averageBetCurrency).replace('+', '')
			}
			loading={props.loading}
			phase={loadingPhase(props.seed, 0, 2)}
		/>
		<SummaryCard
			label="Std Dev"
			value={
				props.bankroll === undefined ?
					undefined
				:	formatCurrency(props.bankroll.sdPerHour).replace('+', '')
			}
			unit=" /hr"
			loading={props.loading}
			phase={loadingPhase(props.seed, 0, 3)}
		/>
		<SummaryCard
			label="N0"
			value={
				props.bankroll === undefined ? undefined : formatRounds(props.bankroll.n0Rounds)
			}
			unit=" rounds"
			loading={props.loading}
			phase={loadingPhase(props.seed, 0, 4)}
		/>
		<SummaryCard
			label="Risk of Ruin"
			value={
				props.bankroll === undefined ?
					undefined
				:	formatProbabilityPercent(props.bankroll.riskOfRuin)
			}
			loading={props.loading}
			phase={loadingPhase(props.seed, 0, 5)}
		/>
	</div>
);

export default EvSummary;
