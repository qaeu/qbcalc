import type { Component } from 'solid-js';
import type { SetStoreFunction } from 'solid-js/store';

import {
	BLACKJACK_PAYOUTS,
	SURRENDERS,
	type BlackjackPayout,
	type Surrender,
} from '#utils/blackjackEv';
import type { CalculatorConfig } from '#utils/storage';

import SettingSelect, { type SettingOption } from '#c/SettingSelect';
import SettingsItem from '#c/SettingsItem';

import '#styles/SettingsRulesTab';

interface SettingsRulesTabProps {
	config: CalculatorConfig;
	setConfig: SetStoreFunction<CalculatorConfig>;
}

const PAYOUT_OPTIONS: readonly SettingOption<BlackjackPayout>[] = BLACKJACK_PAYOUTS.map(
	(payout) => ({ value: payout, label: payout })
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
 * 'Late' and 'ES10' (late against everything but a ten) are therefore not
 * choices such a table can make, and are disabled rather than silently
 * reinterpreted.
 */
const surrenderDisabledUnderEnhc = (surrender: Surrender): boolean =>
	surrender === 'late' || surrender === 'es10';

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

	return (
		<div class="settings-rules-tab">
			<h3>Game Rules</h3>
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
			<SettingsItem
				label="Surrender"
				helptext={
					props.config.dealerPeek ?
						'Whether, and when, the player may surrender a hand'
					:	'Whether the player may surrender a hand. With no hole card there is no dealer check to be late to, so only early surrender is available'
				}
			>
				<SettingSelect
					options={surrenderOptions(!props.config.dealerPeek)}
					value={props.config.surrender}
					onChange={(surrender) => props.setConfig('surrender', surrender)}
				/>
			</SettingsItem>
			<div class="settings-rules-tab__toggle-grid">
				<SettingsItem label="S17" helptext="Dealer stands on soft 17" layout="row">
					<input
						type="checkbox"
						checked={!props.config.dealerHitsSoft17}
						onInput={(event) =>
							props.setConfig('dealerHitsSoft17', !event.currentTarget.checked)
						}
					/>
				</SettingsItem>
				<SettingsItem label="DAS" helptext="Double after split allowed" layout="row">
					<input
						type="checkbox"
						checked={props.config.doubleAfterSplit}
						onInput={(event) =>
							props.setConfig('doubleAfterSplit', event.currentTarget.checked)
						}
					/>
				</SettingsItem>
				<SettingsItem label="RSA" helptext="Resplit aces allowed" layout="row">
					<input
						type="checkbox"
						checked={props.config.resplitAces}
						onInput={(event) =>
							props.setConfig('resplitAces', event.currentTarget.checked)
						}
					/>
				</SettingsItem>
				<SettingsItem
					label="HSA"
					helptext="Split aces may be drawn to, instead of taking one card and standing"
					layout="row"
				>
					<input
						type="checkbox"
						checked={props.config.hitSplitAces}
						onInput={(event) =>
							props.setConfig('hitSplitAces', event.currentTarget.checked)
						}
					/>
				</SettingsItem>
				<SettingsItem
					label="ENHC"
					helptext="No dealer peek; a dealer natural takes all bets, doubles and splits included"
					layout="row"
				>
					<input
						type="checkbox"
						checked={!props.config.dealerPeek}
						onInput={(event) => setEnhc(event.currentTarget.checked)}
					/>
				</SettingsItem>
			</div>
		</div>
	);
};

export default SettingsRulesTab;
