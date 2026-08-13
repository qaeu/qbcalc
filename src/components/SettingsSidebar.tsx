import { Tabs } from '@ark-ui/solid/tabs';
import { Show, type Component } from 'solid-js';
import { createStore } from 'solid-js/store';

import { LayoutGrid, SlidersHorizontal } from 'lucide-solid';

import {
	BLACKJACK_PAYOUTS,
	SURRENDERS,
	type BlackjackPayout,
	type Rank,
	type Surrender,
	type TagValues,
} from '#utils/blackjackEv';
import { tagsForSystem, type CountingSystemId } from '#utils/countingSystems';
import { formatDuration } from '#utils/format';
import { saveCalculatorConfig, type CalculatorConfig } from '#utils/storage';

import CountingSystemPanel from '#c/CountingSystemPanel';
import SettingSelect, { type SettingOption } from '#c/SettingSelect';

import '#styles/SettingsSidebar';

interface SettingsSidebarProps {
	initialConfig: CalculatorConfig;
	calcTimeMs: number | null;
	onSubmit: (config: CalculatorConfig) => void;
}

const PAYOUT_OPTIONS: readonly SettingOption<BlackjackPayout>[] = BLACKJACK_PAYOUTS.map(
	(payout) => ({ value: payout, label: payout })
);

const SURRENDER_LABELS: Record<Surrender, string> = {
	early: 'Early',
	late: 'Late',
	none: 'None',
};

const SURRENDER_OPTIONS: readonly SettingOption<Surrender>[] = SURRENDERS.map(
	(surrender) => ({ value: surrender, label: SURRENDER_LABELS[surrender] })
);

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
		const nextConfig: CalculatorConfig = { ...config, tags: { ...config.tags } };
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
							<h3>Game Rules</h3>
							<div class="settings-sidebar__field-grid">
								<label>
									Decks
									<input
										type="number"
										min="1"
										max="8"
										value={config.decks}
										onInput={(event) =>
											setConfig('decks', Number(event.currentTarget.value))
										}
									/>
								</label>
								<label>
									Running count
									<input
										type="number"
										step="1"
										value={config.count}
										onInput={(event) =>
											setConfig('count', Number(event.currentTarget.value))
										}
									/>
								</label>
								<label>
									Penetration %
									<input
										type="number"
										min="1"
										max="100"
										step="1"
										value={config.penetrationPercent}
										onInput={(event) =>
											setConfig('penetrationPercent', Number(event.currentTarget.value))
										}
									/>
								</label>
								<label>
									Split limit
									<input
										type="number"
										min="1"
										max="4"
										step="1"
										value={config.splitLimit}
										onInput={(event) =>
											setConfig('splitLimit', Number(event.currentTarget.value))
										}
									/>
								</label>
							</div>
							<SettingSelect
								label="BJ payout"
								options={PAYOUT_OPTIONS}
								value={config.blackjackPayout}
								onChange={(payout) => setConfig('blackjackPayout', payout)}
							/>
							<SettingSelect
								label="Surrender"
								options={SURRENDER_OPTIONS}
								value={config.surrender}
								onChange={(surrender) => setConfig('surrender', surrender)}
							/>
							<div class="settings-sidebar__toggle-grid">
								<label class="settings-sidebar__checkbox">
									<input
										type="checkbox"
										title="Dealer stands on soft 17"
										checked={!config.dealerHitsSoft17}
										onInput={(event) =>
											setConfig('dealerHitsSoft17', !event.currentTarget.checked)
										}
									/>
									S17
								</label>
								<label class="settings-sidebar__checkbox">
									<input
										type="checkbox"
										title="Double after split allowed"
										checked={config.doubleAfterSplit}
										onInput={(event) =>
											setConfig('doubleAfterSplit', event.currentTarget.checked)
										}
									/>
									DAS
								</label>
								<label class="settings-sidebar__checkbox">
									<input
										type="checkbox"
										title="Resplit aces allowed"
										checked={config.resplitAces}
										onInput={(event) =>
											setConfig('resplitAces', event.currentTarget.checked)
										}
									/>
									RSA
								</label>
								<label class="settings-sidebar__checkbox">
									<input
										type="checkbox"
										title="Dealer peeks for blackjack"
										checked={config.dealerPeek}
										onInput={(event) =>
											setConfig('dealerPeek', event.currentTarget.checked)
										}
									/>
									Peek
								</label>
							</div>
						</Tabs.Content>
						<Tabs.Content value="count" class="settings-sidebar__tab-panel">
							<CountingSystemPanel
								system={config.system}
								tags={config.tags}
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
