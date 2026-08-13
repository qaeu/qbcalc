/**
 * A labelled wrapper for a single setting: a label (with an optional help
 * icon and tooltip) paired with the control for that setting.
 */

import { Show, type Component, type JSX } from 'solid-js';

import { Info } from 'lucide-solid';

import '#styles/SettingsItem';

interface SettingsItemProps {
	label: string;
	helptext?: string;
	/** 'stack' (default) puts the label above the control; 'row' puts a
	 * compact control (e.g. a checkbox) before the label, side by side. */
	layout?: 'stack' | 'row';
	children: JSX.Element;
}

const SettingsItem: Component<SettingsItemProps> = (props) => (
	<label class={`settings-item settings-item--${props.layout ?? 'stack'}`}>
		<span class="settings-item__label">
			{props.label}
			<Show when={props.helptext}>
				<span class="settings-item__hint-icon" aria-hidden="true" title={props.helptext}>
					<Info />
				</span>
			</Show>
		</span>
		{props.children}
	</label>
);

export default SettingsItem;
