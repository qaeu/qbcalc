/**
 * The game a run is dealt under, printed above the run itself: the rules, the
 * counting system and the bankroll settings the sidebar owns. A result is never
 * read without the game that produced it -- an edge means nothing until the shoe,
 * the penetration and the spread behind it are named.
 */

import { For, type Component } from 'solid-js';

import { RAMP_LABELS } from '#utils/bankroll';
import { labelForSystem, type CountingSystemId } from '#utils/countingSystems';
import type { PrecisionId } from '#utils/ev/precision';
import type { RuleSet } from '#utils/ev/rules';
import { formatCurrency, formatUnits } from '#utils/format';
import type { BankrollConfig } from '#utils/storage';

import '#styles/SimSetup';

interface SimSetupProps {
	ruleSet: RuleSet;
	system: CountingSystemId;
	bankroll: BankrollConfig;
	/** The precision the next run's grids will be priced at. */
	precision: PrecisionId;
}

/** One reading on the layout line, accented where it is not the ordinary one. */
interface Chip {
	label: string;
	accent?: boolean;
}

/** The bet ramp written the way a counter says it: the units, low to high. */
function rampLabel(ramp: readonly number[]): string {
	const spread = ramp.map(formatUnits).join('–');
	return `${spread} units`;
}

const SimSetup: Component<SimSetupProps> = (props) => {
	const chips = (): Chip[] => [
		{ label: `${props.ruleSet.decks} decks` },
		{ label: props.ruleSet.dealerHitsSoft17 ? 'H17' : 'S17' },
		{ label: `${props.ruleSet.penetrationPercent}% pen` },
		{ label: `BJ ${props.ruleSet.blackjackPayout}` },
		{ label: labelForSystem(props.system) },
		{ label: `${formatCurrency(props.bankroll.unit).replace('+', '')} unit` },
		{ label: rampLabel(props.bankroll.ramp) },
		{ label: `${props.bankroll.roundsPerHour} rounds/hr` },
		// Last, and accented where it is not the default: it is the one reading
		// here that is about how the run is priced rather than what is dealt.
		{ label: props.precision === 'full' ? 'Full' : 'Fast', accent: true },
	];

	return (
		<section class="sim-setup">
			<h2 class="sim-setup__title">The game</h2>
			<ul class="sim-setup__chips">
				<For each={chips()}>
					{(chip) => (
						<li
							class="sim-setup__chip"
							classList={{ 'sim-setup__chip--accent': chip.accent }}
						>
							{chip.label}
						</li>
					)}
				</For>
			</ul>
			<p class="sim-setup__hint">
				Dealt under the rules, counting system and bankroll settings in the settings panel
				— the spread runs across {RAMP_LABELS[0]} to {RAMP_LABELS.at(-1)}. Change them
				there and run again. Grids are priced fast unless the sidebar's full calculation
				is the last thing to have run.
			</p>
		</section>
	);
};

export default SimSetup;
