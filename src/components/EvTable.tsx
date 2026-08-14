import { HoverCard } from '@ark-ui/solid/hover-card';
import {
	createMemo,
	createSignal,
	For,
	Show,
	type Accessor,
	type Component,
} from 'solid-js';

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
import { ACTION_CLASS } from '#utils/actionStyle';
import type { EvWorkerResult } from '#utils/evWorkerProtocol';

import EvCellDialog from '#c/EvCellDialog';
import EvCellPopover from '#c/EvCellPopover';

import '#styles/EvTable';

function cellKey(rowId: number | Rank, upcard: Rank): string {
	return `${rowId}-${upcard}`;
}

interface EvCellProps {
	row: EvCellData | undefined;
	loading: boolean;
	phase: number;
	count: number;
	/** The player's hand as the grid labels it, for the drill-down's heading. */
	hand: string;
	upcard: Rank;
}

/**
 * Ring colour for a cell the count has moved off basic strategy. The fill
 * carries the action to take now, so the ring carries the action it replaced —
 * both are legible at once without a second glyph.
 */
const BASE_ACTION_CLASS: Record<PlayerAction, string> = {
	H: 'was-hit',
	S: 'was-stand',
	D: 'was-double',
	P: 'was-split',
	R: 'was-surrender',
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
		if (!row) return '';
		const action = ACTION_CLASS[row.optimalAction];
		return row.baseAction === row.optimalAction ?
				action
			:	`${action} ${BASE_ACTION_CLASS[row.baseAction]}`;
	});

	const [hoverOpen, setHoverOpen] = createSignal(false);
	const [dialogOpen, setDialogOpen] = createSignal(false);
	/**
	 * Holds the hover card shut from the moment the dialog opens until the
	 * pointer next arrives on the cell.
	 *
	 * Suppressing it only while the dialog is up isn't enough. The pointer is
	 * over the backdrop, not the cell, so nothing tells the card to close, and
	 * Zag hands focus back to the cell as the dialog goes away -- which the card
	 * reads as another reason to open. Either way it comes back up over a cell
	 * the pointer has long since left, and stays there while other cells open
	 * cards of their own.
	 */
	const [hoverSuppressed, setHoverSuppressed] = createSignal(false);
	// The dialog's machine, its Portal and its focus trap are worth one cell's
	// worth of setup, not three hundred, so it stays unmounted until the cell is
	// first opened -- and then stays mounted, so closing it is a state change
	// rather than a teardown racing Zag's own focus restoration.
	const [dialogMounted, setDialogMounted] = createSignal(false);

	const openDialog = () => {
		// Nothing to drill into mid-recalculation. CSS already blocks the
		// pointer over a loading cell; this covers a cell that was focused
		// before the recalculation started.
		if (!activeRow()) return;
		setHoverSuppressed(true);
		setDialogMounted(true);
		setDialogOpen(true);
	};

	return (
		<HoverCard.Root
			openDelay={0}
			closeDelay={0}
			positioning={{ placement: 'bottom' }}
			// Controlled purely so the dialog can take the card's place rather
			// than open on top of it: the card describes the very cell the dialog
			// is already describing in full.
			open={hoverOpen() && !hoverSuppressed()}
			onOpenChange={(details) => setHoverOpen(details.open)}
		>
			<HoverCard.Trigger
				asChild={(triggerProps) => (
					<td
						{...triggerProps()}
						tabIndex={activeRow() ? 0 : -1}
						class={cellClass()}
						aria-haspopup="dialog"
						// Lifts the suppression above on the pointer's next arrival.
						// `pointerover` rather than `pointerenter` because the hover
						// card's own trigger props already carry the latter, and
						// declaring it again after the spread would replace theirs.
						onPointerOver={() => setHoverSuppressed(false)}
						onClick={openDialog}
						onKeyDown={(event) => {
							if (event.key !== 'Enter' && event.key !== ' ') return;
							// Space would otherwise scroll the page out from under the dialog.
							event.preventDefault();
							openDialog();
						}}
					>
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
			<Show when={props.row}>
				{(row) => (
					<>
						<EvCellPopover row={row()} count={props.count} />
						<Show when={dialogMounted()}>
							<EvCellDialog
								row={row()}
								count={props.count}
								hand={props.hand}
								upcard={props.upcard}
								open={dialogOpen()}
								onOpenChange={setDialogOpen}
							/>
						</Show>
					</>
				)}
			</Show>
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
	count: number;
	rowLabel?: (total: number) => string;
	/**
	 * How the drill-down names a row's hand. Defaults to the row heading itself,
	 * which reads as a label in the leftmost column ("16") but needs its kind
	 * spelling out once it's a heading on its own ("Hard 16").
	 */
	handLabel?: (total: number) => string;
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
											count={props.count}
											hand={
												props.handLabel ? props.handLabel(total)
												: props.rowLabel ?
													props.rowLabel(total)
												:	String(total)
											}
											upcard={upcard}
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
	count: number;
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
											count={props.count}
											hand={formatPairLabel(pairRank)}
											upcard={upcard}
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
	count: Accessor<number>;
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
					handLabel={(total) => `Hard ${total}`}
					loading={props.isComputing()}
					seed={runSeed() ^ GRID_SALTS.hard}
					count={props.count()}
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
					count={props.count()}
				/>
				<SplitEvGrid
					title="Pairs"
					pairRanks={PAIR_RANKS}
					upcards={RANKS}
					rowsByKey={splitRowsByKey()}
					loading={props.isComputing()}
					seed={runSeed() ^ GRID_SALTS.split}
					count={props.count()}
				/>
			</Show>
		</section>
	);
};

export default EvTable;
