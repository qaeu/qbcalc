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
import { HI_LO_TAGS, isCountingSystemId, type CountingSystemId } from './countingSystems';
import { isCellDisplayMode, type CellDisplayMode } from './cellDisplay';
import { isStoredPlaySession, type StoredPlaySession } from './play/session';
import { EMPTY_PLAY_STATS, type PlayStats } from './play/stats';
import {
	CUT_CARD_VARIANCES,
	DEVIATION_MODES,
	isSimOption,
	OTHER_SPOTS,
	ROUND_COUNTS,
	WONG_IN_COUNTS,
	WONG_OUT_COUNTS,
	type SimConfig,
} from './sim/config';

/**
 * Everything the sidebar owns: the engine's calculator params plus the
 * selected preset, which the engine has no use for but the UI has to restore.
 */
export interface CalculatorConfig extends CalculatorParams {
	system: CountingSystemId;
}

export const DEFAULT_CONFIG: CalculatorConfig = {
	...DEFAULT_PARAMS,
	system: 'hi-lo',
	tags: HI_LO_TAGS,
};

/**
 * A config minus the true count. The count is driven by the arrow keys and
 * recalculates on its own, so the sidebar form neither holds it nor reports it
 * -- everything the form does own is exactly this.
 */
export type CalculatorSettings = Omit<CalculatorConfig, 'trueCount'>;

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
	bankroll: 40000,
	unit: 25,
	roundsPerHour: 80,
	ramp: [1, 1, 2, 3, 5, 8, 12],
};

/**
 * How much of the coach's verdict the felt shows: nothing, basic strategy
 * alone, or basic strategy plus the count's deviations. Grading itself always
 * runs -- see docs/play-model.md §Grading a decision.
 */
export type CoachingLevel = 'none' | 'basic' | 'deviations';

/**
 * How fast new cards land on the felt. Each step is a flat per-card delay --
 * see `CARD_DEAL_DELAY_MS` in PlayTable -- rather than a scaled duration, so
 * `instant` is simply zero rather than a special case of the others.
 */
export type AnimationSpeed = '1x' | '2x' | '4x' | 'instant';

/**
 * What the Play view is set to. Like the bankroll config it is owned by the app
 * rather than mirrored into the calculator config: none of it changes anything
 * the worker computes, so it saves as it is typed.
 */
export interface PlayConfig {
	/** How much of the grading is *shown*. Grading itself always runs. */
	coaching: CoachingLevel;
	/** Whether the running and true counts appear in the play HUD. */
	showCount: boolean;
	/** How fast cards are dealt onto the felt. */
	animationSpeed: AnimationSpeed;
}

export const DEFAULT_PLAY_CONFIG: PlayConfig = {
	coaching: 'basic',
	showCount: false,
	animationSpeed: '1x',
};

/** The coaching levels, in increasing order of help, for the settings select. */
export const COACHING_LEVELS: readonly { value: CoachingLevel; label: string }[] = [
	{ value: 'none', label: 'None' },
	{ value: 'basic', label: 'Basic strategy' },
	{ value: 'deviations', label: 'Deviations' },
];

/** The animation speeds, slowest first, for the settings select. */
export const ANIMATION_SPEEDS: readonly { value: AnimationSpeed; label: string }[] = [
	{ value: '1x', label: '1x' },
	{ value: '2x', label: '2x' },
	{ value: '4x', label: '4x' },
	{ value: 'instant', label: 'Instant' },
];

const STORAGE_KEY = 'qbcalc:calculator-config';
const STORAGE_VERSION = 6;

/**
 * Kept out of `CalculatorConfig` and under a key of its own. The config decides
 * what the worker computes, and the display mode changes none of it -- filing
 * it there would send a mode switch off to recompute results it cannot alter.
 *
 * Stored as a bare string with no version envelope: anything unrecognised is
 * simply dropped and the table falls back to its default mode.
 */
const DISPLAY_MODE_KEY = 'qbcalc:cell-display-mode';

/**
 * Also kept out of `CalculatorConfig`, and for the same reason as the display
 * mode: bankroll and bet spread change nothing the worker computes, so filing
 * them there would send every spread edit off to recalculate results that are
 * already current -- blanking the grids on the way. Structured rather than a
 * bare string, so unlike the display mode it carries a version envelope.
 */
const BANKROLL_KEY = 'qbcalc:bankroll';

const BANKROLL_VERSION = 1;

/**
 * The Play view's three records, kept apart from each other and from everything
 * above: the config is a setting the user chooses, the stats are a lifetime
 * training record, and the session is the shoe and hand currently on the felt.
 * Neither of the first two is segmented by rule set -- the point is a single
 * figure for how the player is playing, across every game they practise on. The
 * session is, by its own `shoeKey`: a shoe outlives a reload but not a change to
 * the game it was dealt for.
 */
const PLAY_CONFIG_KEY = 'qbcalc:play-config';
const PLAY_STATS_KEY = 'qbcalc:play-stats';
const PLAY_SESSION_KEY = 'qbcalc:play-session';

