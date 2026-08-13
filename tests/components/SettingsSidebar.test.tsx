import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, cleanup, waitFor } from '@solidjs/testing-library';

import SettingsSidebar from '#c/SettingsSidebar';
import { ACE_FIVE_TAGS } from '#utils/blackjackEv';
import {
	DEFAULT_CONFIG,
	loadCalculatorConfig,
	type CalculatorConfig,
} from '#utils/storage';

describe('SettingsSidebar', () => {
	it('renders the current settings and calls onSubmit with the entered values', () => {
		const onSubmit = vi.fn();
		render(() => (
			<SettingsSidebar
				initialConfig={DEFAULT_CONFIG}
				calcTimeMs={null}
				onSubmit={onSubmit}
			/>
		));

		const decksInput = screen.getByLabelText('Decks');
		fireEvent.input(decksInput, { target: { value: '6' } });
		const countInput = screen.getByLabelText('Running count');
		fireEvent.input(countInput, { target: { value: '-2' } });
		const checkbox = screen.getByLabelText('S17') as HTMLInputElement;
		fireEvent.click(checkbox);
		fireEvent.submit(decksInput.closest('form')!);

		expect(onSubmit).toHaveBeenCalledWith({
			decks: 6,
			count: -2,
			dealerHitsSoft17: false,
			system: 'ace-five',
			tags: ACE_FIVE_TAGS,
		} satisfies CalculatorConfig);
	});

	it('persists the submitted config to localStorage', () => {
		const onSubmit = vi.fn();
		render(() => (
			<SettingsSidebar
				initialConfig={DEFAULT_CONFIG}
				calcTimeMs={null}
				onSubmit={onSubmit}
			/>
		));

		const decksInput = screen.getByLabelText('Decks');
		fireEvent.input(decksInput, { target: { value: '6' } });
		fireEvent.submit(decksInput.closest('form')!);

		expect(loadCalculatorConfig()).toEqual({
			...DEFAULT_CONFIG,
			decks: 6,
		});
	});

	it('restores previously submitted values from the given initialConfig', () => {
		cleanup();
		render(() => (
			<SettingsSidebar
				initialConfig={{
					decks: 6,
					count: -2,
					dealerHitsSoft17: false,
					system: 'ace-five',
					tags: ACE_FIVE_TAGS,
				}}
				calcTimeMs={null}
				onSubmit={vi.fn()}
			/>
		));

		expect((screen.getByLabelText('Decks') as HTMLInputElement).value).toBe('6');
		expect((screen.getByLabelText('Running count') as HTMLInputElement).value).toBe('-2');
		expect((screen.getByLabelText('S17') as HTMLInputElement).checked).toBe(true);
	});

	it('shows only the selected tab‘s settings', async () => {
		render(() => (
			<SettingsSidebar
				initialConfig={DEFAULT_CONFIG}
				calcTimeMs={null}
				onSubmit={vi.fn()}
			/>
		));

		// Unselected panels stay mounted but hidden, so assert on the panel
		// each tab controls rather than on its contents being queryable.
		const panelOf = (tabValue: string) =>
			document.querySelector(`[id$="content-${tabValue}"]`)!;

		expect(panelOf('rules').hasAttribute('hidden')).toBe(false);
		expect(panelOf('count').hasAttribute('hidden')).toBe(true);

		fireEvent.click(screen.getByRole('tab', { name: 'Count' }));

		await waitFor(() => {
			expect(panelOf('count').hasAttribute('hidden')).toBe(false);
			expect(panelOf('rules').hasAttribute('hidden')).toBe(true);
		});
	});

	it('shows the tag values of the initial counting system', () => {
		render(() => (
			<SettingsSidebar
				initialConfig={DEFAULT_CONFIG}
				calcTimeMs={null}
				onSubmit={vi.fn()}
			/>
		));

		expect((screen.getByLabelText('Tag value for 5') as HTMLInputElement).value).toBe(
			'1'
		);
		expect((screen.getByLabelText('Tag value for A') as HTMLInputElement).value).toBe(
			'-1'
		);
		expect((screen.getByLabelText('Tag value for 10') as HTMLInputElement).value).toBe(
			'0'
		);
	});

	it('switches the system to Custom when a tag value is edited and submits it', async () => {
		const onSubmit = vi.fn();
		render(() => (
			<SettingsSidebar
				initialConfig={DEFAULT_CONFIG}
				calcTimeMs={null}
				onSubmit={onSubmit}
			/>
		));

		const tenTag = screen.getByLabelText('Tag value for 10');
		fireEvent.input(tenTag, { target: { value: '-1' } });
		fireEvent.submit(tenTag.closest('form')!);

		expect(onSubmit).toHaveBeenCalledWith({
			...DEFAULT_CONFIG,
			system: 'custom',
			tags: { ...ACE_FIVE_TAGS, T: -1 },
		} satisfies CalculatorConfig);

		fireEvent.click(screen.getByRole('tab', { name: 'Count' }));
		const trigger = await screen.findByRole('combobox', { name: 'System' });
		expect(trigger.textContent).toBe('Custom');
	});

	it('repopulates the tag grid when a preset is selected', async () => {
		cleanup();
		render(() => (
			<SettingsSidebar
				initialConfig={{
					...DEFAULT_CONFIG,
					system: 'custom',
					tags: { ...ACE_FIVE_TAGS, T: -1 },
				}}
				calcTimeMs={null}
				onSubmit={vi.fn()}
			/>
		));

		expect((screen.getByLabelText('Tag value for 10') as HTMLInputElement).value).toBe(
			'-1'
		);

		// The counting system lives on the Count tab, whose panel is hidden
		// (and so invisible to role queries) until the tab is selected.
		fireEvent.click(screen.getByRole('tab', { name: 'Count' }));
		fireEvent.click(await screen.findByRole('combobox', { name: 'System' }));
		fireEvent.click(await screen.findByRole('option', { name: 'Ace-Five' }));

		await waitFor(() =>
			expect((screen.getByLabelText('Tag value for 10') as HTMLInputElement).value).toBe(
				'0'
			)
		);
	});

	it('shows the calculation duration when calcTimeMs is provided', () => {
		render(() => (
			<SettingsSidebar
				initialConfig={DEFAULT_CONFIG}
				calcTimeMs={1234}
				onSubmit={vi.fn()}
			/>
		));

		expect(screen.getByText(/\(took 1\.2s\)/)).toBeDefined();
	});
});
