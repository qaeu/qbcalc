import type { Component } from 'solid-js';

import { COACHING_LEVELS, type CoachingLevel, type PlayConfig } from '#utils/storage';

import SettingSelect, { type SettingOption } from '#c/SettingSelect';
import SettingsItem from '#c/SettingsItem';

import '#styles/SettingsPlayTab';

interface SettingsPlayTabProps {
	config: PlayConfig;
	onChange: <K extends keyof PlayConfig>(key: K, value: PlayConfig[K]) => void;
}

const COACHING_OPTIONS: readonly SettingOption<CoachingLevel>[] = COACHING_LEVELS.map(
	(level) => ({ value: level.value, label: level.label })
);

/**
 * How the Play view is set up. None of it reaches the worker -- the coaching
 * level decides what is *shown*, never what is graded -- so, like the bankroll
 * settings, these apply as they are typed rather than through the settle timer.
 */
const SettingsPlayTab: Component<SettingsPlayTabProps> = (props) => (
	<div class="settings-play-tab">
		<h3>Play</h3>
		<SettingsItem
			label="Coaching"
			helptext="How much of the grading is shown. Every decision is graded either way, so the stats compare across sessions"
		>
			<SettingSelect
				options={COACHING_OPTIONS}
				value={props.config.coaching}
				onChange={(coaching) => props.onChange('coaching', coaching)}
			/>
		</SettingsItem>
		<SettingsItem
			label="Show count"
			helptext="Reveals the running and true counts on the felt. Off by default -- keeping the count is the thing being practised"
			layout="row"
		>
			<input
				type="checkbox"
				checked={props.config.showCount}
				onChange={(event) => props.onChange('showCount', event.currentTarget.checked)}
			/>
		</SettingsItem>
		<SettingsItem label="Table minimum" helptext="The smallest bet the table takes">
			<input
				type="number"
				min="1"
				step="1"
				value={props.config.tableMinimum}
				onInput={(event) =>
					props.onChange('tableMinimum', Number(event.currentTarget.value))
				}
			/>
		</SettingsItem>
	</div>
);

export default SettingsPlayTab;
