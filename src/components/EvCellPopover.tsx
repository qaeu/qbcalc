import { HoverCard } from '@ark-ui/solid/hover-card';
import { Portal } from 'solid-js/web';
import { type Component } from 'solid-js';

import type { EvComparisonRow, PlayerAction } from '#utils/blackjackEv';
import { formatEvPercent, formatPercent } from '#utils/format';

import '#styles/EvTable';

const ACTION_LABELS: Record<PlayerAction, string> = {
	H: 'Hit',
	S: 'Stand',
	D: 'Double',
};

interface EvCellPopoverProps {
	row: EvComparisonRow;
}

const EvCellPopover: Component<EvCellPopoverProps> = (props) => (
	<Portal>
		<HoverCard.Positioner>
			<HoverCard.Content class="ev-table__popover">
				<HoverCard.Arrow class="ev-table__popover-arrow">
					<HoverCard.ArrowTip class="ev-table__popover-arrow-tip" />
				</HoverCard.Arrow>
				<p>Optimal-action EV: {formatEvPercent(props.row.countEvPercent)}%</p>
				<p>Δ vs. baseline: {formatEvPercent(props.row.deltaPercentPoints)} pts</p>
				<p>Optimal play: {ACTION_LABELS[props.row.optimalAction]}</p>
				<p>Player bust% on hit: {formatPercent(props.row.playerBustOnHitPercent)}</p>
				<p>Dealer bust%: {formatPercent(props.row.dealerBustPercent)}</p>
			</HoverCard.Content>
		</HoverCard.Positioner>
	</Portal>
);

export default EvCellPopover;
