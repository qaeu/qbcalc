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
