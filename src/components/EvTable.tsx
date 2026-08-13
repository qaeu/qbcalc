import { HoverCard } from '@ark-ui/solid/hover-card';
import { createMemo, For, Show, type Accessor, type Component } from 'solid-js';

import {
	HARD_TOTALS,
	PAIR_RANKS,
	RANKS,
	SOFT_TOTALS,
	type EvCellData,
	type PlayerAction,
	type Rank,
} from '#utils/blackjackEv';
import { formatPairLabel, formatSoftTotalLabel } from '#utils/format';
import type { EvWorkerResult } from '#utils/evWorkerProtocol';

import EvCellPopover from '#c/EvCellPopover';

import '#styles/EvTable';

function cellKey(rowId: number | Rank, upcard: Rank): string {
	return `${rowId}-${upcard}`;
}

interface EvCellProps {
	row: EvCellData;
}

const ACTION_CLASS: Record<PlayerAction, string> = {
	H: 'is-hit',
	S: 'is-stand',
	D: 'is-double',
	P: 'is-split',
	R: 'is-surrender',
};

const EvCell: Component<EvCellProps> = (props) => {
	return (
		<HoverCard.Root openDelay={0} closeDelay={0} positioning={{ placement: 'bottom' }}>
			<HoverCard.Trigger
				asChild={(triggerProps) => (
					<td
						{...triggerProps()}
						tabIndex={0}
						class={ACTION_CLASS[props.row.optimalAction]}
					>
						{props.row.optimalAction}
					</td>
				)}
			/>
			<EvCellPopover row={props.row} />
		</HoverCard.Root>
	);
};

const LoadingCell: Component = () => (
	<td class="is-loading">
		<span class="ev-table__cell-skeleton" aria-hidden="true" />
	</td>
);

interface EvGridProps {
	title: string;
	rowHeading: string;
	totals: readonly number[];
	upcards: readonly Rank[];
	rowsByKey: Map<string, EvCellData>;
	loading: boolean;
	rowLabel?: (total: number) => string;
}

const EvGrid: Component<EvGridProps> = (props) => (
	<div class="ev-table__grid">
		<h3>{props.title}</h3>
		<div class="ev-table__grid-scroll">
			<table>
				<thead>
					<tr>
						<th scope="col" aria-label={props.rowHeading} />
						<For each={props.upcards}>{(upcard) => <th scope="col">{upcard}</th>}</For>
					</tr>
				</thead>
				<tbody>
					<For each={props.totals}>
						{(total) => (
							<tr>
								<th scope="row">{props.rowLabel ? props.rowLabel(total) : total}</th>
								<For each={props.upcards}>
									{(upcard) => (
										<Show when={!props.loading} fallback={<LoadingCell />}>
											<Show
												when={props.rowsByKey.get(cellKey(total, upcard))}
												fallback={<td>—</td>}
											>
												{(row) => <EvCell row={row()} />}
											</Show>
										</Show>
									)}
								</For>
							</tr>
						)}
					</For>
				</tbody>
			</table>
		</div>
	</div>
);

interface SplitEvGridProps {
	title: string;
	pairRanks: readonly Rank[];
	upcards: readonly Rank[];
	rowsByKey: Map<string, EvCellData>;
	loading: boolean;
}

const SplitEvGrid: Component<SplitEvGridProps> = (props) => (
	<div class="ev-table__grid">
		<h3>{props.title}</h3>
		<div class="ev-table__grid-scroll">
			<table>
				<thead>
					<tr>
						<th scope="col" aria-label="Pair" />
						<For each={props.upcards}>{(upcard) => <th scope="col">{upcard}</th>}</For>
					</tr>
				</thead>
				<tbody>
					<For each={props.pairRanks}>
						{(pairRank) => (
							<tr>
								<th scope="row">{formatPairLabel(pairRank)}</th>
								<For each={props.upcards}>
									{(upcard) => (
										<Show when={!props.loading} fallback={<LoadingCell />}>
											<Show
												when={props.rowsByKey.get(cellKey(pairRank, upcard))}
												fallback={<td>—</td>}
											>
												{(row) => <EvCell row={row()} />}
											</Show>
										</Show>
									)}
								</For>
							</tr>
						)}
					</For>
				</tbody>
			</table>
		</div>
	</div>
);

interface EvTableProps {
	result: Accessor<EvWorkerResult | null>;
	isComputing: Accessor<boolean>;
	error: Accessor<string | null>;
}

const EvTable: Component<EvTableProps> = (props) => {
	const hardRowsByKey = createMemo(() => {
		const map = new Map<string, EvCellData>();
		for (const row of props.result()?.hard.rows ?? []) {
			map.set(cellKey(row.total, row.upcard), row);
		}
		return map;
	});

	const softRowsByKey = createMemo(() => {
		const map = new Map<string, EvCellData>();
		for (const row of props.result()?.soft.rows ?? []) {
			map.set(cellKey(row.total, row.upcard), row);
		}
		return map;
	});

	const splitRowsByKey = createMemo(() => {
		const map = new Map<string, EvCellData>();
		for (const row of props.result()?.split.rows ?? []) {
			map.set(cellKey(row.pairRank, row.upcard), row);
		}
		return map;
	});

	return (
		<section class="ev-table">
			<Show when={props.error()}>
				{(message) => <p class="ev-table__error">{message()}</p>}
			</Show>

			<Show when={!props.error()}>
				<EvGrid
					title="Hard totals"
					rowHeading="Hard total"
					totals={HARD_TOTALS}
					upcards={RANKS}
					rowsByKey={hardRowsByKey()}
					loading={props.isComputing()}
				/>
				<EvGrid
					title="Soft totals"
					rowHeading="Soft total"
					totals={SOFT_TOTALS}
					upcards={RANKS}
					rowsByKey={softRowsByKey()}
					rowLabel={formatSoftTotalLabel}
					loading={props.isComputing()}
				/>
				<SplitEvGrid
					title="Pairs"
					pairRanks={PAIR_RANKS}
					upcards={RANKS}
					rowsByKey={splitRowsByKey()}
					loading={props.isComputing()}
				/>
			</Show>
		</section>
	);
};

export default EvTable;
