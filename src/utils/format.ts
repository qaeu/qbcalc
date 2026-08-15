import type { PlayerAction } from '#utils/ev/rules';

export function formatEvPercent(value: number): string {
	const rounded = value.toFixed(3);
	return value > 0 ? `+${rounded}` : rounded;
}

export function formatPercent(value: number): string {
	return `${value.toFixed(1)}%`;
}

/**
 * Odds of one opening deal, which run from a few percent down to the 0.04% of the
 * rarest pair against a given upcard -- so it takes two decimals where the other
 * percentages take one, or every pair cell would read 0.0%.
 */
export function formatOccurrencePercent(value: number): string {
	return `${value.toFixed(2)}%`;
}

/**
 * The same figure as `formatEvPercent`, cut to one decimal for a grid cell --
 * cells are a fixed eleventh of the table's width and clip what overflows, so
 * three decimals and a sign do not fit.
 */
export function formatCellEvPercent(value: number): string {
	const rounded = value.toFixed(1);
	return value > 0 ? `+${rounded}` : rounded;
}

/** As `formatOccurrencePercent`, without the `%` the mode caption already carries. */
export function formatCellOccurrencePercent(value: number): string {
	return value.toFixed(2);
}

/** A running count, signed -- except at zero, which no counter calls "+0". */
export function formatCount(value: number): string {
	return value > 0 ? `+${value}` : `${value}`;
}

/**
 * Money, to the nearest whole unit and grouped. Bankroll figures run from a few
 * dollars an hour to five-figure bankrolls, and cents are noise at either end.
 */
export function formatCurrency(value: number): string {
	const rounded = Math.round(Math.abs(value)).toLocaleString('en-US');
	const sign =
		value < 0 ? '-'
		: value > 0 ? '+'
		: '';
	return `${sign}$${rounded}`;
}

/**
 * A round count, grouped, and abbreviated past a thousand -- N0 routinely runs
 * into the tens of thousands and would otherwise crowd a summary card.
 */
export function formatRounds(value: number): string {
	if (!Number.isFinite(value)) return '∞';
	if (value >= 10000) return `${Math.round(value / 1000).toLocaleString('en-US')}k`;
	return Math.round(value).toLocaleString('en-US');
}

/**
 * A probability given as a fraction of 1. Two decimals, because a risk of ruin
 * worth aiming at is a fraction of a percent and would otherwise read as 0%.
 */
export function formatProbabilityPercent(value: number): string {
	return `${(value * 100).toFixed(2)}%`;
}

export function formatDuration(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}

/** Soft total 13-21 -> its A,2..A,T label (the total is always ace + one other card). */
export function formatSoftTotalLabel(total: number): string {
	const secondCard = total - 11;
	return `A,${secondCard === 10 ? 'T' : secondCard}`;
}

export function formatPairLabel(rank: string): string {
	return `${rank},${rank}`;
}

const ACTION_LABELS: Record<PlayerAction, string> = {
	H: 'Hit',
	S: 'Stand',
	D: 'Double',
	P: 'Split',
	R: 'Surrender',
};

export function formatActionLabel(action: PlayerAction): string {
	return ACTION_LABELS[action];
}