const PLAY_CONFIG_VERSION = 1;
/**
 * Bumped from 1 to 2 when `variance` was added to `PlayStats` -- a v1 record
 * would otherwise still pass `isStoredPlayStats`' field check by accident
 * rather than by design, since that check derives its field list from
 * `EMPTY_PLAY_STATS` and would only reject it for lacking a value, not for
 * being the wrong shape.
 */
const PLAY_STATS_VERSION = 2;
const PLAY_SESSION_VERSION = 1;

/**
 * The Sim view's settings, kept out of `CalculatorConfig` for the same reason the
 * bankroll and play configs are: none of it reaches anything the EV worker
 * computes, so it is saved as typed. A run's *result* is not stored at all -- it
 * is minutes of dealing and megabytes of buckets, and re-runnable from its seed.
 */
const SIM_CONFIG_KEY = 'qbcalc:sim-config';
const SIM_CONFIG_VERSION = 1;

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
 * Every schema up to v5 stored a *running* count; v6 stores the true count the
 * app works in. A stored config's own deck count is what converts it -- the
 * engine has always spread a running count's removals as `count / decks` (see
 * docs/ev-model.md §Simplifications (3)), so this migration preserves the shoe
 * the user was last looking at exactly.
 */
type WithRunningCount<T> = Omit<T, 'trueCount'> & { count: number };

/**
 * The v3 schema: every table rule the sidebar has today except `hitSplitAces`,
 * which v4 added. Structurally a `CalculatorConfig` minus that one field.
 */
type StoredConfigV3 = WithRunningCount<
	Omit<CalculatorConfig, 'hitSplitAces' | 'insurance'>
> & {
	version: 3;
};

/** The v4 schema: every rule the sidebar has today except `insurance`. */
type StoredConfigV4 = WithRunningCount<Omit<CalculatorConfig, 'insurance'>> & {
	version: 4;
};

/** The v5 schema: every field v6 has, but counted in running counts. */
type StoredConfigV5 = WithRunningCount<CalculatorConfig> & { version: 5 };

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

interface StoredPlayConfig extends PlayConfig {
	version: number;
}

function isStoredPlayConfig(value: unknown): value is StoredPlayConfig {
	if (typeof value !== 'object' || value === null) return false;
	const config = value as Record<string, unknown>;
	return (
		config.version === PLAY_CONFIG_VERSION
		&& COACHING_LEVELS.some((level) => level.value === config.coaching)
		&& typeof config.showCount === 'boolean'
		&& ANIMATION_SPEEDS.some((speed) => speed.value === config.animationSpeed)
	);
}

interface StoredSimConfig extends SimConfig {
	version: number;
}

/**
 * Each field is checked against the list the form offers it from, so a record
 * written under an older set of options is dropped rather than restored into a
 * select with nothing to select. The seed is the exception: it is any number.
 */
function isStoredSimConfig(value: unknown): value is StoredSimConfig {
	if (typeof value !== 'object' || value === null) return false;
	const config = value as Record<string, unknown>;
	return (
		config.version === SIM_CONFIG_VERSION
		&& isSimOption(ROUND_COUNTS, config.rounds)
		&& isSimOption(DEVIATION_MODES, config.deviations)
		&& isSimOption(CUT_CARD_VARIANCES, config.cutCardVarianceDecks)
		&& isSimOption(WONG_IN_COUNTS, config.wongInCount)
		&& isSimOption(WONG_OUT_COUNTS, config.wongOutCount)
		&& isSimOption(OTHER_SPOTS, config.otherSpots)
		&& Number.isFinite(config.seed)
		&& typeof config.reseedEachRun === 'boolean'
	);
}

interface StoredPlayStats extends PlayStats {
	version: number;
}

/** Every field is a number, so the guard is the field list plus finiteness. */
function isStoredPlayStats(value: unknown): value is StoredPlayStats {
	if (typeof value !== 'object' || value === null) return false;
	const stats = value as Record<string, unknown>;
	return (
		stats.version === PLAY_STATS_VERSION
		&& Object.keys(EMPTY_PLAY_STATS).every((field) => Number.isFinite(stats[field]))
	);
}

interface StoredPlaySessionRecord extends StoredPlaySession {
	version: number;
}

