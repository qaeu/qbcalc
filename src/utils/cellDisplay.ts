import type { EvCellData } from '#utils/ev/tables';
import { formatCellEvPercent, formatCellOccurrencePercent } from '#utils/format';

/** The grid's cell views, in the order `[space]` cycles through them. */
export const CELL_DISPLAY_MODES = ['action', 'ev', 'occurrence'] as const;

export type CellDisplayMode = (typeof CELL_DISPLAY_MODES)[number];

/**
 * How the caption above the grids names each mode, with the unit its cells are
 * read in -- the cells themselves drop the `%` sign to fit.
 */
export const CELL_DISPLAY_MODE_LABELS: Record<CellDisplayMode, string> = {
	action: 'Optimal action',
	ev: 'EV %',
	occurrence: 'Occurrence %',
};

/**
 * Steps on each side of the heat ramp. The colours are class-per-step rather
 * than a continuous gradient because a gradient would need an inline style per
 * cell, which the project's styling rules rule out.
 *
 * Keep in sync with $heat-steps in src/styles/EvTable.scss.
 */
export const HEAT_STEPS = 8;

function clamp(value: number, low: number, high: number): number {
	return Math.min(high, Math.max(low, value));
}

/** Cell fill for the EV mode: diverging, with zero pinned to the neutral middle. */
export function evHeatClass(value: number, domain: number): string {
	if (!(domain > 0)) return 'is-ev-zero';
	const ratio = clamp(value / domain, -1, 1);
	if (ratio === 0) return 'is-ev-zero';
	// Ceiling, so a value just off zero still lands on the first coloured step
	// rather than being rounded back into the neutral one.
	const step = Math.max(1, Math.ceil(Math.abs(ratio) * HEAT_STEPS));
	return ratio > 0 ? `is-ev-pos-${step}` : `is-ev-neg-${step}`;
}

/**
 * Cell fill for the occurrence mode: sequential, and square-rooted because the
 * distribution is heavily skewed -- the commonest cells run to a few percent
 * while the rarest pairs sit near 0.04%, so a linear ramp would leave almost
 * every cell in the bottom step.
 */
export function occurrenceHeatClass(value: number, domain: number): string {
	if (!(domain > 0)) return 'is-freq-0';
	const ratio = clamp(value / domain, 0, 1);
	return `is-freq-${Math.round(Math.sqrt(ratio) * HEAT_STEPS)}`;
}

export function isCellDisplayMode(value: unknown): value is CellDisplayMode {
	return CELL_DISPLAY_MODES.includes(value as CellDisplayMode);
}

export function nextCellDisplayMode(mode: CellDisplayMode): CellDisplayMode {
	const index = CELL_DISPLAY_MODES.indexOf(mode);
	return CELL_DISPLAY_MODES[(index + 1) % CELL_DISPLAY_MODES.length];
}

/** What one cell reads in the given mode. */
export function cellDisplayText(row: EvCellData, mode: CellDisplayMode): string {
	switch (mode) {
		case 'action':
			return row.optimalAction;
		case 'ev':
			return formatCellEvPercent(row.countEvPercent);
		case 'occurrence':
			return formatCellOccurrencePercent(row.occurrencePercent);
	}
}
