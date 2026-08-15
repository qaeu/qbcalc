import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, cleanup, waitFor } from '@solidjs/testing-library';

import SettingsSidebar from '#c/SettingsSidebar';
import { ACE_FIVE_TAGS } from '#utils/ev/composition';
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
			...DEFAULT_CONFIG,
			decks: 6,
			count: -2,
			dealerHitsSoft17: true,
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

		// Eight decks, not the default six: Calculate stays disabled -- and the
		// form unsubmittable -- until something actually differs.
		const decksInput = screen.getByLabelText('Decks');
		fireEvent.input(decksInput, { target: { value: '8' } });
		fireEvent.submit(decksInput.closest('form')!);

		expect(loadCalculatorConfig()).toEqual({
			...DEFAULT_CONFIG,
			decks: 8,
		});
	});

	it('restores previously submitted values from the given initialConfig', () => {
		cleanup();
		render(() => (
			<SettingsSidebar
				initialConfig={{
					...DEFAULT_CONFIG,
					decks: 6,
					count: -2,
					dealerHitsSoft17: false,
				}}
				calcTimeMs={null}
				onSubmit={vi.fn()}
			/>
		));

		expect((screen.getByLabelText('Decks') as HTMLInputElement).value).toBe('6');
		expect((screen.getByLabelText('Running count') as HTMLInputElement).value).toBe('-2');
		expect((screen.getByLabelText('S17') as HTMLInputElement).checked).toBe(true);
	});

	it('submits the game rules entered on the Rules tab', async () => {
		const onSubmit = vi.fn();
		render(() => (
			<SettingsSidebar
				initialConfig={DEFAULT_CONFIG}
				calcTimeMs={null}
				onSubmit={onSubmit}
			/>
		));

		fireEvent.input(screen.getByLabelText('Penetration %'), { target: { value: '60' } });
		fireEvent.input(screen.getByLabelText('Split limit'), { target: { value: '2' } });
		fireEvent.click(screen.getByLabelText('DAS'));
		fireEvent.click(screen.getByLabelText('RSA'));
		fireEvent.click(screen.getByLabelText('ENHC'));

		const payoutTrigger = screen.getByRole('combobox', { name: 'BJ payout' });
		fireEvent.click(payoutTrigger);
		fireEvent.click(await screen.findByRole('option', { name: '6:5' }));
		await waitFor(() => expect(payoutTrigger.textContent).toBe('6:5'));

		const surrenderTrigger = screen.getByRole('combobox', { name: 'Surrender' });
		fireEvent.click(surrenderTrigger);
		fireEvent.click(await screen.findByRole('option', { name: 'Late' }));
		await waitFor(() => expect(surrenderTrigger.textContent).toBe('Late'));

		fireEvent.submit(screen.getByLabelText('Decks').closest('form')!);

		expect(onSubmit).toHaveBeenCalledWith({
			...DEFAULT_CONFIG,
			penetrationPercent: 60,
			splitLimit: 2,
			doubleAfterSplit: false,
			resplitAces: true,
			dealerPeek: true,
			blackjackPayout: '6:5',
			surrender: 'late',
		} satisfies CalculatorConfig);
	});

	it('does not offer late surrender while ENHC is on', async () => {
		cleanup();
		render(() => (
			<SettingsSidebar
				initialConfig={DEFAULT_CONFIG}
				calcTimeMs={null}
				onSubmit={vi.fn()}
			/>
		));

		// A no-hole-card table has no dealer check to be late to. ES10 stays
		// available: it is offered against a ten only and taken before any
		// check, so it is early wherever it appears.
		expect((screen.getByLabelText('ENHC') as HTMLInputElement).checked).toBe(true);
		fireEvent.click(screen.getByRole('combobox', { name: 'Surrender' }));
		expect(
			(await screen.findByRole('option', { name: 'Late' })).hasAttribute('data-disabled')
		).toBe(true);
		for (const name of ['Early', 'ES10', 'None']) {
			const option = await screen.findByRole('option', { name });
			expect(option.hasAttribute('data-disabled')).toBe(false);
		}
	});

	it('moves a late-surrender table to early surrender when ENHC is turned on', async () => {
		cleanup();
		const onSubmit = vi.fn();
		render(() => (
			<SettingsSidebar
				initialConfig={{ ...DEFAULT_CONFIG, dealerPeek: true, surrender: 'late' }}
				calcTimeMs={null}
				onSubmit={onSubmit}
			/>
		));

		const trigger = screen.getByRole('combobox', { name: 'Surrender' });
		expect(trigger.textContent).toBe('Late');

		fireEvent.click(screen.getByLabelText('ENHC'));
		await waitFor(() => expect(trigger.textContent).toBe('Early'));

		fireEvent.submit(screen.getByLabelText('Decks').closest('form')!);
		expect(onSubmit).toHaveBeenCalledWith(
			expect.objectContaining({ dealerPeek: false, surrender: 'early' })
		);
	});

	it('submits the hit-split-aces rule', () => {
		cleanup();
		const onSubmit = vi.fn();
		render(() => (
			<SettingsSidebar
				initialConfig={DEFAULT_CONFIG}
				calcTimeMs={null}
				onSubmit={onSubmit}
			/>
		));

		// Read against the default rather than a literal, so the case keeps
		// testing the toggle rather than whichever way the default points.
		const hsa = screen.getByLabelText('HSA') as HTMLInputElement;
		expect(hsa.checked).toBe(DEFAULT_CONFIG.hitSplitAces);
		fireEvent.click(hsa);
		fireEvent.submit(screen.getByLabelText('Decks').closest('form')!);

		expect(onSubmit).toHaveBeenCalledWith(
			expect.objectContaining({ hitSplitAces: !DEFAULT_CONFIG.hitSplitAces })
		);
	});

	it('submits the insurance rule', () => {
		cleanup();
		const onSubmit = vi.fn();
		render(() => (
			<SettingsSidebar
				initialConfig={DEFAULT_CONFIG}
				calcTimeMs={null}
				onSubmit={onSubmit}
			/>
		));

		const insurance = screen.getByLabelText('INS') as HTMLInputElement;
		expect(insurance.checked).toBe(DEFAULT_CONFIG.insurance);
		fireEvent.click(insurance);
		fireEvent.submit(screen.getByLabelText('Decks').closest('form')!);

		expect(onSubmit).toHaveBeenCalledWith(
			expect.objectContaining({ insurance: !DEFAULT_CONFIG.insurance })
		);
	});

	it('restores the saved game rules into their controls', () => {
		cleanup();
		render(() => (
			<SettingsSidebar
				initialConfig={{
					...DEFAULT_CONFIG,
					penetrationPercent: 50,
					splitLimit: 3,
					doubleAfterSplit: false,
					resplitAces: true,
					dealerPeek: false,
					blackjackPayout: '1:1',
					surrender: 'early',
				}}
				calcTimeMs={null}
				onSubmit={vi.fn()}
			/>
		));

		expect((screen.getByLabelText('Penetration %') as HTMLInputElement).value).toBe('50');
		expect((screen.getByLabelText('Split limit') as HTMLInputElement).value).toBe('3');
		expect((screen.getByLabelText('DAS') as HTMLInputElement).checked).toBe(false);
		expect((screen.getByLabelText('RSA') as HTMLInputElement).checked).toBe(true);
		expect((screen.getByLabelText('ENHC') as HTMLInputElement).checked).toBe(true);
		expect(screen.getByRole('combobox', { name: 'BJ payout' }).textContent).toBe('1:1');
		expect(screen.getByRole('combobox', { name: 'Surrender' }).textContent).toBe('Early');
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

	it('loads the tag values of a named preset', async () => {
		cleanup();
		render(() => (
			<SettingsSidebar
				initialConfig={DEFAULT_CONFIG}
				calcTimeMs={null}
				onSubmit={vi.fn()}
			/>
		));

		fireEvent.click(screen.getByRole('tab', { name: 'Count' }));
		fireEvent.click(await screen.findByRole('combobox', { name: 'System' }));
		fireEvent.click(await screen.findByRole('option', { name: 'Hi-Lo' }));

		await waitFor(() =>
			expect((screen.getByLabelText('Tag value for 2') as HTMLInputElement).value).toBe(
				'1'
			)
		);
		expect((screen.getByLabelText('Tag value for 7') as HTMLInputElement).value).toBe(
			'0'
		);
		expect((screen.getByLabelText('Tag value for 10') as HTMLInputElement).value).toBe(
			'-1'
		);
		expect((screen.getByLabelText('Tag value for A') as HTMLInputElement).value).toBe(
			'-1'
		);
	});

	it('restores the hand-edited tag values when Custom is reselected', async () => {
		cleanup();
		render(() => (
			<SettingsSidebar
				initialConfig={DEFAULT_CONFIG}
				calcTimeMs={null}
				onSubmit={vi.fn()}
			/>
		));

		fireEvent.click(screen.getByRole('tab', { name: 'Count' }));
		fireEvent.input(screen.getByLabelText('Tag value for 8'), { target: { value: '3' } });

		const combobox = await screen.findByRole('combobox', { name: 'System' });
		fireEvent.click(combobox);
		fireEvent.click(await screen.findByRole('option', { name: 'Hi-Opt I' }));
		await waitFor(() =>
			expect((screen.getByLabelText('Tag value for 8') as HTMLInputElement).value).toBe(
				'0'
			)
		);

		fireEvent.click(combobox);
		fireEvent.click(await screen.findByRole('option', { name: 'Custom' }));

		await waitFor(() =>
			expect((screen.getByLabelText('Tag value for 8') as HTMLInputElement).value).toBe(
				'3'
			)
		);
		expect((screen.getByLabelText('Tag value for 5') as HTMLInputElement).value).toBe(
			'1'
		);
	});

	it('disables Calculate until a setting differs from the last calculation', () => {
		cleanup();
		const onSubmit = vi.fn();
		render(() => (
			<SettingsSidebar
				initialConfig={DEFAULT_CONFIG}
				calcTimeMs={null}
				onSubmit={onSubmit}
			/>
		));

		const button = screen.getByRole('button', { name: 'Calculate' }) as HTMLButtonElement;
		expect(button.disabled).toBe(true);

		const decksInput = screen.getByLabelText('Decks');
		fireEvent.input(decksInput, { target: { value: '8' } });
		expect(button.disabled).toBe(false);

		// Back to the calculated value: nothing to recalculate again.
		fireEvent.input(decksInput, { target: { value: String(DEFAULT_CONFIG.decks) } });
		expect(button.disabled).toBe(true);

		fireEvent.input(decksInput, { target: { value: '8' } });
		fireEvent.click(button);
		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(button.disabled).toBe(true);
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
