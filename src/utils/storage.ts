export interface CalculatorConfig {
	decks: number;
	count: number;
	dealerHitsSoft17: boolean;
}

const STORAGE_KEY = 'qbcalc:calculator-config';
const STORAGE_VERSION = 1;

interface StoredConfig extends CalculatorConfig {
	version: number;
}

function isStoredConfig(value: unknown): value is StoredConfig {
	if (typeof value !== 'object' || value === null) return false;
	const config = value as Record<string, unknown>;
	return (
		config.version === STORAGE_VERSION
		&& typeof config.decks === 'number'
		&& typeof config.count === 'number'
		&& typeof config.dealerHitsSoft17 === 'boolean'
	);
}

export function loadCalculatorConfig(): CalculatorConfig | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;

		const parsed: unknown = JSON.parse(raw);
		if (!isStoredConfig(parsed)) return null;

		return {
			decks: parsed.decks,
			count: parsed.count,
			dealerHitsSoft17: parsed.dealerHitsSoft17,
		};
	} catch {
		return null;
	}
}

export function saveCalculatorConfig(config: CalculatorConfig): void {
	try {
		const stored: StoredConfig = { version: STORAGE_VERSION, ...config };
		localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
	} catch {
		// localStorage may be unavailable (private browsing, quota exceeded, etc.) — ignore.
	}
}
