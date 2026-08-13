/**
 * A dropdown for a settings field whose value is one of a small fixed set of
 * strings (rule variations, counting system presets, ...). Expected to be
 * wrapped in a `SettingsItem`, whose native `<label>` gives the trigger
 * (rendered as a `<button>`, a labelable element) its accessible name --
 * the same implicit association a plain `<input>` gets.
 */

import { Select, createListCollection } from '@ark-ui/solid/select';
import { createMemo, For, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';

import { ChevronDown } from 'lucide-solid';

import '#styles/SettingSelect';

export interface SettingOption<T extends string> {
	value: T;
	label: string;
}

interface SettingSelectProps<T extends string> {
	options: readonly SettingOption<T>[];
	value: T;
	onChange: (value: T) => void;
}

function SettingSelect<T extends string>(props: SettingSelectProps<T>): JSX.Element {
	const collection = createMemo(() =>
		createListCollection({ items: [...props.options] })
	);

	return (
		<Select.Root
			class="setting-select"
			collection={collection()}
			value={[props.value]}
			onValueChange={(details) => props.onChange(details.value[0] as T)}
		>
			<Select.Control>
				<Select.Trigger class="setting-select__trigger">
					<Select.ValueText />
					<Select.Indicator>
						<ChevronDown />
					</Select.Indicator>
				</Select.Trigger>
			</Select.Control>
			<Portal>
				<Select.Positioner>
					<Select.Content class="setting-select__content">
						<For each={collection().items}>
							{(item) => (
								<Select.Item item={item} class="setting-select__item">
									<Select.ItemText>{item.label}</Select.ItemText>
								</Select.Item>
							)}
						</For>
					</Select.Content>
				</Select.Positioner>
			</Portal>
		</Select.Root>
	);
}

export default SettingSelect;
