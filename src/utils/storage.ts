import {
	ACE_FIVE_TAGS,
	DEFAULT_PARAMS,
	RANKS,
	type CalculatorParams,
	type TagValues,
} from './blackjackEv';
import { isCountingSystemId, type CountingSystemId } from './countingSystems';

/**
 * Everything the sidebar owns: the engine's calculator params plus the
 * selected preset, which the engine has no use for but the UI has to restore.
 */
export interface CalculatorConfig extends CalculatorParams {
	system: CountingSystemId;
}

export const DEFAULT_CONFIG: CalculatorConfig = { ...DEFAULT_PARAMS, system: 'ace-five' };

const STORAGE_KEY = 'qbcalc:calculator-config';
const STORAGE_VERSION = 2;

interface StoredConfig extends CalculatorConfig {
	version: number;
}

/** The v1 schema, kept so previously saved configs can be migrated forward. */
interface StoredConfigV1 {
	version: 1;
	decks: number;
	count: number;
	dealerHitsSoft17: boolean;
}

function isTagValues(value: unknown): value is TagValues {
	if (typeof value !== 'object' || value === null) return false;
	const tags = value as Record<string, unknown>;
	return RANKS.every((rank) => Number.isFinite(tags[rank]));
}

function hasV1Fields(config: Record<string, unknown>): boolean {
	return (
		typeof config.decks === 'number'
		&& typeof config.count === 'number'
		&& typeof config.dealerHitsSoft17 === 'boolean'
	);
}

function isStoredConfig(value: unknown): value is StoredConfig {
	if (typeof value !== 'object' || value === null) return false;
	const config = value as Record<string, unknown>;
	return (
		config.version === STORAGE_VERSION
		&& hasV1Fields(config)
		&& isCountingSystemId(config.system)
		&& isTagValues(config.tags)
	);
}

function isStoredConfigV1(value: unknown): value is StoredConfigV1 {
	if (typeof value !== 'object' || value === null) return false;
	const config = value as Record<string, unknown>;
	return config.version === 1 && hasV1Fields(config);
}

export function loadCalculatorConfig(): CalculatorConfig | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;

		const parsed: unknown = JSON.parse(raw);

		// v1 predates counting system config -- it could only ever have been
		// an Ace-Five count, so migrate it to that system's tags.
		if (isStoredConfigV1(parsed)) {
			return {
				decks: parsed.decks,
				count: parsed.count,
				dealerHitsSoft17: parsed.dealerHitsSoft17,
				system: 'ace-five',
				tags: ACE_FIVE_TAGS,
			};
		}

		if (!isStoredConfig(parsed)) return null;

		return {
			decks: parsed.decks,
			count: parsed.count,
			dealerHitsSoft17: parsed.dealerHitsSoft17,
			system: parsed.system,
			tags: parsed.tags,
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
