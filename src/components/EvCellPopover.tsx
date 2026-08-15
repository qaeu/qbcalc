import { HoverCard } from '@ark-ui/solid/hover-card';
import { Portal } from 'solid-js/web';
import { Show, type Component } from 'solid-js';

import type { EvCellData } from '#utils/ev/tables';
import {
	formatActionLabel,
	formatCount,
	formatEvPercent,
	formatPercent,
} from '#utils/format';
import { ACTION_CLASS, signClass } from '#utils/actionStyle';

import '#styles/EvTable';

interface EvCellPopoverProps {
	row: EvCellData;
	count: number;
	/**
	 * EV of taking insurance, per unit staked on it, or `undefined` where the
	 * bet isn't on offer -- against any upcard but an ace, or at a table that
	 * doesn't offer it. It belongs to the upcard rather than to the player's
	 * hand, so every ace column cell reports the same figure.
	 */
	insuranceEvPercent?: number;
}

const EvCellPopover: Component<EvCellPopoverProps> = (props) => (
	<Portal>
		<HoverCard.Positioner>
			<HoverCard.Content class="ev-table__popover">
				<HoverCard.Arrow class="ev-table__popover-arrow">
					<HoverCard.ArrowTip class="ev-table__popover-arrow-tip" />
				</HoverCard.Arrow>
				<div class={`ev-table__popover-action ${ACTION_CLASS[props.row.optimalAction]}`}>
					{formatActionLabel(props.row.optimalAction)}
				</div>
				<div class="ev-table__popover-grid">
					<span>EV</span>
					<span class={signClass(props.row.countEvPercent)}>
						{formatEvPercent(props.row.countEvPercent)}%
					</span>
					<Show when={props.count !== 0}>
						<span>{formatCount(props.count)}Δ</span>
						<span class={signClass(props.row.deltaPercentPoints)}>
							{formatEvPercent(props.row.deltaPercentPoints)} pts
						</span>
					</Show>
					<span>Hit bust%</span>
					<span>{formatPercent(props.row.playerBustOnHitPercent)}</span>
					<span>Dealer bust%</span>
					<span>{formatPercent(props.row.dealerBustPercent)}</span>
					<Show when={props.insuranceEvPercent !== undefined}>
						<span>Insurance EV</span>
						<span class={signClass(props.insuranceEvPercent!)}>
							{formatEvPercent(props.insuranceEvPercent!)}%
						</span>
					</Show>
				</div>
			</HoverCard.Content>
		</HoverCard.Positioner>
	</Portal>
);

export default EvCellPopover;
