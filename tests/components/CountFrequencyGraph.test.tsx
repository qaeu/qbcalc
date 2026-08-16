import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';

import CountFrequencyGraph, { type CountFrequencyProfile } from '#c/CountFrequencyGraph';
import { ROUND_TRUE_COUNTS, simulateRoundFrequency } from '#utils/countRounds';
import { DEFAULT_RULE_SET } from '#utils/ev/rules';
import { tagsForSystem } from '#utils/countingSystems';

const PROFILE: CountFrequencyProfile = {
	rounds: simulateRoundFrequency(
		{ ...DEFAULT_RULE_SET, decks: 6, penetrationPercent: 75 },
		tagsForSystem('hi-lo')!
	),
	decks: 6,
	penetrationPercent: 75,
	systemLabel: 'Hi-Lo',
};

describe('CountFrequencyGraph', () => {
	it('draws one labelled column per bucket, with open ends', () => {
		const { container } = render(() => (
			<CountFrequencyGraph profile={PROFILE} loading={false} seed={0} />
		));

		expect(container.querySelectorAll('.count-frequency-graph__band')).toHaveLength(
			ROUND_TRUE_COUNTS.length
		);
		const ticks = [...container.querySelectorAll('.count-frequency-graph__tick')].map(
			(tick) => tick.textContent
		);
		expect(ticks[0]).toBe('≤-6');
		expect(ticks[ticks.length - 1]).toBe('≥+6');
		expect(ticks).toContain('0');
		expect(screen.getByText('6 decks · 75% penetration · Hi-Lo')).toBeTruthy();
	});

	it('reads out the hovered column, and the shoe again on leaving', () => {
		const { container } = render(() => (
			<CountFrequencyGraph profile={PROFILE} loading={false} seed={0} />
		));

		const reading = container.querySelector('.count-frequency-graph__reading')!;
		expect(reading.textContent).toMatch(/A shoe deals about \d+ rounds/);

		const bands = container.querySelectorAll('.count-frequency-graph__band');
		// The buckets run from -6, so +2 is the ninth of them.
		fireEvent.mouseEnter(bands[ROUND_TRUE_COUNTS.indexOf(2)]);
		expect(reading.textContent).toMatch(/% of rounds are played at \+2 -- about /);

		fireEvent.mouseLeave(screen.getByRole('img'));
		expect(reading.textContent).toMatch(/A shoe deals about \d+ rounds/);
	});

	it('shows a skeleton while it is computing', () => {
		const { container } = render(() => (
			<CountFrequencyGraph profile={PROFILE} loading={true} seed={0} />
		));

		expect(container.querySelector('.count-frequency-graph__skeleton')).toBeTruthy();
		expect(container.querySelector('.count-frequency-graph__plot')).toBeNull();
	});

	it('shows a skeleton before there is a shoe to draw', () => {
		const { container } = render(() => (
			<CountFrequencyGraph profile={undefined} loading={false} seed={0} />
		));

		expect(container.querySelector('.count-frequency-graph__skeleton')).toBeTruthy();
	});
});
