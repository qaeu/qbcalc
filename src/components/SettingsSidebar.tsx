import { Tabs } from '@ark-ui/solid/tabs';
import { createSignal, Show, type Component } from 'solid-js';

import { LayoutGrid, SlidersHorizontal } from 'lucide-solid';

import { type Rank, type TagValues } from '#utils/blackjackEv';
import { tagsForSystem, type CountingSystemId } from '#utils/countingSystems';
import { formatDuration } from '#utils/format';
import { saveCalculatorConfig, type CalculatorConfig } from '#utils/storage';

import CountingSystemPanel from '#c/CountingSystemPanel';

import '#styles/SettingsSidebar';

interface SettingsSidebarProps {
	initialConfig: CalculatorConfig;
	calcTimeMs: number | null;
	onSubmit: (config: CalculatorConfig) => void;
}

const SettingsSidebar: Component<SettingsSidebarProps> = (props) => {
	const [decksInput, setDecksInput] = createSignal(props.initialConfig.decks);
	const [countInput, setCountInput] = createSignal(props.initialConfig.count);
	const [standsSoft17Input, setStandsSoft17Input] = createSignal(
		!props.initialConfig.dealerHitsSoft17
	);
	const [systemInput, setSystemInput] = createSignal(props.initialConfig.system);
	const [tagsInput, setTagsInput] = createSignal(props.initialConfig.tags);

	const handleSystemChange = (system: CountingSystemId) => {
		setSystemInput(system);
		const presetTags = tagsForSystem(system);
		if (presetTags) setTagsInput(presetTags);
	};

	// Any hand-edited tag makes the vector no longer the preset's, whichever
	// preset was selected -- so the system always drops to 'custom'.
	const handleTagChange = (rank: Rank, value: number) => {
		setTagsInput((tags): TagValues => ({ ...tags, [rank]: value }));
		setSystemInput('custom');
	};

	const handleSubmit = (event: SubmitEvent) => {
		event.preventDefault();
		const nextConfig: CalculatorConfig = {
			decks: decksInput(),
			count: countInput(),
			dealerHitsSoft17: !standsSoft17Input(),
			system: systemInput(),
			tags: tagsInput(),
		};
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
							<label>
								Decks
								<input
									type="number"
									min="1"
									max="8"
									value={decksInput()}
									onInput={(event) => setDecksInput(Number(event.currentTarget.value))}
								/>
							</label>
							<label>
								Running count
								<input
									type="number"
									step="1"
									value={countInput()}
									onInput={(event) => setCountInput(Number(event.currentTarget.value))}
								/>
							</label>
							<label class="settings-sidebar__checkbox">
								<input
									type="checkbox"
									title="Dealer stands on soft 17"
									checked={standsSoft17Input()}
									onInput={(event) => setStandsSoft17Input(event.currentTarget.checked)}
								/>
								S17
							</label>
						</Tabs.Content>
						<Tabs.Content value="count" class="settings-sidebar__tab-panel">
							<CountingSystemPanel
								system={systemInput()}
								tags={tagsInput()}
								onSystemChange={handleSystemChange}
								onTagChange={handleTagChange}
							/>
						</Tabs.Content>
					</Tabs.Root>
					<button type="submit">Calculate</button>
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
