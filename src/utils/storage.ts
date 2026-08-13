import {
	ACE_FIVE_TAGS,
	BLACKJACK_PAYOUTS,
	DEFAULT_PARAMS,
	DEFAULT_RULE_SET,
	RANKS,
	SURRENDERS,
	type BlackjackPayout,
	type CalculatorParams,
	type RuleSet,
	type Surrender,
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
const STORAGE_VERSION = 3;

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

/** The v2 schema: v1 plus the counting system, but no table rules beyond S17. */
interface StoredConfigV2 {
	version: 2;
	decks: number;
	count: number;
	dealerHitsSoft17: boolean;
	system: CountingSystemId;
	tags: TagValues;
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

function hasV2Fields(config: Record<string, unknown>): boolean {
	return (
		hasV1Fields(config) && isCountingSystemId(config.system) && isTagValues(config.tags)
	);
}

/** The table rules v3 added on top of v2's deck count and S17 flag. */
function hasV3Fields(config: Record<string, unknown>): boolean {
	return (
		typeof config.penetrationPercent === 'number'
		&& BLACKJACK_PAYOUTS.includes(config.blackjackPayout as BlackjackPayout)
		&& SURRENDERS.includes(config.surrender as Surrender)
		&& typeof config.splitLimit === 'number'
		&& typeof config.doubleAfterSplit === 'boolean'
		&& typeof config.resplitAces === 'boolean'
		&& typeof config.dealerPeek === 'boolean'
	);
}

function isStoredConfig(value: unknown): value is StoredConfig {
	if (typeof value !== 'object' || value === null) return false;
	const config = value as Record<string, unknown>;
	return config.version === STORAGE_VERSION && hasV2Fields(config) && hasV3Fields(config);
}

function isStoredConfigV1(value: unknown): value is StoredConfigV1 {
	if (typeof value !== 'object' || value === null) return false;
	const config = value as Record<string, unknown>;
	return config.version === 1 && hasV1Fields(config);
}

function isStoredConfigV2(value: unknown): value is StoredConfigV2 {
	if (typeof value !== 'object' || value === null) return false;
	const config = value as Record<string, unknown>;
	return config.version === 2 && hasV2Fields(config);
}

export function loadCalculatorConfig(): CalculatorConfig | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;

		const parsed: unknown = JSON.parse(raw);

		// v1 predates counting system config -- it could only ever have been
		// an Ace-Five count, so migrate it to that system's tags. Both older
		// schemas predate the table rules beyond S17, which take the defaults.
		if (isStoredConfigV1(parsed)) {
			return {
				...DEFAULT_RULE_SET,
				decks: parsed.decks,
				count: parsed.count,
				dealerHitsSoft17: parsed.dealerHitsSoft17,
				system: 'ace-five',
				tags: ACE_FIVE_TAGS,
			};
		}

		if (isStoredConfigV2(parsed)) {
			return {
				...DEFAULT_RULE_SET,
				decks: parsed.decks,
				count: parsed.count,
				dealerHitsSoft17: parsed.dealerHitsSoft17,
				system: parsed.system,
				tags: parsed.tags,
			};
		}

		if (!isStoredConfig(parsed)) return null;

		return {
			decks: parsed.decks,
			count: parsed.count,
			dealerHitsSoft17: parsed.dealerHitsSoft17,
			penetrationPercent: parsed.penetrationPercent,
			blackjackPayout: parsed.blackjackPayout,
			surrender: parsed.surrender,
			splitLimit: parsed.splitLimit,
			doubleAfterSplit: parsed.doubleAfterSplit,
			resplitAces: parsed.resplitAces,
			dealerPeek: parsed.dealerPeek,
			system: parsed.system,
			tags: parsed.tags,
		};
	} catch {
		return null;
	}
}

/**
 * Whether two configs would produce the same calculation and the same saved
 * state. Every field is a primitive apart from the tag vector, so a field-wise
 * comparison is enough -- no structural clone or JSON round-trip needed.
 */
export function calculatorConfigsEqual(
	a: CalculatorConfig,
	b: CalculatorConfig
): boolean {
	return (
		a.decks === b.decks
		&& a.count === b.count
		&& a.dealerHitsSoft17 === b.dealerHitsSoft17
		&& a.penetrationPercent === b.penetrationPercent
		&& a.blackjackPayout === b.blackjackPayout
		&& a.surrender === b.surrender
		&& a.splitLimit === b.splitLimit
		&& a.doubleAfterSplit === b.doubleAfterSplit
		&& a.resplitAces === b.resplitAces
		&& a.dealerPeek === b.dealerPeek
		&& a.system === b.system
		&& RANKS.every((rank) => a.tags[rank] === b.tags[rank])
	);
}

/** The table rules held in a config, as the EV engine wants them. */
export function ruleSetFromConfig(config: CalculatorConfig): RuleSet {
	return {
		decks: config.decks,
		dealerHitsSoft17: config.dealerHitsSoft17,
		penetrationPercent: config.penetrationPercent,
		blackjackPayout: config.blackjackPayout,
		surrender: config.surrender,
		splitLimit: config.splitLimit,
		doubleAfterSplit: config.doubleAfterSplit,
		resplitAces: config.resplitAces,
		dealerPeek: config.dealerPeek,
	};
}

export function saveCalculatorConfig(config: CalculatorConfig): void {
	try {
		const stored: StoredConfig = { version: STORAGE_VERSION, ...config };
		localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
	} catch {
		// localStorage may be unavailable (private browsing, quota exceeded, etc.) — ignore.
	}
}