function isVersionedPlaySession(value: unknown): value is StoredPlaySessionRecord {
	if (typeof value !== 'object' || value === null) return false;
	return (
		(value as Record<string, unknown>).version === PLAY_SESSION_VERSION
		&& isStoredPlaySession(value)
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

/**
 * v6's own shape: v5's, with the running count replaced by the true count. Only
 * the count field differs, so the rule checks above are reused as they stand.
 */
function isStoredConfig(value: unknown): value is StoredConfig {
	if (typeof value !== 'object' || value === null) return false;
	const config = value as Record<string, unknown>;
	return (
		config.version === STORAGE_VERSION
		&& typeof config.decks === 'number'
		&& typeof config.trueCount === 'number'
		&& typeof config.dealerHitsSoft17 === 'boolean'
		&& isCountingSystemId(config.system)
		&& isTagValues(config.tags)
		&& hasV5Fields(config)
	);
}

/**
 * A stored running count read as the true count that describes the same shoe,
 * rounded to the whole count the arrow keys move in. See `WithRunningCount`.
 */
function migrateCount(count: number, decks: number): number {
	return decks > 0 ? Math.round(count / decks) : 0;
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

function isStoredConfigV5(value: unknown): value is StoredConfigV5 {
	if (typeof value !== 'object' || value === null) return false;
	const config = value as Record<string, unknown>;
	return config.version === 5 && hasV2Fields(config) && hasV5Fields(config);
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
				trueCount: migrateCount(parsed.count, parsed.decks),
				dealerHitsSoft17: parsed.dealerHitsSoft17,
				system: 'ace-five',
				tags: ACE_FIVE_TAGS,
			};
		}

		if (isStoredConfigV2(parsed)) {
			return {
				...DEFAULT_RULE_SET,
				decks: parsed.decks,
				trueCount: migrateCount(parsed.count, parsed.decks),
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
				trueCount: migrateCount(parsed.count, parsed.decks),
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
				trueCount: migrateCount(parsed.count, parsed.decks),
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

		if (isStoredConfigV5(parsed)) {
			return {
				decks: parsed.decks,
				trueCount: migrateCount(parsed.count, parsed.decks),
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
		}

		if (!isStoredConfig(parsed)) return null;

		return {
			decks: parsed.decks,
			trueCount: parsed.trueCount,
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
 * true count is deliberately not part of it: it recalculates on its own as
 * the arrow keys move it, so it can never be what the settle timer is waiting
 * on -- and its absence is also what lets the app tell a count-only
 * recalculation apart from one the summary cards have to follow.
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

export function loadPlayConfig(): PlayConfig | null {
	try {
		const raw = localStorage.getItem(PLAY_CONFIG_KEY);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		return isStoredPlayConfig(parsed) ?
				{
					coaching: parsed.coaching,
					showCount: parsed.showCount,
					animationSpeed: parsed.animationSpeed,
				}
			:	null;
	} catch {
		return null;
	}
}

export function savePlayConfig(config: PlayConfig): void {
	try {
		const stored: StoredPlayConfig = { version: PLAY_CONFIG_VERSION, ...config };
		localStorage.setItem(PLAY_CONFIG_KEY, JSON.stringify(stored));
	} catch {
		// As above.
	}
}

export function loadSimConfig(): SimConfig | null {
	try {
		const raw = localStorage.getItem(SIM_CONFIG_KEY);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		return isStoredSimConfig(parsed) ?
				{
					rounds: parsed.rounds,
					deviations: parsed.deviations,
					cutCardVarianceDecks: parsed.cutCardVarianceDecks,
					wongInCount: parsed.wongInCount,
					wongOutCount: parsed.wongOutCount,
					otherSpots: parsed.otherSpots,
					seed: parsed.seed,
					reseedEachRun: parsed.reseedEachRun,
				}
			:	null;
	} catch {
		return null;
	}
}

export function saveSimConfig(config: SimConfig): void {
	try {
		const stored: StoredSimConfig = { version: SIM_CONFIG_VERSION, ...config };
		localStorage.setItem(SIM_CONFIG_KEY, JSON.stringify(stored));
	} catch {
		// As above.
	}
}

export function loadPlayStats(): PlayStats | null {
	try {
		const raw = localStorage.getItem(PLAY_STATS_KEY);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (!isStoredPlayStats(parsed)) return null;
		return {
			av: parsed.av,
			ev: parsed.ev,
			hands: parsed.hands,
			rounds: parsed.rounds,
			decisions: parsed.decisions,
			optimalDecisions: parsed.optimalDecisions,
			basicErrors: parsed.basicErrors,
			deviationErrors: parsed.deviationErrors,
			evLost: parsed.evLost,
			variance: parsed.variance,
		};
	} catch {
		return null;
	}
}

export function savePlayStats(stats: PlayStats): void {
	try {
		const stored: StoredPlayStats = { version: PLAY_STATS_VERSION, ...stats };
		localStorage.setItem(PLAY_STATS_KEY, JSON.stringify(stored));
	} catch {
		// As above.
	}
}

/**
 * The session on the felt. The record is deep -- a whole shoe's card order, plus
 * the round in progress -- so unlike the rest of this module it is validated by
 * `play/session.ts`, next to the types it is a picture of.
 */
export function loadPlaySession(): StoredPlaySession | null {
	try {
		const raw = localStorage.getItem(PLAY_SESSION_KEY);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		return isVersionedPlaySession(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export function savePlaySession(session: StoredPlaySession): void {
	try {
		localStorage.setItem(
			PLAY_SESSION_KEY,
			JSON.stringify({ version: PLAY_SESSION_VERSION, ...session })
		);
	} catch {
		// As above.
	}
}

/** Drops the lifetime record entirely; the next load falls back to `EMPTY_PLAY_STATS`. */
export function resetPlayStats(): void {
	try {
		localStorage.removeItem(PLAY_STATS_KEY);
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
