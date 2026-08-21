import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, cleanup, waitFor } from '@solidjs/testing-library';

import SettingsSidebar from '#c/SettingsSidebar';
import { ACE_FIVE_TAGS } from '#utils/ev/composition';
import { HI_LO_TAGS } from '#utils/countingSystems';
import {
	DEFAULT_BANKROLL_CONFIG,
	DEFAULT_CONFIG,
	settingsFromConfig,
	type CalculatorSettings,
} from '#utils/storage';

// What the form owns, which is every field of a config but the running count:
// that one is driven by the arrow keys and never passes through the sidebar.
const DEFAULT_SETTINGS = settingsFromConfig(DEFAULT_CONFIG);

/**
 * The form reports its settings once they have stopped moving rather than on a
 * submit, so every assertion on `onSettingsChange` has to outlast that wait --
 * `waitFor`'s default timeout is comfortably longer than the settle delay.
 */
const settledWith = (onSettingsChange: ReturnType<typeof vi.fn>, expected: unknown) =>
	waitFor(() => expect(onSettingsChange).toHaveBeenCalledWith(expected));

/**
 * Long enough that a report would have arrived if one were coming -- what a
 * case asserting nothing was reported has to wait out before it can say so.
 */
const settlingTime = () => new Promise((resolve) => setTimeout(resolve, 800));

