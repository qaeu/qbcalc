/**
 * A labelled wrapper for a single setting: a label (with an optional help
 * icon and its hint) above the control for that setting.
 *
 * Not for a boolean: `SettingToggle` renders its own label, since Ark's
 * checkbox root is a `<label>` and one nested here would have no control.
 */

import { Show, type Component, type JSX } from 'solid-js';

import HintPopover from '#c/common/HintPopover';

import '#styles/settings/SettingsItem';

interface SettingsItemProps {
	label: string;
	helptext?: string;
	children: JSX.Element;
}

const SettingsItem: Component<SettingsItemProps> = (props) => (
	<label class="settings-item">
		<span class="settings-item__label">
			{props.label}
			<Show when={props.helptext}>
				{(helptext) => <HintPopover text={helptext()} label={props.label} />}
			</Show>
		</span>
		{props.children}
	</label>
);

export default SettingsItem;
