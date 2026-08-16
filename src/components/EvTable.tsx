import { HoverCard } from '@ark-ui/solid/hover-card';
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	Show,
	type Accessor,
	type Component,
} from 'solid-js';

import type { BankrollAnalysis } from '#utils/bankroll';
import { RANKS, type Rank } from '#utils/ev/cards';
import { HARD_TOTALS, PAIR_RANKS, SOFT_TOTALS, type PlayerAction } from '#utils/ev/rules';
import type { EvCellData } from '#utils/ev/tables';
import { formatCount, formatPairLabel, formatSoftTotalLabel } from '#utils/format';
import { ACTION_CLASS } from '#utils/actionStyle';
import {
	CELL_DISPLAY_MODE_LABELS,
	cellDisplayText,
	evHeatClass,
	nextCellDisplayMode,
	occurrenceHeatClass,
	type CellDisplayMode,
} from '#utils/cellDisplay';
import { createGlobalKeydown, isKeyConsumingTarget } from '#utils/keyboard';
import { loadingPhase } from '#utils/loadingPhase';
import { loadCellDisplayMode, saveCellDisplayMode } from '#utils/storage';
import type { EvWorkerResult } from '#utils/evWorkerProtocol';

import CountFrequencyGraph, { type CountFrequencyProfile } from '#c/CountFrequencyGraph';
import EvCellDialog from '#c/EvCellDialog';
import EvCellPopover from '#c/EvCellPopover';
import EvSummary from '#c/EvSummary';

import '#styles/EvTable';

function cellKey(rowId: number | Rank, upcard: Rank): string {
	return `${rowId}-${upcard}`;
}

/**
 * The extremes the heat ramps are scaled against. Taken across all three grids
 * at once rather than per grid, so a colour means the same number wherever it
 * appears -- a pair's EV can be read against a hard total's without rescaling.
 */
interface HeatDomains {
	ev: number;
	occurrence: number;
}

interface EvCellProps {
	row: EvCellData | undefined;
	loading: boolean;
	phase: number;
	trueCount: number;
	mode: CellDisplayMode;
	heat: HeatDomains;
	/** The player's hand as the grid labels it, for the drill-down's heading. */
	hand: string;
	upcard: Rank;
	/**
	 * EV of insurance at this count, where the table offers it. It is a property
	 * of the upcard, so only the ace column reports it.
	 */
	insuranceEvPercent?: number;
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

	/**
	 * The fill the mode calls for: the action's colour, or the cell's place on
	 * one of the heat ramps. The numeric modes also take `is-numeric`, which
	 * buys the wider strings their room back.
	 */
	const fillClass = createMemo(() => {
		const row = props.row;
		if (!row) return '';
		switch (props.mode) {
			case 'action':
				return ACTION_CLASS[row.optimalAction];
			case 'ev':
				return `is-numeric ${evHeatClass(row.countEvPercent, props.heat.ev)}`;
			case 'occurrence':
				return `is-numeric ${occurrenceHeatClass(
					row.occurrencePercent,
					props.heat.occurrence
				)}`;
		}
	});

