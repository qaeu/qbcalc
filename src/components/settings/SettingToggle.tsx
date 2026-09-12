/**
 * The switch for a setting that is on or off -- a table rule, mostly.
 *
 * Ark's checkbox for the behaviour, our own paint for the box: a bare
 * `<input type="checkbox">` arrives in the OS accent colour beside a fully
 * custom select, which is the one control family that never got the project's
 * usual treatment.
 *
 * Unlike `SettingSelect`, this one renders its own label rather than living
 * inside a `SettingsItem`: Ark's `Checkbox.Root` is itself a `<label>`, and a
 * label nested in a label has no control of its own. The hint icon is passed
 * through the same way `SettingsItem` passes it.
 */

import { Checkbox } from '@ark-ui/solid/checkbox';
import { Show, type Component } from 'solid-js';

import { Check } from 'lucide-solid';

import HintPopover from '#c/common/HintPopover';

import '#styles/settings/SettingToggle';

interface SettingToggleProps {
	label: string;
	helptext?: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}

const SettingToggle: Component<SettingToggleProps> = (props) => (
	<Checkbox.Root
		class="setting-toggle"
		checked={props.checked}
		// Ark's tri-state, of which this control only ever offers two: an
		// indeterminate rule is not a thing a table can have.
		onCheckedChange={(details) => props.onChange(details.checked === true)}
	>
		<Checkbox.Control class="setting-toggle__box">
			<Checkbox.Indicator class="setting-toggle__mark">
				<Check />
			</Checkbox.Indicator>
		</Checkbox.Control>
		<Checkbox.Label class="setting-toggle__label">
			{props.label}
			<Show when={props.helptext}>
				{(helptext) => <HintPopover text={helptext()} label={props.label} />}
			</Show>
		</Checkbox.Label>
		{/*
		 * `checked` on the input as well as on the root: Ark hands its hidden
		 * input a `defaultChecked`, which Solid applies once and never again,
		 * so the input the keyboard and every assistive tool actually operate
		 * would otherwise sit at whatever it was born as. Passed last, so it
		 * wins over Ark's own -- the state is this component's, not the DOM's.
		 */}
		<Checkbox.HiddenInput checked={props.checked} />
	</Checkbox.Root>
);

export default SettingToggle;
