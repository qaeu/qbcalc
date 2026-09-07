import { describe, it, expect } from 'vitest';
import { render, screen } from '@solidjs/testing-library';

import type { BankrollAnalysis } from '#utils/bankroll';
import { ROUND_TRUE_COUNTS } from '#utils/countRounds';
import { DEFAULT_SIM_CONFIG } from '#utils/sim/config';
import type { SimResult } from '#utils/sim/result';
import { EMPTY_PLAY_STATS } from '#utils/play/stats';

import SimStats from '#c/SimStats';

/** A finished run, with every figure distinguishable from every other. */
const RESULT: SimResult = {
	stats: {
		...EMPTY_PLAY_STATS,
		av: 1250,
		hands: 51_200,
		rounds: 50_000,
		decisions: 70_000,
		optimalDecisions: 68_600,
		basicErrors: 900,
		deviationErrors: 500,
		evLost: 84,
		variance: 5_000_000,
	},
	ev: 980,
	variance: 4_000_000,
	buckets: ROUND_TRUE_COUNTS.map((trueCount) => ({
		trueCount,
		rounds: 0,
		roundsPlayed: 0,
		hands: 0,
		wagered: 0,
		av: 0,
		ev: 0,
	})),
	samples: [],
	config: DEFAULT_SIM_CONFIG,
	roundsSeen: 62_500,
	roundsPlayed: 50_000,
	roundsWatched: 12_500,
	watchedPercent: 20,
	hoursWatched: 156.25,
	hands: 51_200,
	shoes: 1_160,
	wagered: 200_000,
	edgePercent: 0.625,
	evEdgePercent: 0.49,
	averageBet: 40,
	hours: 625,
	winRatePerHour: 2,
	sdPerHour: 80,
	n0Rounds: 26_400,
	evDeviationSigmas: 0.135,
	optimalPlayPercent: 98,
};

const PREDICTED = {
	edgePercent: 0.578,
	winRatePerHour: 2.4,
	averageBetCurrency: 40.91,
} as BankrollAnalysis;

/** The card whose label this is, as the text beside it. */
function figure(label: string): string {
	const card = screen.getByText(label).parentElement;
	if (card === null) throw new Error(`no card for ${label}`);
	return card.textContent?.replace(label, '') ?? '';
}

describe('SimStats', () => {
	it('says there is nothing to show before the first run', () => {
		render(() => <SimStats result={undefined} predicted={undefined} />);
		expect(screen.getByText(/No run yet/)).toBeDefined();
		expect(screen.queryByText('AV')).toBeNull();
	});

	it('renders the run’s own figures', () => {
		render(() => <SimStats result={RESULT} predicted={undefined} />);

		expect(figure('AV')).toContain('£1,250');
		expect(figure('EV')).toContain('£980');
		expect(figure('EV deviation')).toContain('0.14');
		expect(figure('Player edge')).toContain('+0.490');
		expect(figure('Realised edge')).toContain('+0.625');
		expect(figure('Hands played')).toContain('51k');
		// A fifth of the session was stood through rather than played.
		expect(figure('Sat out')).toContain('20.0%');
		expect(figure('Sat out')).toContain('13k rounds watched');
		// Past a hundred, hours are rounded like any other count of rounds.
		expect(figure('Sat out')).toContain('156 hrs');
		expect(figure('Average bet')).toContain('£40');
		expect(figure('N0')).toContain('26k');
		expect(figure('Optimal play')).toContain('98.0%');
		expect(figure('EV lost')).toContain('£84');
	});

	it('sets the bankroll view’s prediction beside the figure it belongs to', () => {
		render(() => <SimStats result={RESULT} predicted={PREDICTED} />);

		expect(figure('Player edge')).toContain('predicted +0.578');
		expect(figure('Win rate')).toContain('predicted +£2');
		expect(figure('Average bet')).toContain('predicted £41');
	});

	it('leaves the predictions out when there is no analysis to quote', () => {
		render(() => <SimStats result={RESULT} predicted={undefined} />);
		expect(screen.queryByText(/predicted/)).toBeNull();
	});

	it('suppresses the figures nothing supports yet', () => {
		render(() => (
			<SimStats
				result={{ ...RESULT, evDeviationSigmas: null, optimalPlayPercent: null }}
				predicted={undefined}
			/>
		));
		expect(figure('EV deviation')).toContain('—');
		expect(figure('Optimal play')).toContain('—');
	});
});
