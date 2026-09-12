import { createMemo, type Component } from 'solid-js';
import type { SetStoreFunction } from 'solid-js/store';

import {
	BLACKJACK_PAYOUTS,
	SURRENDERS,
	type BlackjackPayout,
	type Surrender,
} from '#utils/ev/rules';
import {
	presetForRules,
	RULE_PRESETS,
	rulesForPreset,
	type RulePresetId,
} from '#utils/settings/rulePresets';
import { ruleSetFromConfig, type CalculatorSettings } from '#utils/settings/storage';

import SettingSelect, { type SettingOption } from '#c/settings/SettingSelect';
import SettingsItem from '#c/settings/SettingsItem';
import SettingToggle from '#c/settings/SettingToggle';

import '#styles/settings/SettingsRulesTab';

interface SettingsRulesTabProps {
	/**
	 * The settings alone. The true count is not one of them -- it is the app's,
	 * moved by the arrow keys -- so the rules are read out of a config without it
	 * and `ruleSetFromConfig` is handed a placeholder for the field it ignores.
	 */
	config: CalculatorSettings;
	setConfig: SetStoreFunction<CalculatorSettings>;
}

const PAYOUT_OPTIONS: readonly SettingOption<BlackjackPayout>[] = BLACKJACK_PAYOUTS.map(
	(payout) => ({ value: payout, label: payout })
);

/**
 * 'Custom' is shown but never selectable: it is the name the rules go by once
 * they match no preset, and it has no rule set of its own to switch to.
 */
const PRESET_OPTIONS: readonly SettingOption<RulePresetId>[] = RULE_PRESETS.map(
	(preset) => ({
		value: preset.id,
		label: preset.label,
		disabled: preset.rules === null,
	})
);

const SURRENDER_LABELS: Record<Surrender, string> = {
	early: 'Early',
	es10: 'ES10',
	late: 'Late',
	none: 'None',
};

/**
 * A no-hole-card table has no peek to be late to: the stake is off the table
 * before the dealer draws, so every surrender it offers is an early one.
 * 'Late' is therefore not a choice such a table can make, and is disabled
 * rather than silently reinterpreted. 'ES10' -- surrender against a ten and
 * nothing else, taken before any check -- is early by construction, so it
 * stays available.
 */
const surrenderDisabledUnderEnhc = (surrender: Surrender): boolean =>
	surrender === 'late';

const surrenderOptions = (enhc: boolean): readonly SettingOption<Surrender>[] =>
	SURRENDERS.map((surrender) => ({
		value: surrender,
		label: SURRENDER_LABELS[surrender],
		disabled: enhc && surrenderDisabledUnderEnhc(surrender),
	}));

const SettingsRulesTab: Component<SettingsRulesTabProps> = (props) => {
	/**
	 * Turning ENHC on can invalidate the current surrender setting, so it
	 * moves to the one a no-hole-card table would actually be offering:
	 * 'early'. Leaving it on a disabled value would show the select stuck on
	 * an option the list greys out.
	 */
	const setEnhc = (enhc: boolean) => {
		props.setConfig('dealerPeek', !enhc);
		if (enhc && surrenderDisabledUnderEnhc(props.config.surrender)) {
			props.setConfig('surrender', 'early');
		}
	};

	// Derived rather than stored: the rules are the single source of truth for
	// which preset is selected, so editing any one of them drops the select to
	// 'Custom' on its own.
	const preset = createMemo(() =>
		presetForRules(ruleSetFromConfig({ ...props.config, trueCount: 0 }))
	);

	const setPreset = (id: RulePresetId) => {
		const rules = rulesForPreset(id);
		if (rules) props.setConfig(rules);
	};

	return (
		<div class="settings-rules-tab">
			<h3>Game Rules</h3>
			<SettingsItem
				label="Preset"
				helptext="A named table's rules, or Custom once any rule is hand-edited"
			>
				<SettingSelect options={PRESET_OPTIONS} value={preset()} onChange={setPreset} />
			</SettingsItem>
			<div class="settings-rules-tab__field-grid">
				<SettingsItem label="Decks" helptext="Number of decks in the shoe">
					<input
						type="number"
						min="1"
						max="8"
						value={props.config.decks}
						onInput={(event) =>
							props.setConfig('decks', Number(event.currentTarget.value))
						}
					/>
				</SettingsItem>
				<SettingsItem
					label="Penetration %"
					helptext="Percent of the shoe dealt before it's shuffled and the count reset"
				>
					<input
						type="number"
						min="1"
						max="100"
						step="1"
						value={props.config.penetrationPercent}
						onInput={(event) =>
							props.setConfig('penetrationPercent', Number(event.currentTarget.value))
						}
					/>
				</SettingsItem>
				<SettingsItem
					label="Split limit"
					helptext="Maximum number of hands allowed from repeated splits"
				>
					<input
						type="number"
						min="1"
						max="4"
						step="1"
						value={props.config.splitLimit}
						onInput={(event) =>
							props.setConfig('splitLimit', Number(event.currentTarget.value))
						}
					/>
				</SettingsItem>
			</div>
			<SettingsItem
				label="BJ payout"
				helptext="Payout for a player blackjack, as a ratio of the bet"
			>
				<SettingSelect
					options={PAYOUT_OPTIONS}
					value={props.config.blackjackPayout}
					onChange={(payout) => props.setConfig('blackjackPayout', payout)}
				/>
			</SettingsItem>
			<SettingsItem label="Surrender" helptext="Type of surrender action allowed">
				<SettingSelect
					options={surrenderOptions(!props.config.dealerPeek)}
					value={props.config.surrender}
					onChange={(surrender) => props.setConfig('surrender', surrender)}
				/>
			</SettingsItem>
			<div class="settings-rules-tab__toggle-grid">
				<SettingToggle
					label="S17"
					helptext="Dealer stands on soft 17"
					checked={!props.config.dealerHitsSoft17}
					onChange={(checked) => props.setConfig('dealerHitsSoft17', !checked)}
				/>
				<SettingToggle
					label="DAS"
					helptext="Double after split allowed"
					checked={props.config.doubleAfterSplit}
					onChange={(checked) => props.setConfig('doubleAfterSplit', checked)}
				/>
				<SettingToggle
					label="RSA"
					helptext="Resplit aces allowed"
					checked={props.config.resplitAces}
					onChange={(checked) => props.setConfig('resplitAces', checked)}
				/>
				<SettingToggle
					label="HSA"
					helptext="Hit split aces allowed"
					checked={props.config.hitSplitAces}
					onChange={(checked) => props.setConfig('hitSplitAces', checked)}
				/>
				<SettingToggle
					label="INS"
					helptext="Insurance offered 2:1 on ace upcard"
					checked={props.config.insurance}
					onChange={(checked) => props.setConfig('insurance', checked)}
				/>
				<SettingToggle
					label="ENHC"
					helptext="European no hole card; dealer natural takes all bets"
					checked={!props.config.dealerPeek}
					onChange={setEnhc}
				/>
			</div>
		</div>
	);
};

export default SettingsRulesTab;
