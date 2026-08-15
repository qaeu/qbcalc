import type { Component } from 'solid-js';

import type { Rank } from '#utils/ev/cards';
import type { TagValues } from '#utils/ev/composition';
import { COUNTING_SYSTEMS, type CountingSystemId } from '#utils/countingSystems';

import SettingSelect, { type SettingOption } from '#c/SettingSelect';
import SettingsItem from '#c/SettingsItem';
import TagValueGrid from '#c/TagValueGrid';

import '#styles/SettingsCountTab';

interface SettingsCountTabProps {
	system: CountingSystemId;
	tags: TagValues;
	onSystemChange: (system: CountingSystemId) => void;
	onTagChange: (rank: Rank, value: number) => void;
}

const SYSTEM_OPTIONS: readonly SettingOption<CountingSystemId>[] = COUNTING_SYSTEMS.map(
	(system) => ({ label: system.label, value: system.id })
);

const SettingsCountTab: Component<SettingsCountTabProps> = (props) => {
	return (
		<div class="settings-count-tab">
			<h3>Counting System</h3>
			<SettingsItem
				label="System"
				helptext="A preset tag vector, or Custom once any tag value is hand-edited"
			>
				<SettingSelect
					options={SYSTEM_OPTIONS}
					value={props.system}
					onChange={props.onSystemChange}
				/>
			</SettingsItem>
			<SettingsItem
				label="Tag Values"
				helptext="The running count added for each rank drawn, by rank"
			>
				<TagValueGrid tags={props.tags} onTagChange={props.onTagChange} />
			</SettingsItem>
		</div>
	);
};

export default SettingsCountTab;
