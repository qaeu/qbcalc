/**
 * The game a run is dealt under, printed above the run itself: the rules, the
 * counting system and the bankroll settings the sidebar owns. A result is never
 * read without the game that produced it -- an edge means nothing until the shoe,
 * the penetration and the spread behind it are named.
 */

import { For, type Component } from 'solid-js';

import { RAMP_LABELS } from '#utils/bankroll';
import { labelForSystem, type CountingSystemId } from '#utils/countingSystems';
import type { RuleSet } from '#utils/ev/rules';
import { formatCurrency, formatUnits } from '#utils/format';
import type { BankrollConfig } from '#utils/storage';

import '#styles/SimSetup';

interface SimSetupProps {
	ruleSet: RuleSet;
	system: CountingSystemId;
	bankroll: BankrollConfig;
}

/** The bet ramp written the way a counter says it: the units, low to high. */
function rampLabel(ramp: readonly number[]): string {
	const spread = ramp.map(formatUnits).join('–');
	return `${spread} units`;
}

const SimSetup: Component<SimSetupProps> = (props) => {
	const chips = (): string[] => [
		`${props.ruleSet.decks} decks`,
		props.ruleSet.dealerHitsSoft17 ? 'H17' : 'S17',
		`${props.ruleSet.penetrationPercent}% pen`,
		`BJ ${props.ruleSet.blackjackPayout}`,
		labelForSystem(props.system),
		`${formatCurrency(props.bankroll.unit).replace('+', '')} unit`,
		rampLabel(props.bankroll.ramp),
		`${props.bankroll.roundsPerHour} rounds/hr`,
	];

	return (
		<section class="sim-setup">
			<h2 class="sim-setup__title">The game</h2>
			<ul class="sim-setup__chips">
				<For each={chips()}>{(chip) => <li class="sim-setup__chip">{chip}</li>}</For>
			</ul>
			<p class="sim-setup__hint">
				Dealt under the rules, counting system and bankroll settings in the settings panel
				— the spread runs across {RAMP_LABELS[0]} to {RAMP_LABELS.at(-1)}. Change them
				there and run again.
			</p>
		</section>
	);
};

export default SimSetup;
