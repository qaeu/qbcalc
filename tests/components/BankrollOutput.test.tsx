import { describe, it, expect } from 'vitest';
import { render } from '@solidjs/testing-library';

import type { CountEvProfile } from '#c/CountEvGraph';
import BankrollOutput from '#c/BankrollOutput';
import { analyzeBankroll, hiLoCountScale, type BankrollAnalysis } from '#utils/bankroll';
import { simulateRoundFrequency } from '#utils/countRounds';
import { baseComposition, DEFAULT_PARAMS } from '#utils/ev/composition';
import { DEFAULT_RULE_SET } from '#utils/ev/rules';
import { DEFAULT_BANKROLL_CONFIG } from '#utils/storage';
import { computeAllEvTables } from '#utils/ev/tables';
import { formatEvPercent } from '#utils/format';
import type { EvWorkerResult } from '#utils/evWorkerProtocol';

// Real (not mocked) exact-enumeration result, computed once and reused as a
// fixture -- deterministic, and keeps these tests independent of the worker.
const EDGE_SLOPE = 0.7;
const EDGE_CURVATURE = 0.005;

const SAMPLE_RESULT: EvWorkerResult = {
	...computeAllEvTables(DEFAULT_RULE_SET, 1),
	edgeSlopePointsPerTrueCount: EDGE_SLOPE,
	edgeCurvaturePointsPerTrueCountSquared: EDGE_CURVATURE,
};

// A real analysis of the default spread against the same rules, so the summary
// cards are exercised with figures that actually agree with each other.
const SAMPLE_BANKROLL: BankrollAnalysis = analyzeBankroll(
	DEFAULT_RULE_SET,
	DEFAULT_PARAMS.tags,
	{
		...DEFAULT_BANKROLL_CONFIG,
		baseEvPercent: SAMPLE_RESULT.average.baseEvPercent,
		edgeSlopePointsPerTrueCount: EDGE_SLOPE,
		edgeCurvaturePointsPerTrueCountSquared: EDGE_CURVATURE,
		variancePerRound: SAMPLE_RESULT.average.variancePerRound,
	}
);

// What the weighted-EV graph draws, on the same rules and the same edge curve
// as the summary cards above it.
const SAMPLE_COUNT_EV: CountEvProfile = {
	rounds: simulateRoundFrequency(DEFAULT_RULE_SET, DEFAULT_PARAMS.tags),
	edge: {
		baseEvPercent: SAMPLE_RESULT.average.baseEvPercent,
		edgeSlopePointsPerTrueCount: EDGE_SLOPE,
		edgeCurvaturePointsPerTrueCountSquared: EDGE_CURVATURE,
	},
	ramp: DEFAULT_BANKROLL_CONFIG.ramp,
	countScale: hiLoCountScale(baseComposition(DEFAULT_RULE_SET), DEFAULT_PARAMS.tags),
	unit: DEFAULT_BANKROLL_CONFIG.unit,
	decks: DEFAULT_RULE_SET.decks,
	penetrationPercent: DEFAULT_RULE_SET.penetrationPercent,
	systemLabel: 'Ace-Five',
};

describe('BankrollOutput', () => {
	it('heads the view with the shoe-wide edge', () => {
		render(() => (
			<BankrollOutput
				error={() => null}
				isSummaryComputing={() => false}
				bankroll={() => SAMPLE_BANKROLL}
				countEv={() => SAMPLE_COUNT_EV}
			/>
		));

		const cards = document.querySelectorAll('.ev-summary__card');
		expect(cards).toHaveLength(6);

		// The edge over the whole shoe under the bet spread, not the EV at the
		// count on screen -- the Tables view already answers that question.
		expect(cards[0].textContent).toContain('Player Edge');
		expect(cards[0].querySelector('.ev-summary__value')?.textContent).toBe(
			`${formatEvPercent(SAMPLE_BANKROLL.edgePercent)}%`
		);
		expect(cards[0].textContent).not.toContain(
			formatEvPercent(SAMPLE_RESULT.average.countEvPercent)
		);
	});

	it('leaves the edge card empty until there is a bankroll analysis', () => {
		render(() => (
			<BankrollOutput
				error={() => null}
				isSummaryComputing={() => false}
				bankroll={() => undefined}
				countEv={() => SAMPLE_COUNT_EV}
			/>
		));

		// Every card is derived from the bankroll analysis, so without one there
		// is nothing to show anywhere along the row.
		const cards = document.querySelectorAll('.ev-summary__card');
		expect(cards[0].textContent).toContain('Player Edge');
		for (const card of cards) expect(card.querySelector('.ev-summary__value')).toBeNull();
	});

	it('shows a skeleton in place of the average while the summary is computing', () => {
		render(() => (
			<BankrollOutput
				error={() => null}
				isSummaryComputing={() => true}
				bankroll={() => undefined}
				countEv={() => SAMPLE_COUNT_EV}
			/>
		));

		// The previous result is still in hand, so the figure has to be withheld
		// deliberately rather than merely being absent.
		expect(document.querySelectorAll('.ev-summary__skeleton')).toHaveLength(6);
		expect(document.querySelectorAll('.ev-summary__value')).toHaveLength(0);
	});

	it('shows the summary figures once the summary has finished computing', () => {
		render(() => (
			<BankrollOutput
				error={() => null}
				isSummaryComputing={() => false}
				bankroll={() => SAMPLE_BANKROLL}
				countEv={() => SAMPLE_COUNT_EV}
			/>
		));

		expect(document.querySelectorAll('.ev-summary__skeleton')).toHaveLength(0);
		expect(document.querySelectorAll('.ev-summary__value')).toHaveLength(6);
	});

	it('shows an error instead of the summary when given an error', () => {
		render(() => (
			<BankrollOutput
				error={() => 'Count too extreme for this shoe'}
				isSummaryComputing={() => false}
				bankroll={() => undefined}
				countEv={() => SAMPLE_COUNT_EV}
			/>
		));

		expect(document.querySelector('.bankroll-output__error')?.textContent).toContain(
			'too extreme'
		);
		expect(document.querySelectorAll('.ev-summary__card')).toHaveLength(0);
	});
});
