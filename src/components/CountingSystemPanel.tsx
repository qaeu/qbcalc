import { For, type Component } from 'solid-js';

import { RANKS, type Rank, type TagValues } from '#utils/blackjackEv';
import { COUNTING_SYSTEMS, type CountingSystemId } from '#utils/countingSystems';

import SettingSelect, { type SettingOption } from '#c/SettingSelect';

import '#styles/CountingSystemPanel';

interface CountingSystemPanelProps {
	system: CountingSystemId;
	tags: TagValues;
	onSystemChange: (system: CountingSystemId) => void;
	onTagChange: (rank: Rank, value: number) => void;
}

/** Ranks are stored as 'T' but read as "10" on a table. */
function rankLabel(rank: Rank): string {
	return rank === 'T' ? '10' : rank;
}

const SYSTEM_OPTIONS: readonly SettingOption<CountingSystemId>[] = COUNTING_SYSTEMS.map(
	(system) => ({ label: system.label, value: system.id })
);

const CountingSystemPanel: Component<CountingSystemPanelProps> = (props) => {
	return (
		<div class="counting-system">
			<h3>Counting System</h3>
			<SettingSelect
				label="System"
				options={SYSTEM_OPTIONS}
				value={props.system}
				onChange={props.onSystemChange}
			/>
			<div class="counting-system__tags">
				<span class="counting-system__tags-label">Tag Values</span>
				<div class="counting-system__tag-grid">
					<For each={RANKS}>
						{(rank) => (
							<label class="counting-system__tag">
								{rankLabel(rank)}
								<input
									type="number"
									step="1"
									aria-label={`Tag value for ${rankLabel(rank)}`}
									value={props.tags[rank]}
									onInput={(event) =>
										props.onTagChange(rank, Number(event.currentTarget.value))
									}
								/>
							</label>
						)}
					</For>
				</div>
			</div>
		</div>
	);
};

export default CountingSystemPanel;
