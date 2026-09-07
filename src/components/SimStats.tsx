/**
 * What the run paid, beside what the hands it played were worth — and beside
 * what the Bankroll view predicted before a card was dealt. Three readings of one
 * game: a closed-form expectation, a simulated expectation, and one sample of the
 * money. See docs/sim-model.md §Against the bankroll model.
 */

import { Show, type Component } from 'solid-js';

import type { BankrollAnalysis } from '#utils/bankroll';
import {
	formatCurrency,
	formatEvCurrency,
	formatEvPercent,
	formatPercent,
	formatRounds,
} from '#utils/format';
import type { SimResult } from '#utils/sim/result';

import StatBand, { NO_FIGURE, type StatFigure } from '#c/StatBand';

import '#styles/SimStats';

interface SimStatsProps {
	/** The finished run, or `undefined` before the first one. */
	result: SimResult | undefined;
	/** What `bankroll.ts` predicts for the same game, where the app has it. */
	predicted: BankrollAnalysis | undefined;
}

/** Hours, to the tenth the figures beside it are read to. */
function formatHours(hours: number): string {
	return hours >= 100 ? formatRounds(hours) : hours.toFixed(1);
}

const SimStats: Component<SimStatsProps> = (props) => {
	const figures = (): StatFigure[] => {
		const result = props.result;
		if (result === undefined) return [];
		const predicted = props.predicted;
		const deviation = result.evDeviationSigmas;
		const optimal = result.optimalPlayPercent;

		return [
			{ label: 'AV', value: formatCurrency(result.stats.av), sign: result.stats.av },
			{ label: 'EV', value: formatCurrency(result.ev), sign: result.ev },
			{
				label: 'EV deviation',
				value: deviation === null ? NO_FIGURE : deviation.toFixed(2),
				unit: deviation === null ? undefined : 'σ',
				sign: deviation ?? undefined,
				note: 'how far the money ran from the hands',
			},
			{
				label: 'Player edge',
				value: formatEvPercent(result.evEdgePercent),
				unit: '%',
				sign: result.evEdgePercent,
				note:
					predicted === undefined ? undefined : (
						`predicted ${formatEvPercent(predicted.edgePercent)}%`
					),
			},
			{
				label: 'Realised edge',
				value: formatEvPercent(result.edgePercent),
				unit: '%',
				sign: result.edgePercent,
				note: 'what the cards actually paid',
			},
			{ label: 'Hands played', value: formatRounds(result.hands) },
			{
				// What a back-counting strategy actually costs: rounds stood through
				// earning nothing. Zero for a player who sits down and plays them all.
				label: 'Sat out',
				value: formatPercent(result.watchedPercent),
				note: `${formatRounds(result.roundsWatched)} rounds watched, ${formatHours(
					result.hoursWatched
				)} hrs`,
			},
			{
				label: 'Hours',
				value: formatHours(result.hours),
				note: `${formatRounds(result.shoes)} shoes`,
			},
			{
				label: 'Win rate',
				value: formatCurrency(result.winRatePerHour),
				unit: ' /hr',
				sign: result.winRatePerHour,
				note:
					predicted === undefined ? undefined : (
						`predicted ${formatCurrency(predicted.winRatePerHour)}`
					),
			},
			{
				label: 'Average bet',
				value: formatCurrency(result.averageBet).replace('+', ''),
				note:
					predicted === undefined ? undefined : (
						`predicted ${formatCurrency(predicted.averageBetCurrency).replace('+', '')}`
					),
			},
			{
				label: 'Std dev',
				value: formatCurrency(result.sdPerHour).replace('+', ''),
				unit: ' /hr',
			},
			{ label: 'N0', value: formatRounds(result.n0Rounds), unit: ' rounds' },
			{
				label: 'Optimal play',
				value: optimal === null ? NO_FIGURE : formatPercent(optimal),
			},
			{
				label: 'EV lost',
				value: formatEvCurrency(-result.stats.evLost),
				sign: result.stats.evLost > 0 ? -1 : 0,
				note: 'to plays the count priced better',
			},
		];
	};

	return (
		<section class="sim-stats">
			<h2 class="sim-stats__title">The result</h2>
			<Show
				when={props.result}
				fallback={
					<p class="sim-stats__empty">
						No run yet. Set the run up above and deal a session.
					</p>
				}
			>
				<StatBand figures={figures()} />
			</Show>
		</section>
	);
};

export default SimStats;
