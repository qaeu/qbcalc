import { RANKS } from './ev/cards';
import {
	ACE_FIVE_TAGS,
	DEFAULT_PARAMS,
	type CalculatorParams,
	type TagValues,
} from './ev/composition';
import {
	BLACKJACK_PAYOUTS,
	DEFAULT_RULE_SET,
	SURRENDERS,
	type BlackjackPayout,
	type RuleSet,
	type Surrender,
} from './ev/rules';
import { RAMP_TRUE_COUNTS } from './bankroll';
import { isCountingSystemId, type CountingSystemId } from './countingSystems';
import { isCellDisplayMode, type CellDisplayMode } from './cellDisplay';

/**
 * Everything the sidebar owns: the engine's calculator params plus the
 * selected preset, which the engine has no use for but the UI has to restore.
 */
export interface CalculatorConfig extends CalculatorParams {
	system: CountingSystemId;
}

export const DEFAULT_CONFIG: CalculatorConfig = { ...DEFAULT_PARAMS, system: 'ace-five' };

/**
 * A config minus the running count. The count is driven by the arrow keys and
 * recalculates on its own, so the sidebar form neither holds it nor submits it
 * -- everything the form does own is exactly this.
 */
export type CalculatorSettings = Omit<CalculatorConfig, 'count'>;

/**
 * The settings half of a config, for seeding the sidebar's form. The tag vector
 * comes across by reference, so a caller that intends to edit it -- a store,
 * say -- copies it as it takes it.
 */
export function settingsFromConfig(config: CalculatorConfig): CalculatorSettings {
	return { ...ruleSetFromConfig(config), system: config.system, tags: config.tags };
}

/**
 * What the player brings to the table rather than what the table offers: the
 * bankroll figures are derived from an EV result, never an input to one.
 */
export interface BankrollConfig {
	/** Total bankroll, in the same currency as `unit`. */
	bankroll: number;
	/** What one betting unit is worth. */
	unit: number;
	roundsPerHour: number;
	/** Units wagered in each `RAMP_TRUE_COUNTS` bucket. */
	ramp: readonly number[];
}

export const DEFAULT_BANKROLL_CONFIG: BankrollConfig = {
	bankroll: 10000,
	unit: 25,
	roundsPerHour: 100,
	ramp: [1, 1, 2, 4, 8, 12, 12],
};

const STORAGE_KEY = 'qbcalc:calculator-config';
const STORAGE_VERSION = 5;

/**
 * Kept out of `CalculatorConfig` and under a key of its own. The config decides
 * what the worker computes and whether the sidebar considers itself dirty, and
 * the display mode changes neither -- filing it there would leave the Calculate
 * button reporting stale results after a mode switch.
 *
 * Stored as a bare string with no version envelope: anything unrecognised is
 * simply dropped and the table falls back to its default mode.
 */
const DISPLAY_MODE_KEY = 'qbcalc:cell-display-mode';

/**
 * Also kept out of `CalculatorConfig`, and for the same reason as the display
 * mode: bankroll and bet spread change nothing the worker computes, so filing
 * them there would leave the Calculate button offering to recalculate results
 * that are already current. Structured rather than a bare string, so unlike the
 * display mode it carries a version envelope of its own.
 */
const BANKROLL_KEY = 'qbcalc:bankroll';

const BANKROLL_VERSION = 1;

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

/**
 * The v3 schema: every table rule the sidebar has today except `hitSplitAces`,
 * which v4 added. Structurally a `CalculatorConfig` minus that one field.
 */
type StoredConfigV3 = Omit<CalculatorConfig, 'hitSplitAces' | 'insurance'> & {
	version: 3;
};

/** The v4 schema: every rule the sidebar has today except `insurance`. */
type StoredConfigV4 = Omit<CalculatorConfig, 'insurance'> & { version: 4 };

interface StoredBankroll extends BankrollConfig {
	version: number;
}

