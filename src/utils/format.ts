import type { PlayerAction } from '#utils/ev/rules';

export function formatEvPercent(value: number): string {
	const rounded = value.toFixed(3);
	return value > 0 ? `+${rounded}` : rounded;
}

export function formatPercent(value: number): string {
	return `${value.toFixed(1)}%`;
}

export function formatCount(value: number): string {
	return value >= 0 ? `+${value}` : `${value}`;
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
