import { HoverCard } from '@ark-ui/solid/hover-card';
import { Portal } from 'solid-js/web';
import { type Component } from 'solid-js';

import type { EvCellData } from '#utils/blackjackEv';
import { formatEvPercent, formatPercent } from '#utils/format';

import '#styles/EvTable';

interface EvCellPopoverProps {
	row: EvCellData;
}

function signClass(value: number): string | undefined {
	if (value > 0) return 'ev-table__popover-value--positive';
	if (value < 0) return 'ev-table__popover-value--negative';
	return undefined;
}

const EvCellPopover: Component<EvCellPopoverProps> = (props) => (
	<Portal>
		<HoverCard.Positioner>
			<HoverCard.Content class="ev-table__popover">
				<HoverCard.Arrow class="ev-table__popover-arrow">
					<HoverCard.ArrowTip class="ev-table__popover-arrow-tip" />
				</HoverCard.Arrow>
				<div class="ev-table__popover-grid">
					<span>EV</span>
					<span class={signClass(props.row.countEvPercent)}>
						{formatEvPercent(props.row.countEvPercent)}%
					</span>
					<span>Δ</span>
					<span class={signClass(props.row.deltaPercentPoints)}>
						{formatEvPercent(props.row.deltaPercentPoints)} pts
					</span>
					<span>Hit bust%</span>
					<span>{formatPercent(props.row.playerBustOnHitPercent)}</span>
					<span>Dealer bust%</span>
					<span>{formatPercent(props.row.dealerBustPercent)}</span>
				</div>
			</HoverCard.Content>
		</HoverCard.Positioner>
	</Portal>
);

export default EvCellPopover;