function isStoredBankroll(value: unknown): value is StoredBankroll {
	if (typeof value !== 'object' || value === null) return false;
	const config = value as Record<string, unknown>;
	return (
		config.version === BANKROLL_VERSION
		&& Number.isFinite(config.bankroll)
		&& Number.isFinite(config.unit)
		&& Number.isFinite(config.roundsPerHour)
		&& Array.isArray(config.ramp)
		// The ramp's length is the bucket count, so a stored ramp of the wrong
		// length would silently leave the top counts unbet -- reject it instead.
		&& config.ramp.length === RAMP_TRUE_COUNTS.length
		&& config.ramp.every((units) => Number.isFinite(units))
	);
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

/** The single rule v4 added on top of v3. */
function hasV4Fields(config: Record<string, unknown>): boolean {
	return hasV3Fields(config) && typeof config.hitSplitAces === 'boolean';
}

/** The single rule v5 added on top of v4. */
function hasV5Fields(config: Record<string, unknown>): boolean {
	return hasV4Fields(config) && typeof config.insurance === 'boolean';
}

function isStoredConfig(value: unknown): value is StoredConfig {
	if (typeof value !== 'object' || value === null) return false;
	const config = value as Record<string, unknown>;
	return config.version === STORAGE_VERSION && hasV2Fields(config) && hasV5Fields(config);
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

function isStoredConfigV3(value: unknown): value is StoredConfigV3 {
	if (typeof value !== 'object' || value === null) return false;
	const config = value as Record<string, unknown>;
	return config.version === 3 && hasV2Fields(config) && hasV3Fields(config);
}

function isStoredConfigV4(value: unknown): value is StoredConfigV4 {
	if (typeof value !== 'object' || value === null) return false;
	const config = value as Record<string, unknown>;
	return config.version === 4 && hasV2Fields(config) && hasV4Fields(config);
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

		// v3 and v4 each lack one later rule and are otherwise intact, so they
		// survive with those fields taking their defaults.
		if (isStoredConfigV3(parsed)) {
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
				hitSplitAces: DEFAULT_RULE_SET.hitSplitAces,
				dealerPeek: parsed.dealerPeek,
				insurance: DEFAULT_RULE_SET.insurance,
				system: parsed.system,
				tags: parsed.tags,
			};
		}

		if (isStoredConfigV4(parsed)) {
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
				hitSplitAces: parsed.hitSplitAces,
				dealerPeek: parsed.dealerPeek,
				insurance: DEFAULT_RULE_SET.insurance,
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
			hitSplitAces: parsed.hitSplitAces,
			dealerPeek: parsed.dealerPeek,
			insurance: parsed.insurance,
			system: parsed.system,
			tags: parsed.tags,
		};
	} catch {
		return null;
	}
}

/**
 * Whether two sets of sidebar settings would produce the same calculation.
 * Every field is a primitive apart from the tag vector, so a field-wise
 * comparison is enough -- no structural clone or JSON round-trip needed. The
 * running count is deliberately not part of it: it recalculates as it changes,
 * so it can never be what makes the form dirty.
 */
export function calculatorSettingsEqual(
	a: CalculatorSettings,
	b: CalculatorSettings
): boolean {
	return (
		a.decks === b.decks
		&& a.dealerHitsSoft17 === b.dealerHitsSoft17
		&& a.penetrationPercent === b.penetrationPercent
		&& a.blackjackPayout === b.blackjackPayout
		&& a.surrender === b.surrender
		&& a.splitLimit === b.splitLimit
		&& a.doubleAfterSplit === b.doubleAfterSplit
		&& a.resplitAces === b.resplitAces
		&& a.hitSplitAces === b.hitSplitAces
		&& a.dealerPeek === b.dealerPeek
		&& a.insurance === b.insurance
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
		hitSplitAces: config.hitSplitAces,
		dealerPeek: config.dealerPeek,
		insurance: config.insurance,
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

export function loadBankrollConfig(): BankrollConfig | null {
	try {
		const raw = localStorage.getItem(BANKROLL_KEY);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		return isStoredBankroll(parsed) ?
				{
					bankroll: parsed.bankroll,
					unit: parsed.unit,
					roundsPerHour: parsed.roundsPerHour,
					ramp: parsed.ramp,
				}
			:	null;
	} catch {
		return null;
	}
}

export function saveBankrollConfig(config: BankrollConfig): void {
	try {
		const stored: StoredBankroll = { version: BANKROLL_VERSION, ...config };
		localStorage.setItem(BANKROLL_KEY, JSON.stringify(stored));
	} catch {
		// As above.
	}
}

export function loadCellDisplayMode(): CellDisplayMode | null {
	try {
		const raw = localStorage.getItem(DISPLAY_MODE_KEY);
		return isCellDisplayMode(raw) ? raw : null;
	} catch {
		return null;
	}
}

export function saveCellDisplayMode(mode: CellDisplayMode): void {
	try {
		localStorage.setItem(DISPLAY_MODE_KEY, mode);
	} catch {
		// As above -- a mode that can't be saved is not worth failing a render over.
	}
}
