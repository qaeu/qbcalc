import { Tabs } from '@ark-ui/solid/tabs';
import { createMemo, createSignal, Show, type Component } from 'solid-js';
import { createStore } from 'solid-js/store';

import { LayoutGrid, SlidersHorizontal } from 'lucide-solid';

import { type Rank, type TagValues } from '#utils/blackjackEv';
import { tagsForSystem, type CountingSystemId } from '#utils/countingSystems';
import { formatDuration } from '#utils/format';
import {
	calculatorConfigsEqual,
	saveCalculatorConfig,
	type CalculatorConfig,
} from '#utils/storage';

import SettingsCountTab from '#c/SettingsCountTab';
import SettingsRulesTab from '#c/SettingsRulesTab';

import '#styles/SettingsSidebar';

interface SettingsSidebarProps {
	initialConfig: CalculatorConfig;
	calcTimeMs: number | null;
	onSubmit: (config: CalculatorConfig) => void;
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

	const handleSystemChange = (system: CountingSystemId) => {
		setConfig('system', system);
		const presetTags = tagsForSystem(system);
		if (presetTags) setConfig('tags', { ...presetTags });
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
