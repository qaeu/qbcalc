import { Tabs } from '@ark-ui/solid/tabs';
import { createEffect, createSignal, onCleanup, Show, type Component } from 'solid-js';
import { createStore } from 'solid-js/store';

import { LayoutGrid, SlidersHorizontal, Wallet } from 'lucide-solid';

import type { BankrollAnalysis } from '#utils/bankroll';
import { type Rank } from '#utils/ev/cards';
import { type TagValues } from '#utils/ev/composition';
import { tagsForSystem, type CountingSystemId } from '#utils/countingSystems';
import { formatDuration } from '#utils/format';
import { INPUT_SETTLE_MS } from '#utils/settle';
import {
	calculatorSettingsEqual,
	settingsFromConfig,
	type BankrollConfig,
	type CalculatorConfig,
	type CalculatorSettings,
} from '#utils/storage';

import SettingsBankrollTab from '#c/SettingsBankrollTab';
import SettingsCountTab from '#c/SettingsCountTab';
import SettingsRulesTab from '#c/SettingsRulesTab';

import '#styles/SettingsSidebar';

interface SettingsSidebarProps {
	initialConfig: CalculatorConfig;
	calcTimeMs: number | null;
	/**
	 * Called once the settings have stopped moving for `INPUT_SETTLE_MS`.
	 * Handed the settings alone: the running count is the app's, moved by the
	 * arrow keys and recalculated without this form's involvement.
	 */
	onSettingsChange: (settings: CalculatorSettings) => void;
	/**
	 * The bankroll settings, which -- unlike the config above -- are owned by the
	 * app rather than mirrored into this form. They change nothing the worker
	 * computes, so they are applied as they are typed and never reach the
	 * settle timer below. See docs/bankroll-model.md.
	 */
	bankroll: BankrollConfig;
	bankrollAnalysis: BankrollAnalysis | undefined;
	onBankrollChange: <K extends keyof BankrollConfig>(
		key: K,
		value: BankrollConfig[K]
	) => void;
}

const SettingsSidebar: Component<SettingsSidebarProps> = (props) => {
	// One store rather than a signal per field: the form mirrors every setting,
	// and reporting a change is then just handing the mirror back. Tag vectors
	// are copied in rather than stored by reference -- the presets are shared
	// module constants, and a store takes ownership of the object it is handed.
	const [config, setConfig] = createStore<CalculatorSettings>({
		...settingsFromConfig(props.initialConfig),
		tags: { ...props.initialConfig.tags },
	});

	// The settings the shown results were calculated from. The app kicks off a
	// calculation with initialConfig on mount, so the form starts out matching
	// what is on screen and there is nothing to recalculate yet.
	let lastReported: CalculatorSettings = {
		...settingsFromConfig(props.initialConfig),
		tags: { ...props.initialConfig.tags },
	};

	let settleTimer: number | undefined;
	onCleanup(() => clearTimeout(settleTimer));

	// Spreading the store reads every field, which is what subscribes this to
	// all of them at once -- including the tag vector, one rank at a time. The
	// snapshot is a plain copy for the same reason it is on the way in: the
	// app must not be handed a live view of a form that keeps moving.
	createEffect(() => {
		const settings: CalculatorSettings = { ...config, tags: { ...config.tags } };
		// Read here rather than in the timer, where it would be a props access
		// outside any tracked scope.
		const report = props.onSettingsChange;
		clearTimeout(settleTimer);
		// Covers the first run, and any edit that lands back on the calculated
		// value before the timer fires -- there is nothing to recompute either way.
		if (calculatorSettingsEqual(settings, lastReported)) return;
		settleTimer = window.setTimeout(() => {
			lastReported = settings;
			report(settings);
		}, INPUT_SETTLE_MS);
	});

	// The tag vector Custom last held, so that selecting a preset and coming back
	// restores the user's own values rather than leaving the preset's behind.
	// `null` until Custom has been left at least once -- selecting Custom with
	// nothing remembered keeps whatever is in the grid as the starting point.
	const [customTags, setCustomTags] = createSignal<TagValues | null>(
		props.initialConfig.system === 'custom' ? { ...props.initialConfig.tags } : null
	);

	const handleSystemChange = (system: CountingSystemId) => {
		if (config.system === 'custom' && system !== 'custom') {
			setCustomTags({ ...config.tags });
		}
		setConfig('system', system);
		const nextTags = tagsForSystem(system) ?? (system === 'custom' ? customTags() : null);
		if (nextTags) setConfig('tags', { ...nextTags });
	};

	// Any hand-edited tag makes the vector no longer the preset's, whichever
	// preset was selected -- so the system always drops to 'custom'.
	const handleTagChange = (rank: Rank, value: number) => {
		setConfig('tags', (tags): TagValues => ({ ...tags, [rank]: value }));
		setConfig('system', 'custom');
	};

	return (
		<div class="settings-sidebar">
			<aside class="settings-sidebar__card">
				{/*
				 * Still a form, for the grouping and the implicit labelling, but
				 * with nothing to submit: every field recalculates on its own once
				 * it settles. Enter in a text field would otherwise reload the page.
				 */}
				<form
					class="settings-sidebar__controls"
					onSubmit={(event) => event.preventDefault()}
				>
					<Tabs.Root defaultValue="rules" class="settings-sidebar__tabs">
						<Tabs.List class="settings-sidebar__tab-list">
							<Tabs.Trigger value="rules" class="settings-sidebar__tab">
								<SlidersHorizontal />
								Rules
							</Tabs.Trigger>
							<Tabs.Trigger value="count" class="settings-sidebar__tab">
								<LayoutGrid />
								Count
							</Tabs.Trigger>
							<Tabs.Trigger value="bankroll" class="settings-sidebar__tab">
								<Wallet />
								Bankroll
							</Tabs.Trigger>
						</Tabs.List>
						<Tabs.Content value="rules" class="settings-sidebar__tab-panel">
							<SettingsRulesTab config={config} setConfig={setConfig} />
						</Tabs.Content>
						<Tabs.Content value="count" class="settings-sidebar__tab-panel">
							<SettingsCountTab
								system={config.system}
								tags={config.tags}
								onSystemChange={handleSystemChange}
								onTagChange={handleTagChange}
							/>
						</Tabs.Content>
						<Tabs.Content value="bankroll" class="settings-sidebar__tab-panel">
							<SettingsBankrollTab
								config={props.bankroll}
								analysis={props.bankrollAnalysis}
								onChange={props.onBankrollChange}
							/>
						</Tabs.Content>
					</Tabs.Root>
				</form>
			</aside>
			<Show when={props.calcTimeMs !== null}>
				<span class="settings-sidebar__calc-time">
					(took {formatDuration(props.calcTimeMs!)})
				</span>
			</Show>
		</div>
	);
};

export default SettingsSidebar;
