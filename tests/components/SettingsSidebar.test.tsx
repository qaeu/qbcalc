import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@solidjs/testing-library';

import SettingsSidebar from '#c/SettingsSidebar';
import { DEFAULT_PARAMS, type CalculatorParams } from '#utils/blackjackEv';
import { loadCalculatorConfig } from '#utils/storage';

describe('SettingsSidebar', () => {
	it('renders the current settings and calls onSubmit with the entered values', () => {
		const onSubmit = vi.fn();
		render(() => (
			<SettingsSidebar
				initialParams={DEFAULT_PARAMS}
				calcTimeMs={null}
				onSubmit={onSubmit}
			/>
		));

		const decksInput = screen.getByLabelText('Decks');
		fireEvent.input(decksInput, { target: { value: '6' } });
		const countInput = screen.getByLabelText('Ace-Five count');
		fireEvent.input(countInput, { target: { value: '-2' } });
		const checkbox = screen.getByLabelText('S17') as HTMLInputElement;
		fireEvent.click(checkbox);
		fireEvent.submit(decksInput.closest('form')!);

		expect(onSubmit).toHaveBeenCalledWith({
			decks: 6,
			count: -2,
			dealerHitsSoft17: false,
		} satisfies CalculatorParams);
	});

	it('persists the submitted config to localStorage', () => {
		const onSubmit = vi.fn();
		render(() => (
			<SettingsSidebar
				initialParams={DEFAULT_PARAMS}
				calcTimeMs={null}
				onSubmit={onSubmit}
			/>
		));

		const decksInput = screen.getByLabelText('Decks');
		fireEvent.input(decksInput, { target: { value: '6' } });
		fireEvent.submit(decksInput.closest('form')!);

		expect(loadCalculatorConfig()).toEqual({
			decks: 6,
			count: DEFAULT_PARAMS.count,
			dealerHitsSoft17: DEFAULT_PARAMS.dealerHitsSoft17,
		});
	});

	it('restores previously submitted values from the given initialParams', () => {
		cleanup();
		render(() => (
			<SettingsSidebar
				initialParams={{ decks: 6, count: -2, dealerHitsSoft17: false }}
				calcTimeMs={null}
				onSubmit={vi.fn()}
			/>
		));

		expect((screen.getByLabelText('Decks') as HTMLInputElement).value).toBe('6');
		expect((screen.getByLabelText('Ace-Five count') as HTMLInputElement).value).toBe(
			'-2'
		);
		expect((screen.getByLabelText('S17') as HTMLInputElement).checked).toBe(true);
	});

	it('shows the calculation duration when calcTimeMs is provided', () => {
		render(() => (
			<SettingsSidebar
				initialParams={DEFAULT_PARAMS}
				calcTimeMs={1234}
				onSubmit={vi.fn()}
			/>
		));

		expect(screen.getByText(/\(took 1\.2s\)/)).toBeDefined();
	});
});
