import { Tabs } from '@ark-ui/solid/tabs';
import { createMemo, createSignal, Show, type Component } from 'solid-js';
import { createStore } from 'solid-js/store';

import { LayoutGrid, SlidersHorizontal, Wallet } from 'lucide-solid';

import type { BankrollAnalysis } from '#utils/bankroll';
import { type Rank } from '#utils/ev/cards';
import { type TagValues } from '#utils/ev/composition';
import { tagsForSystem, type CountingSystemId } from '#utils/countingSystems';
import { formatDuration } from '#utils/format';
import {
	calculatorConfigsEqual,
	saveCalculatorConfig,
	type BankrollConfig,
	type CalculatorConfig,
} from '#utils/storage';

import SettingsBankrollTab from '#c/SettingsBankrollTab';
import SettingsCountTab from '#c/SettingsCountTab';
import SettingsRulesTab from '#c/SettingsRulesTab';

import '#styles/SettingsSidebar';

interface SettingsSidebarProps {
	initialConfig: CalculatorConfig;
	calcTimeMs: number | null;
	onSubmit: (config: CalculatorConfig) => void;
	/**
	 * The bankroll settings, which -- unlike the config above -- are owned by the
	 * app rather than mirrored into this form. They change nothing the worker
	 * computes, so they apply as they are typed and never dirty the Calculate
	 * button. See docs/bankroll-model.md.
	 */
	bankroll: BankrollConfig;
	bankrollAnalysis: BankrollAnalysis | undefined;
	onBankrollChange: <K extends keyof BankrollConfig>(
		key: K,
		value: BankrollConfig[K]
	) => void;
}

const SettingsSidebar: Component<SettingsSidebarProps> = (props) => {
	// One store rather than a signal per field: the form mirrors the whole
	// config, and submitting is then just handing the mirror back. Tag
	// vectors are copied in rather than stored by reference -- the presets
	// are shared module constants, and a store takes ownership of the object
	// it is handed.
	const [config, setConfig] = createStore<CalculatorConfig>({
		...props.initialConfig,
		tags: { ...props.initialConfig.tags },
	});

	// The config the shown results were calculated from. The app kicks off a
	// calculation with initialConfig on mount, so the form starts out matching
	// what is on screen and there is nothing to recalculate yet.
	const [lastCalculated, setLastCalculated] = createSignal<CalculatorConfig>({
		...props.initialConfig,
		tags: { ...props.initialConfig.tags },
	});

	const isUnchanged = createMemo(() => calculatorConfigsEqual(config, lastCalculated()));

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

	const handleSubmit = (event: SubmitEvent) => {
		event.preventDefault();
		if (isUnchanged()) return;
		const nextConfig: CalculatorConfig = { ...config, tags: { ...config.tags } };
		setLastCalculated(nextConfig);
		saveCalculatorConfig(nextConfig);
		props.onSubmit(nextConfig);
	};

	return (
		<div class="settings-sidebar">
			<aside class="settings-sidebar__card">
				<form class="settings-sidebar__controls" onSubmit={handleSubmit}>
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
								count={config.count}
								onSystemChange={handleSystemChange}
								onTagChange={handleTagChange}
								onCountChange={(count) => setConfig('count', count)}
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
					<button
						type="submit"
						disabled={isUnchanged()}
						title={isUnchanged() ? 'Settings match the last calculation' : undefined}
					>
						Calculate
					</button>
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
