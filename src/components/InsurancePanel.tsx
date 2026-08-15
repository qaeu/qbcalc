/**
 * The insurance side bet, which is one number per shoe rather than a grid: how
 * dense the tens are behind a dealer ace, and whether that makes the 2:1 bet
 * worth taking at the current count. Rendered only where the table offers the
 * bet -- `EvTable` decides that; the panel itself always describes an offer.
 */

import { Show, type Component } from 'solid-js';

import type { InsuranceAnalysis } from '#utils/ev/insurance';
import { formatCount, formatEvPercent, formatPercent } from '#utils/format';
import { signClass } from '#utils/actionStyle';

import '#styles/InsurancePanel';

interface InsurancePanelProps {
	insurance: InsuranceAnalysis;
	count: number;
	loading: boolean;
}

const InsurancePanel: Component<InsurancePanelProps> = (props) => {
	// The bet is worth taking only strictly above break-even; at exactly break
	// even it is a coin flip, and declining is the standing recommendation.
	const take = () => props.insurance.countEvPercent > 0;

	return (
		<div class="insurance-panel" classList={{ 'is-loading': props.loading }}>
			<div class="insurance-panel__head">
				<h3>Insurance</h3>
				<span
					class="insurance-panel__verdict"
					classList={{ 'is-take': take(), 'is-decline': !take() }}
				>
					{take() ? 'Take' : 'Decline'}
				</span>
			</div>
			<dl class="insurance-panel__stats">
				<div>
					<dt>EV</dt>
					<dd class={signClass(props.insurance.countEvPercent)}>
						{formatEvPercent(props.insurance.countEvPercent)}%
					</dd>
				</div>
				<Show when={props.count !== 0}>
					<div>
						<dt>{formatCount(props.count)}Δ</dt>
						<dd class={signClass(props.insurance.deltaPercentPoints)}>
							{formatEvPercent(props.insurance.deltaPercentPoints)} pts
						</dd>
					</div>
				</Show>
				<div>
					<dt>Hole card ten</dt>
					<dd>{formatPercent(props.insurance.tenPercent)}</dd>
				</div>
			</dl>
		</div>
	);
};

export default InsurancePanel;