	const cellClass = createMemo(() => {
		if (props.loading) return `is-loading ev-table__loading-phase-${props.phase}`;
		const row = props.row;
		if (!row) return '';
		// The deviation ring only makes sense in the action mode: it marks a
		// change in letter, which is meaningless dressing on top of the EV and
		// occurrence heat ramps.
		return props.mode === 'action' && row.baseAction !== row.optimalAction ?
				`${fillClass()} ${BASE_ACTION_CLASS[row.baseAction]}`
			:	fillClass();
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
						// Enter alone: space belongs to the table-wide display mode
						// cycle, which stays available with a cell focused.
						onKeyDown={(event) => {
							if (event.key !== 'Enter') return;
							event.preventDefault();
							openDialog();
						}}
					>
						<Show
							when={!props.loading}
							fallback={<span class="ev-table__cell-skeleton" aria-hidden="true" />}
						>
							{props.row ? cellDisplayText(props.row, props.mode) : '—'}
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
						<EvCellPopover
							row={row()}
							trueCount={props.trueCount}
							insuranceEvPercent={
								props.upcard === 'A' ? props.insuranceEvPercent : undefined
							}
						/>
						<Show when={dialogMounted()}>
							<EvCellDialog
								row={row()}
								trueCount={props.trueCount}
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

// Folded into each grid's seed so the three tables scatter differently rather
// than repeating one pattern down the page. Arbitrary, just mutually distinct.
const GRID_SALTS = {
	hard: 0x9e3779b9,
	soft: 0x85ebca6b,
	split: 0xc2b2ae35,
	summary: 0x27d4eb2f,
	frequency: 0x165667b1,
} as const;

interface EvGridProps {
	title: string;
	rowHeading: string;
	totals: readonly number[];
	upcards: readonly Rank[];
	rowsByKey: Map<string, EvCellData>;
	loading: boolean;
	seed: number;
	trueCount: number;
	mode: CellDisplayMode;
	heat: HeatDomains;
	insuranceEvPercent?: number;
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
											trueCount={props.trueCount}
											mode={props.mode}
											heat={props.heat}
											hand={
												props.handLabel ? props.handLabel(total)
												: props.rowLabel ?
													props.rowLabel(total)
												:	String(total)
											}
											upcard={upcard}
											insuranceEvPercent={props.insuranceEvPercent}
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
	trueCount: number;
	mode: CellDisplayMode;
	heat: HeatDomains;
	insuranceEvPercent?: number;
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
											trueCount={props.trueCount}
											mode={props.mode}
											heat={props.heat}
											hand={formatPairLabel(pairRank)}
											upcard={upcard}
											insuranceEvPercent={props.insuranceEvPercent}
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
	/**
	 * Loading state for the summary cards alone. It is not `isComputing`: the
	 * cards describe the whole shoe, so a recalculation at a new count
	 * leaves them showing what they already show rather than blanking them.
	 */
	isSummaryComputing: Accessor<boolean>;
	error: Accessor<string | null>;
	trueCount: Accessor<number>;
	bankroll: Accessor<BankrollAnalysis | undefined>;
	/** The count distribution the frequency graph draws, on the same basis. */
	countFrequency: Accessor<CountFrequencyProfile | undefined>;
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

	/**
	 * The count's insurance price, or `undefined` at a table that doesn't offer
	 * the bet -- the popovers under the ace upcard report it, since it is that
	 * upcard's number rather than any one hand's.
	 */
	const insuranceEvPercent = createMemo(() => {
		const insurance = props.result()?.insurance;
		return insurance?.offered ? insurance.countEvPercent : undefined;
	});

	const [mode, setMode] = createSignal<CellDisplayMode>(
		loadCellDisplayMode() ?? 'action'
	);
	createEffect(() => saveCellDisplayMode(mode()));

	createGlobalKeydown((event) => {
		if (event.key !== ' ' || isKeyConsumingTarget(event.target)) return;
		// Space scrolls the page by default, which would drag the grids out from
		// under the very change the key just made.
		event.preventDefault();
		setMode(nextCellDisplayMode);
	});

	/**
	 * Recomputed per result rather than fixed, so the ramps stretch to whatever
	 * the count has done to the table instead of saturating at one end of a
	 * hardcoded range.
	 */
	const heat = createMemo<HeatDomains>(() => {
		const result = props.result();
		let ev = 0;
		let occurrence = 0;
		for (const grid of [result?.hard, result?.soft, result?.split]) {
			for (const row of grid?.rows ?? []) {
				ev = Math.max(ev, Math.abs(row.countEvPercent));
				occurrence = Math.max(occurrence, row.occurrencePercent);
			}
		}
		return { ev, occurrence };
	});

	return (
		<section class="ev-table">
			<Show when={props.error()}>
				{(message) => <p class="ev-table__error">{message()}</p>}
			</Show>

			<Show when={!props.error()}>
				<EvSummary
					bankroll={props.bankroll()}
					loading={props.isSummaryComputing()}
					seed={runSeed() ^ GRID_SALTS.summary}
				/>
				<CountFrequencyGraph
					profile={props.countFrequency()}
					loading={props.isSummaryComputing()}
					seed={runSeed() ^ GRID_SALTS.frequency}
				/>
				<p class="ev-table__mode" aria-live="polite">
					<span class="ev-table__mode-name">{CELL_DISPLAY_MODE_LABELS[mode()]}</span>
					<span class="ev-table__mode-hint">space to cycle</span>
					<span class="ev-table__mode-divider" aria-hidden="true" />
					<span class="ev-table__mode-name">
						True count {formatCount(props.trueCount())}
					</span>
					<span class="ev-table__mode-hint">↑/↓ to adjust</span>
				</p>
				<EvGrid
					title="Hard totals"
					rowHeading="Hard total"
					totals={HARD_TOTALS}
					upcards={RANKS}
					rowsByKey={hardRowsByKey()}
					handLabel={(total) => `Hard ${total}`}
					loading={props.isComputing()}
					seed={runSeed() ^ GRID_SALTS.hard}
					trueCount={props.trueCount()}
					mode={mode()}
					heat={heat()}
					insuranceEvPercent={insuranceEvPercent()}
				/>
				<EvGrid
					title="Soft totals"
					rowHeading="Soft total"
					totals={SOFT_TOTALS}
					upcards={RANKS}
					rowsByKey={softRowsByKey()}
					rowLabel={formatSoftTotalLabel}
					handLabel={(total) => `Soft ${total}`}
					loading={props.isComputing()}
					seed={runSeed() ^ GRID_SALTS.soft}
					trueCount={props.trueCount()}
					mode={mode()}
					heat={heat()}
					insuranceEvPercent={insuranceEvPercent()}
				/>
				<SplitEvGrid
					title="Pairs"
					pairRanks={PAIR_RANKS}
					upcards={RANKS}
					rowsByKey={splitRowsByKey()}
					loading={props.isComputing()}
					seed={runSeed() ^ GRID_SALTS.split}
					trueCount={props.trueCount()}
					mode={mode()}
					heat={heat()}
					insuranceEvPercent={insuranceEvPercent()}
				/>
			</Show>
		</section>
	);
};

export default EvTable;