describe('SettingsSidebar', () => {
	it('renders the current settings and reports the entered values once they settle', async () => {
		const onSettingsChange = vi.fn();
		render(() => (
			<SettingsSidebar
				initialConfig={DEFAULT_CONFIG}
				calcTimeMs={null}
				onSettingsChange={onSettingsChange}
				bankroll={DEFAULT_BANKROLL_CONFIG}
				bankrollAnalysis={undefined}
				onBankrollChange={() => {}}
			/>
		));

		const decksInput = screen.getByLabelText('Decks');
		fireEvent.input(decksInput, { target: { value: '6' } });
		const checkbox = screen.getByLabelText('S17') as HTMLInputElement;
		fireEvent.click(checkbox);

		await settledWith(onSettingsChange, {
			...DEFAULT_SETTINGS,
			decks: 6,
			dealerHitsSoft17: true,
		} satisfies CalculatorSettings);
		// One report for the pair of edits, not one each: the timer restarts on
		// every change, so a burst costs a single calculation.
		expect(onSettingsChange).toHaveBeenCalledTimes(1);
	});

	it('restores previously submitted values from the given initialConfig', () => {
		cleanup();
		render(() => (
			<SettingsSidebar
				initialConfig={{
					...DEFAULT_CONFIG,
					decks: 6,
					dealerHitsSoft17: false,
				}}
				calcTimeMs={null}
				onSettingsChange={vi.fn()}
				bankroll={DEFAULT_BANKROLL_CONFIG}
				bankrollAnalysis={undefined}
				onBankrollChange={() => {}}
			/>
		));

		expect((screen.getByLabelText('Decks') as HTMLInputElement).value).toBe('6');
		expect((screen.getByLabelText('S17') as HTMLInputElement).checked).toBe(true);
	});

	it('reports the game rules entered on the Rules tab', async () => {
		const onSettingsChange = vi.fn();
		render(() => (
			<SettingsSidebar
				initialConfig={DEFAULT_CONFIG}
				calcTimeMs={null}
				onSettingsChange={onSettingsChange}
				bankroll={DEFAULT_BANKROLL_CONFIG}
				bankrollAnalysis={undefined}
				onBankrollChange={() => {}}
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

		await settledWith(onSettingsChange, {
			...DEFAULT_SETTINGS,
			penetrationPercent: 60,
			splitLimit: 2,
			doubleAfterSplit: false,
			resplitAces: true,
			dealerPeek: true,
			blackjackPayout: '6:5',
			surrender: 'late',
		} satisfies CalculatorSettings);
	});

	it('does not offer late surrender while ENHC is on', async () => {
		cleanup();
		render(() => (
			<SettingsSidebar
				initialConfig={DEFAULT_CONFIG}
				calcTimeMs={null}
				onSettingsChange={vi.fn()}
				bankroll={DEFAULT_BANKROLL_CONFIG}
				bankrollAnalysis={undefined}
				onBankrollChange={() => {}}
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
		const onSettingsChange = vi.fn();
		render(() => (
			<SettingsSidebar
				initialConfig={{ ...DEFAULT_CONFIG, dealerPeek: true, surrender: 'late' }}
				calcTimeMs={null}
				onSettingsChange={onSettingsChange}
				bankroll={DEFAULT_BANKROLL_CONFIG}
				bankrollAnalysis={undefined}
				onBankrollChange={() => {}}
			/>
		));

		const trigger = screen.getByRole('combobox', { name: 'Surrender' });
		expect(trigger.textContent).toBe('Late');

		fireEvent.click(screen.getByLabelText('ENHC'));
		await waitFor(() => expect(trigger.textContent).toBe('Early'));

		await settledWith(
			onSettingsChange,
			expect.objectContaining({ dealerPeek: false, surrender: 'early' })
		);
	});

	describe('the rule preset', () => {
		const renderSidebar = (onSettingsChange = vi.fn()) => {
			cleanup();
			render(() => (
				<SettingsSidebar
					initialConfig={DEFAULT_CONFIG}
					calcTimeMs={null}
					onSettingsChange={onSettingsChange}
					bankroll={DEFAULT_BANKROLL_CONFIG}
					bankrollAnalysis={undefined}
					onBankrollChange={() => {}}
				/>
			));
			return screen.getByRole('combobox', { name: 'Preset' });
		};

		it('starts on the preset the default rules describe', () => {
			expect(renderSidebar().textContent).toBe('UK');
		});

		it('applies and reports a selected preset‘s rules', async () => {
			const onSettingsChange = vi.fn();
			const trigger = renderSidebar(onSettingsChange);

			fireEvent.click(trigger);
			fireEvent.click(await screen.findByRole('option', { name: 'Vegas' }));
			await waitFor(() => expect(trigger.textContent).toBe('Vegas'));

			expect((screen.getByLabelText('S17') as HTMLInputElement).checked).toBe(false);
			expect((screen.getByLabelText('ENHC') as HTMLInputElement).checked).toBe(false);
			await settledWith(
				onSettingsChange,
				expect.objectContaining({
					dealerHitsSoft17: true,
					dealerPeek: true,
					surrender: 'late',
					hitSplitAces: false,
				})
			);
		});

		// The preset is read back off the rules, so any edit that leaves a
		// named table's rule set shows up here without being told.
		it('drops to Custom once a rule is hand-edited', async () => {
			const trigger = renderSidebar();

			fireEvent.click(screen.getByLabelText('RSA'));
			await waitFor(() => expect(trigger.textContent).toBe('Custom'));

			// And back again: the rules are all the selection ever depended on.
			fireEvent.click(screen.getByLabelText('RSA'));
			await waitFor(() => expect(trigger.textContent).toBe('UK'));
		});

		it('does not offer Custom as a choice', async () => {
			const trigger = renderSidebar();

			fireEvent.click(trigger);
			expect(
				(await screen.findByRole('option', { name: 'Custom' })).hasAttribute(
					'data-disabled'
				)
			).toBe(true);
		});
	});

	it('reports the hit-split-aces rule', async () => {
		cleanup();
		const onSettingsChange = vi.fn();
		render(() => (
			<SettingsSidebar
				initialConfig={DEFAULT_CONFIG}
				calcTimeMs={null}
				onSettingsChange={onSettingsChange}
				bankroll={DEFAULT_BANKROLL_CONFIG}
				bankrollAnalysis={undefined}
				onBankrollChange={() => {}}
			/>
		));

		// Read against the default rather than a literal, so the case keeps
		// testing the toggle rather than whichever way the default points.
		const hsa = screen.getByLabelText('HSA') as HTMLInputElement;
		expect(hsa.checked).toBe(DEFAULT_CONFIG.hitSplitAces);
		fireEvent.click(hsa);

		await settledWith(
			onSettingsChange,
			expect.objectContaining({ hitSplitAces: !DEFAULT_CONFIG.hitSplitAces })
		);
	});

	it('reports the insurance rule', async () => {
		cleanup();
		const onSettingsChange = vi.fn();
		render(() => (
			<SettingsSidebar
				initialConfig={DEFAULT_CONFIG}
				calcTimeMs={null}
				onSettingsChange={onSettingsChange}
				bankroll={DEFAULT_BANKROLL_CONFIG}
				bankrollAnalysis={undefined}
				onBankrollChange={() => {}}
			/>
		));

		const insurance = screen.getByLabelText('INS') as HTMLInputElement;
		expect(insurance.checked).toBe(DEFAULT_CONFIG.insurance);
		fireEvent.click(insurance);

		await settledWith(
			onSettingsChange,
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
				onSettingsChange={vi.fn()}
				bankroll={DEFAULT_BANKROLL_CONFIG}
				bankrollAnalysis={undefined}
				onBankrollChange={() => {}}
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
				onSettingsChange={vi.fn()}
				bankroll={DEFAULT_BANKROLL_CONFIG}
				bankrollAnalysis={undefined}
				onBankrollChange={() => {}}
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
				onSettingsChange={vi.fn()}
				bankroll={DEFAULT_BANKROLL_CONFIG}
				bankrollAnalysis={undefined}
				onBankrollChange={() => {}}
			/>
		));

		expect((screen.getByLabelText('Tag value for 5') as HTMLInputElement).value).toBe(
			'1'
		);
		expect((screen.getByLabelText('Tag value for A') as HTMLInputElement).value).toBe(
			'-1'
		);
		expect((screen.getByLabelText('Tag value for 10') as HTMLInputElement).value).toBe(
			'-1'
		);
	});

	it('switches the system to Custom when a tag value is edited and reports it', async () => {
		const onSettingsChange = vi.fn();
		render(() => (
			<SettingsSidebar
				initialConfig={DEFAULT_CONFIG}
				calcTimeMs={null}
				onSettingsChange={onSettingsChange}
				bankroll={DEFAULT_BANKROLL_CONFIG}
				bankrollAnalysis={undefined}
				onBankrollChange={() => {}}
			/>
		));

		const sevenTag = screen.getByLabelText('Tag value for 7');
		fireEvent.input(sevenTag, { target: { value: '-1' } });

		await settledWith(onSettingsChange, {
			...DEFAULT_SETTINGS,
			system: 'custom',
			tags: { ...HI_LO_TAGS, '7': -1 },
		} satisfies CalculatorSettings);

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
				onSettingsChange={vi.fn()}
				bankroll={DEFAULT_BANKROLL_CONFIG}
				bankrollAnalysis={undefined}
				onBankrollChange={() => {}}
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
				onSettingsChange={vi.fn()}
				bankroll={DEFAULT_BANKROLL_CONFIG}
				bankrollAnalysis={undefined}
				onBankrollChange={() => {}}
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
				onSettingsChange={vi.fn()}
				bankroll={DEFAULT_BANKROLL_CONFIG}
				bankrollAnalysis={undefined}
				onBankrollChange={() => {}}
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

	it('does not report a setting edited back to what was last calculated', async () => {
		cleanup();
		const onSettingsChange = vi.fn();
		render(() => (
			<SettingsSidebar
				initialConfig={DEFAULT_CONFIG}
				calcTimeMs={null}
				onSettingsChange={onSettingsChange}
				bankroll={DEFAULT_BANKROLL_CONFIG}
				bankrollAnalysis={undefined}
				onBankrollChange={() => {}}
			/>
		));

		const decksInput = screen.getByLabelText('Decks');
		fireEvent.input(decksInput, { target: { value: '8' } });
		// Back to the calculated value before the timer fires: the results on
		// screen already answer this, so nothing should be recalculated.
		fireEvent.input(decksInput, { target: { value: String(DEFAULT_CONFIG.decks) } });

		await settlingTime();
		expect(onSettingsChange).not.toHaveBeenCalled();
	});

	it('shows the calculation duration when calcTimeMs is provided', () => {
		render(() => (
			<SettingsSidebar
				initialConfig={DEFAULT_CONFIG}
				calcTimeMs={1234}
				onSettingsChange={vi.fn()}
				bankroll={DEFAULT_BANKROLL_CONFIG}
				bankrollAnalysis={undefined}
				onBankrollChange={() => {}}
			/>
		));

		expect(screen.getByText(/\(took 1\.2s\)/)).toBeDefined();
	});

	describe('bankroll tab', () => {
		const renderWithBankroll = (
			onBankrollChange = vi.fn(),
			onSettingsChange = vi.fn()
		) => {
			render(() => (
				<SettingsSidebar
					initialConfig={DEFAULT_CONFIG}
					calcTimeMs={null}
					onSettingsChange={onSettingsChange}
					bankroll={DEFAULT_BANKROLL_CONFIG}
					bankrollAnalysis={undefined}
					onBankrollChange={onBankrollChange}
				/>
			));
			fireEvent.click(screen.getByRole('tab', { name: 'Bankroll' }));
			return onBankrollChange;
		};

		it('reports edits to its fields', () => {
			const onBankrollChange = renderWithBankroll();

			fireEvent.input(screen.getByLabelText('Bankroll', { selector: 'input' }), {
				target: { value: '20000' },
			});
			expect(onBankrollChange).toHaveBeenCalledWith('bankroll', 20000);

			fireEvent.input(screen.getByLabelText('Unit'), { target: { value: '50' } });
			expect(onBankrollChange).toHaveBeenCalledWith('unit', 50);

			fireEvent.input(screen.getByLabelText('Rounds per hour'), {
				target: { value: '80' },
			});
			expect(onBankrollChange).toHaveBeenCalledWith('roundsPerHour', 80);
		});

		it('reports a bet spread edit as a whole new ramp', () => {
			const onBankrollChange = renderWithBankroll();

			fireEvent.input(
				screen.getByLabelText('Units bet at Hi-Lo-equivalent true count ≥+6'),
				{
					target: { value: '20' },
				}
			);

			expect(onBankrollChange).toHaveBeenCalledWith('ramp', [1, 1, 2, 3, 5, 8, 20]);
		});

		// The whole reason the bankroll settings are owned by the app rather than
		// mirrored into this form: they change nothing the worker computes, so
		// recalculating after one would be redoing identical work -- and would
		// blank the grids on the way, which is what the app renders from.
		it('does not recalculate', async () => {
			const onSettingsChange = vi.fn();
			renderWithBankroll(vi.fn(), onSettingsChange);

			fireEvent.input(screen.getByLabelText('Bankroll', { selector: 'input' }), {
				target: { value: '20000' },
			});
			fireEvent.input(
				screen.getByLabelText('Units bet at Hi-Lo-equivalent true count +3'),
				{
					target: { value: '9' },
				}
			);

			await settlingTime();
			expect(onSettingsChange).not.toHaveBeenCalled();
		});
	});

	describe('full calculation', () => {
		const renderWithFullCalc = (props: {
			onFullCalculation?: () => void;
			isFullResult?: boolean;
			isBusy?: boolean;
		}) => {
			cleanup();
			render(() => (
				<SettingsSidebar
					initialConfig={DEFAULT_CONFIG}
					calcTimeMs={1234}
					onSettingsChange={vi.fn()}
					bankroll={DEFAULT_BANKROLL_CONFIG}
					bankrollAnalysis={undefined}
					onBankrollChange={() => {}}
					{...props}
				/>
			));
			return screen.queryByRole('button', {
				name: 'Run full calculation',
			}) as HTMLButtonElement | null;
		};

		it('asks the app to reprice at full precision', () => {
			const onFullCalculation = vi.fn();
			const button = renderWithFullCalc({ onFullCalculation });

			fireEvent.click(button!);
			expect(onFullCalculation).toHaveBeenCalledTimes(1);
		});

		it('is disabled while a calculation is in flight', () => {
			const button = renderWithFullCalc({
				onFullCalculation: vi.fn(),
				isBusy: true,
			});
			expect(button!.disabled).toBe(true);
		});

		// Nothing left to compute: the figures on screen are already the ones this
		// button produces.
		it('is disabled once the result on screen is the full one', () => {
			const button = renderWithFullCalc({
				onFullCalculation: vi.fn(),
				isFullResult: true,
			});
			expect(button!.disabled).toBe(true);
			expect(screen.getByText(/full ·/)).toBeDefined();
		});

		it('labels the timing as full only once the full result has landed', () => {
			renderWithFullCalc({ onFullCalculation: vi.fn() });
			expect(screen.queryByText(/full ·/)).toBeNull();
			expect(screen.getByText(/\(took 1\.2s\)/)).toBeDefined();
		});

		// Every other render site in this file leaves the three props off, which is
		// what keeps them optional.
		it('shows no button where the app does not offer one', () => {
			expect(renderWithFullCalc({})).toBeNull();
		});
	});
});
