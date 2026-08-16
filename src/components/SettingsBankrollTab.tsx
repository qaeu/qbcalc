import { Show, type Component } from 'solid-js';

import type { BankrollAnalysis } from '#utils/bankroll';
import { formatCurrency } from '#utils/format';
import type { BankrollConfig } from '#utils/storage';

import BetRampEditor from '#c/BetRampEditor';
import SettingsItem from '#c/SettingsItem';

import '#styles/SettingsBankrollTab';

interface SettingsBankrollTabProps {
	config: BankrollConfig;
	/**
	 * The figures the current settings produce, or `undefined` before the first
	 * calculation has landed. Only the Kelly hint is read here -- the rest are
	 * summary cards above the grids.
	 */
	analysis: BankrollAnalysis | undefined;
	onChange: <K extends keyof BankrollConfig>(key: K, value: BankrollConfig[K]) => void;
}

const SettingsBankrollTab: Component<SettingsBankrollTabProps> = (props) => {
	const setRampUnits = (index: number, units: number) => {
		const next = [...props.config.ramp];
		next[index] = units;
		props.onChange('ramp', next);
	};

	return (
		<div class="settings-bankroll-tab">
			<h3>Bankroll &amp; Spread</h3>
			<div class="settings-bankroll-tab__field-grid">
				<SettingsItem label="Bankroll" helptext="Total money backing the bet spread">
					<input
						type="number"
						min="0"
						step="100"
						value={props.config.bankroll}
						onInput={(event) =>
							props.onChange('bankroll', Number(event.currentTarget.value))
						}
					/>
				</SettingsItem>
				<SettingsItem label="Unit" helptext="What one betting unit is worth">
					<input
						type="number"
						min="1"
						step="1"
						value={props.config.unit}
						onInput={(event) => props.onChange('unit', Number(event.currentTarget.value))}
					/>
				</SettingsItem>
			</div>
			<Show when={props.analysis}>
				{(analysis) => (
					<p class="settings-bankroll-tab__kelly">
						Full Kelly at this spread is a{' '}
						{formatCurrency(Math.max(0, analysis().kellyUnit))} unit.
					</p>
				)}
			</Show>
			<SettingsItem
				label="Rounds per hour"
				helptext="Hands played per hour, which scales the hourly figures only"
			>
				<input
					type="number"
					min="1"
					step="1"
					value={props.config.roundsPerHour}
					onInput={(event) =>
						props.onChange('roundsPerHour', Number(event.currentTarget.value))
					}
				/>
			</SettingsItem>
			<SettingsItem
				label="Bet spread"
				helptext="Units wagered at each Hi-Lo-equivalent true count, so a spread means the same advantage under every system; the end columns cover everything beyond them"
			>
				<BetRampEditor ramp={props.config.ramp} onRampChange={setRampUnits} />
			</SettingsItem>
		</div>
	);
};

export default SettingsBankrollTab;
