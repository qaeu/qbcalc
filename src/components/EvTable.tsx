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
	row: EvCellData | undefined;
	loading: boolean;
	phase: number;
}

const ACTION_CLASS: Record<PlayerAction, string> = {
	H: 'is-hit',
	S: 'is-stand',
	D: 'is-double',
	P: 'is-split',
	R: 'is-surrender',
};

/**
 * One `<td>` that persists across the loading state rather than being swapped
 * out for a separate skeleton cell. Only its class changes, which is what lets
 * the background colour transition between one calculation and the next — a
 * replaced element would mount at its final colour with nothing to animate.
 */
const EvCell: Component<EvCellProps> = (props) => {
	const activeRow = createMemo(() => (props.loading ? undefined : props.row));

	const cellClass = createMemo(() => {
		if (props.loading) return `is-loading ev-table__loading-phase-${props.phase}`;
		const row = props.row;
		return row ? ACTION_CLASS[row.optimalAction] : '';
	});

	return (
		<HoverCard.Root openDelay={0} closeDelay={0} positioning={{ placement: 'bottom' }}>
			<HoverCard.Trigger
				asChild={(triggerProps) => (
					<td {...triggerProps()} tabIndex={activeRow() ? 0 : -1} class={cellClass()}>
						<Show
							when={!props.loading}
							fallback={<span class="ev-table__cell-skeleton" aria-hidden="true" />}
						>
							{props.row?.optimalAction ?? '—'}
						</Show>
					</td>
				)}
			/>
			{/*
			 * Deliberately keyed off `row` rather than the loading state. The app
			 * never clears `result` while recomputing, so the previous row data is
			 * still here throughout and the popover subtree stays mounted across
			 * the whole cycle. Gating it on `loading` instead meant every
			 * calculation tore down and rebuilt a Portal and an Ark positioner for
			 * every cell, all in the same tick as the class change that is supposed
			 * to be transitioning. Hovering is blocked by CSS while loading.
			 */}
			<Show when={props.row}>{(row) => <EvCellPopover row={row()} />}</Show>
		</HoverCard.Root>
	);
};

const LOADING_PHASE_COUNT = 12;
const PHASE_HASH_PRIME = 2654435761;

// Folded into each grid's seed so the three tables scatter differently rather
// than repeating one pattern down the page. Arbitrary, just mutually distinct.
const GRID_SALTS = {
	hard: 0x9e3779b9,
	soft: 0x85ebca6b,
	split: 0xc2b2ae35,
} as const;

/**
 * Scatters each cell across the pulse cycle, so the skeletons twinkle
 * independently instead of sweeping through the table as a wave. Hashed rather
 * than drawn per cell so a cell keeps its phase across re-renders; the seed
 * carries the per-grid salt and the per-run randomness.
 */
function loadingPhase(seed: number, rowIndex: number, colIndex: number): number {
	let hash = Math.imul(seed ^ PHASE_HASH_PRIME, PHASE_HASH_PRIME);
	hash = Math.imul(hash ^ (rowIndex * 31 + colIndex + 1), PHASE_HASH_PRIME);
	// Without this avalanche round adjacent cells collide ~38% more often than
	// chance, which reads as visible clumping rather than an even twinkle.
	hash = Math.imul(hash ^ (hash >>> 15), PHASE_HASH_PRIME);
	return (hash >>> 16) % LOADING_PHASE_COUNT;
}

interface EvGridProps {
	title: string;
	rowHeading: string;
	totals: readonly number[];
	upcards: readonly Rank[];
	rowsByKey: Map<string, EvCellData>;
	loading: boolean;
	seed: number;
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
						{(total, rowIndex) => (
							<tr>
								<th scope="row">{props.rowLabel ? props.rowLabel(total) : total}</th>
								<For each={props.upcards}>
									{(upcard, colIndex) => (
										<EvCell
											row={props.rowsByKey.get(cellKey(total, upcard))}
											loading={props.loading}
											phase={loadingPhase(props.seed, rowIndex(), colIndex())}
										/>
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
	seed: number;
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
						{(pairRank, rowIndex) => (
							<tr>
								<th scope="row">{formatPairLabel(pairRank)}</th>
								<For each={props.upcards}>
									{(upcard, colIndex) => (
										<EvCell
											row={props.rowsByKey.get(cellKey(pairRank, upcard))}
											loading={props.loading}
											phase={loadingPhase(props.seed, rowIndex(), colIndex())}
										/>
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
	// Redrawn each time a calculation starts, so consecutive runs don't replay
	// the same scatter. It holds its value while results are on screen, which
	// keeps a cell's phase stable for as long as the skeleton is visible.
	const runSeed = createMemo<number>(
		(previous) =>
			props.isComputing() ? Math.floor(Math.random() * 0x100000000) : previous,
		0
	);

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
					seed={runSeed() ^ GRID_SALTS.hard}
				/>
				<EvGrid
					title="Soft totals"
					rowHeading="Soft total"
					totals={SOFT_TOTALS}
					upcards={RANKS}
					rowsByKey={softRowsByKey()}
					rowLabel={formatSoftTotalLabel}
					loading={props.isComputing()}
					seed={runSeed() ^ GRID_SALTS.soft}
				/>
				<SplitEvGrid
					title="Pairs"
					pairRanks={PAIR_RANKS}
					upcards={RANKS}
					rowsByKey={splitRowsByKey()}
					loading={props.isComputing()}
					seed={runSeed() ^ GRID_SALTS.split}
				/>
			</Show>
		</section>
	);
};

export default EvTable;
