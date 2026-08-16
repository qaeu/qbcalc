import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';

import CountEvGraph, { type CountEvProfile } from '#c/CountEvGraph';
import { ROUND_TRUE_COUNTS, simulateRoundFrequency } from '#utils/countRounds';
import { DEFAULT_RULE_SET } from '#utils/ev/rules';
import { tagsForSystem } from '#utils/countingSystems';

const PROFILE: CountEvProfile = {
	rounds: simulateRoundFrequency(
		{ ...DEFAULT_RULE_SET, decks: 6, penetrationPercent: 75 },
		tagsForSystem('hi-lo')!
	),
	// About what six-deck Hi-Lo fits: half a point of house edge, half a point of
	// player edge per true count, and a slight upward bend.
	edge: {
		baseEvPercent: -0.5,
		edgeSlopePointsPerTrueCount: 0.5,
		edgeCurvaturePointsPerTrueCountSquared: 0.006,
	},
	// A 1-12 spread on the Hi-Lo axis the ramp is denominated in, which Hi-Lo's
	// own counts map onto one for one.
	ramp: [1, 1, 2, 4, 8, 12, 12],
	countScale: 1,
	unit: 25,
	decks: 6,
	penetrationPercent: 75,
	systemLabel: 'Hi-Lo',
};

describe('CountEvGraph', () => {
	it('draws one labelled point per bucket, with open ends', () => {
		const { container } = render(() => (
			<CountEvGraph profile={PROFILE} loading={false} seed={0} />
		));

		expect(container.querySelectorAll('.count-ev-graph__band')).toHaveLength(
			ROUND_TRUE_COUNTS.length
		);
		expect(container.querySelectorAll('.count-ev-graph__point')).toHaveLength(
			ROUND_TRUE_COUNTS.length
		);
		const ticks = [...container.querySelectorAll('.count-ev-graph__tick')].map(
			(tick) => tick.textContent
		);
		expect(ticks[0]).toBe('≤-6');
		expect(ticks[ticks.length - 1]).toBe('≥+6');
		expect(ticks).toContain('0');
	});

	it('marks the winning counts, and only those, as the advantage series', () => {
		const { container } = render(() => (
			<CountEvGraph profile={PROFILE} loading={false} seed={0} />
		));

		// The edge above turns positive a little past +1, so the points below that
		// contribute losses and the ones above contribute wins.
		const advantage = [...container.querySelectorAll('.count-ev-graph__point')].map(
			(point) => point.classList.contains('is-advantage')
		);
		expect(advantage[ROUND_TRUE_COUNTS.indexOf(-1)]).toBe(false);
		expect(advantage[ROUND_TRUE_COUNTS.indexOf(0)]).toBe(false);
		expect(advantage[ROUND_TRUE_COUNTS.indexOf(2)]).toBe(true);
		expect(advantage[ROUND_TRUE_COUNTS.indexOf(6)]).toBe(true);
	});

	it('reads out the hovered count, and the shoe again on leaving', () => {
		const { container } = render(() => (
			<CountEvGraph profile={PROFILE} loading={false} seed={0} />
		));

		const reading = container.querySelector('.count-ev-graph__reading')!;
		expect(reading.textContent).toMatch(/^[+-]£\d+\.\d\d per \d+ hand shoe$/);

		const bands = container.querySelectorAll('.count-ev-graph__band');
		// The buckets run from -6, so +2 is the ninth of them.
		fireEvent.mouseEnter(bands[ROUND_TRUE_COUNTS.indexOf(2)]);
		expect(reading.textContent).toMatch(/^\d+(\.\d)? hands @[+-]\d+\.\d+% EV$/);

		fireEvent.mouseLeave(screen.getByRole('img'));
		expect(reading.textContent).toMatch(/^[+-]£\d+\.\d\d per \d+ hand shoe$/);
	});

	const shoeEvUnder = (profile: CountEvProfile) => {
		const { container, unmount } = render(() => (
			<CountEvGraph profile={profile} loading={false} seed={0} />
		));
		const reading = container.querySelector('.count-ev-graph__reading')!.textContent!;
		unmount();
		const [, sign, amount] = reading.match(/([+-])£(\d+\.\d\d) per/)!;
		return Number(`${sign}${amount}`);
	};

	it('follows the spread: a steeper ramp makes more of an average shoe', () => {
		const flat = shoeEvUnder({ ...PROFILE, ramp: [1, 1, 1, 1, 1, 1, 1] });

		// A flat bet collects the house edge (plus the curve's bend); putting the
		// money on the counts that are worth more is the whole of a counter's edge.
		expect(flat).toBeLessThan(0);
		expect(shoeEvUnder(PROFILE)).toBeGreaterThan(flat);
		expect(shoeEvUnder({ ...PROFILE, ramp: [1, 1, 2, 6, 12, 20, 30] })).toBeGreaterThan(
			shoeEvUnder(PROFILE)
		);
	});

	it('scales with the unit, which only prices the line', () => {
		// Doubling what a unit is worth doubles every figure on the drawing and
		// nothing else: the shoe is dealt and priced before the money is applied.
		expect(shoeEvUnder({ ...PROFILE, unit: 50 })).toBeCloseTo(
			2 * shoeEvUnder(PROFILE),
			1
		);
	});

	it('shows a skeleton while it is computing', () => {
		const { container } = render(() => (
			<CountEvGraph profile={PROFILE} loading={true} seed={0} />
		));

		expect(container.querySelector('.count-ev-graph__skeleton')).toBeTruthy();
		expect(container.querySelector('.count-ev-graph__plot')).toBeNull();
	});

	it('shows a skeleton before there is a shoe to draw', () => {
		const { container } = render(() => (
			<CountEvGraph profile={undefined} loading={false} seed={0} />
		));

		expect(container.querySelector('.count-ev-graph__skeleton')).toBeTruthy();
	});
});
