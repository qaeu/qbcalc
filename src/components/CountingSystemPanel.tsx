import { Select, createListCollection } from '@ark-ui/solid/select';
import { For, type Component } from 'solid-js';
import { Portal } from 'solid-js/web';

import { ChevronDown } from 'lucide-solid';

import { RANKS, type Rank, type TagValues } from '#utils/blackjackEv';
import { COUNTING_SYSTEMS, type CountingSystemId } from '#utils/countingSystems';

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

const systemCollection = createListCollection({
	items: COUNTING_SYSTEMS.map((system) => ({ label: system.label, value: system.id })),
});

const CountingSystemPanel: Component<CountingSystemPanelProps> = (props) => {
	return (
		<div class="counting-system">
			<h3>Counting System</h3>
			<Select.Root
				class="counting-system__select"
				collection={systemCollection}
				value={[props.system]}
				onValueChange={(details) =>
					props.onSystemChange(details.value[0] as CountingSystemId)
				}
			>
				<Select.Label>System</Select.Label>
				<Select.Control>
					<Select.Trigger class="counting-system__select-trigger">
						<Select.ValueText />
						<Select.Indicator>
							<ChevronDown />
						</Select.Indicator>
					</Select.Trigger>
				</Select.Control>
				<Portal>
					<Select.Positioner>
						<Select.Content class="counting-system__select-content">
							<For each={systemCollection.items}>
								{(item) => (
									<Select.Item item={item} class="counting-system__select-item">
										<Select.ItemText>{item.label}</Select.ItemText>
									</Select.Item>
								)}
							</For>
						</Select.Content>
					</Select.Positioner>
				</Portal>
			</Select.Root>
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
