import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@solidjs/testing-library';

import { DEFAULT_SIM_CONFIG } from '#utils/sim/config';

import SimConfigPanel from '#c/SimConfigPanel';

function renderPanel(props: Partial<Parameters<typeof SimConfigPanel>[0]> = {}) {
	const onChange = vi.fn();
	const onRun = vi.fn();
	const onCancel = vi.fn();
	render(() => (
		<SimConfigPanel
			config={DEFAULT_SIM_CONFIG}
			onChange={onChange}
			running={false}
			progress={undefined}
			onRun={onRun}
			onCancel={onCancel}
			{...props}
		/>
	));
	return { onChange, onRun, onCancel };
}

describe('SimConfigPanel', () => {
	it('labels every setting a run is made of', () => {
		renderPanel();
		for (const label of [
			'Rounds',
			'Deviations',
			'Cut card variance',
			'Wong in',
			'Wong out',
			'Other players',
			'Seed',
			'New seed each run',
		]) {
			expect(screen.getByText(label)).toBeDefined();
		}
	});

	it('offers a run button while nothing is running', () => {
		const { onRun } = renderPanel();
		fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }));
		expect(onRun).toHaveBeenCalledOnce();
		expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
	});

	it('swaps the run button for a cancel while one is', () => {
		const { onCancel } = renderPanel({ running: true });
		expect(screen.queryByRole('button', { name: 'Run simulation' })).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(onCancel).toHaveBeenCalledOnce();
	});

	it('reads as ready before a run and names the phase during one', () => {
		renderPanel();
		expect(screen.getByText('Ready')).toBeDefined();

		render(() => (
			<SimConfigPanel
				config={DEFAULT_SIM_CONFIG}
				onChange={() => {}}
				running={true}
				progress={{ phase: 'pricing', roundsDealt: 0, rounds: 50_000 }}
				onRun={() => {}}
				onCancel={() => {}}
			/>
		));
		expect(screen.getByText('Pricing the counts…')).toBeDefined();
	});

	it('counts the rounds out as they are dealt', () => {
		renderPanel({
			running: true,
			progress: { phase: 'dealing', roundsDealt: 12_500, rounds: 50_000 },
		});
		expect(screen.getByText('13k of 50k rounds')).toBeDefined();
		// A quarter of the way through, which is what the bar has to say too.
		const bar = screen.getByRole('progressbar');
		expect(bar.getAttribute('aria-valuenow')).toBe('25');
	});

	it('holds the bar at zero before a run has begun', () => {
		renderPanel();
		expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
	});

	it('reports a typed seed back to the caller', () => {
		const { onChange } = renderPanel();
		const seed = screen.getByLabelText('Seed') as HTMLInputElement;
		fireEvent.change(seed, { target: { value: '4242' } });
		expect(onChange).toHaveBeenCalledWith('seed', 4242);
	});

	it('toggles re-seeding', () => {
		const { onChange } = renderPanel();
		fireEvent.click(screen.getByLabelText('New seed each run'));
		expect(onChange).toHaveBeenCalledWith(
			'reseedEachRun',
			!DEFAULT_SIM_CONFIG.reseedEachRun
		);
	});
});
