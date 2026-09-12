import { describe, it, expect, afterEach } from 'vitest';

import { ACE_FIVE_TAGS, type TagValues } from '#utils/ev/composition';
import {
	DEFAULT_BANKROLL_CONFIG,
	DEFAULT_CONFIG,
	loadBankrollConfig,
	loadCalculatorConfig,
	loadCellDisplayMode,
	saveBankrollConfig,
	saveCalculatorConfig,
	saveCellDisplayMode,
	DEFAULT_PLAY_CONFIG,
	loadPlayConfig,
	loadPlayStats,
	resetPlayStats,
	savePlayConfig,
	savePlayStats,
	loadSimConfig,
	saveSimConfig,
	DEFAULT_TRAIN_CONFIG,
	loadTrainConfig,
	loadTrainScores,
	saveTrainConfig,
	saveTrainScores,
	type BankrollConfig,
	type CalculatorConfig,
	type PlayConfig,
} from '#utils/settings/storage';
import { EMPTY_PLAY_STATS, type PlayStats } from '#utils/play/stats';
import { DEFAULT_SIM_CONFIG, type SimConfig } from '#utils/sim/config';

const STORAGE_KEY = 'qbcalc:calculator-config';
const DISPLAY_MODE_KEY = 'qbcalc:cell-display-mode';
const BANKROLL_KEY = 'qbcalc:bankroll';
const PLAY_CONFIG_KEY = 'qbcalc:play-config';
const PLAY_STATS_KEY = 'qbcalc:play-stats';
const SIM_CONFIG_KEY = 'qbcalc:sim-config';
const TRAIN_CONFIG_KEY = 'qbcalc:train-config';
const TRAIN_SCORES_KEY = 'qbcalc:train-scores';
/** Mirrors the module's own constant: the schema `saveCalculatorConfig` writes. */
const STORAGE_VERSION = 5;

const CUSTOM_TAGS: TagValues = {
	'2': 1,
	'3': 1,
	'4': 1,
	'5': 1,
	'6': 1,
	'7': 0,
	'8': 0,
	'9': 0,
	T: -1,
	A: -1,
};

afterEach(() => {
	localStorage.clear();
});

describe('loadCalculatorConfig', () => {
	it('returns null when nothing has been saved', () => {
		expect(loadCalculatorConfig()).toBeNull();
	});

	it('returns the saved config after a round trip through saveCalculatorConfig', () => {
		const config: CalculatorConfig = {
			...DEFAULT_CONFIG,
			decks: 6,
			trueCount: -3,
			dealerHitsSoft17: false,
			penetrationPercent: 60,
			blackjackPayout: '6:5',
			surrender: 'late',
			splitLimit: 2,
			doubleAfterSplit: false,
			resplitAces: true,
			hitSplitAces: true,
			dealerPeek: false,
			insurance: false,
			system: 'custom',
			tags: CUSTOM_TAGS,
		};
		saveCalculatorConfig(config);

		expect(loadCalculatorConfig()).toEqual(config);
	});

	it('migrates a v1 config to the Ace-Five system and the default rules', () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ version: 1, decks: 6, count: 4, dealerHitsSoft17: false })
		);

		// The stored running count is read as the true count describing the same
		// shoe -- a sixth of it on six decks, rounded to a whole count.
		expect(loadCalculatorConfig()).toEqual({
			...DEFAULT_CONFIG,
			decks: 6,
			trueCount: 1,
			dealerHitsSoft17: false,
			system: 'ace-five',
			tags: ACE_FIVE_TAGS,
		});
	});

	it('migrates a v2 config by filling in the rules it predates', () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				version: 2,
				decks: 6,
				count: 4,
				dealerHitsSoft17: false,
				system: 'custom',
				tags: CUSTOM_TAGS,
			})
		);

		expect(loadCalculatorConfig()).toEqual({
			...DEFAULT_CONFIG,
			decks: 6,
			trueCount: 1,
			dealerHitsSoft17: false,
			system: 'custom',
			tags: CUSTOM_TAGS,
		});
	});

	it('migrates a v3 config by defaulting the hit-split-aces rule it predates', () => {
		const v3: Record<string, unknown> = {
			...DEFAULT_CONFIG,
			version: 3,
			decks: 6,
			count: 6,
			splitLimit: 2,
			resplitAces: true,
		};
		delete v3.trueCount;
		delete v3.hitSplitAces;
		delete v3.insurance;
		localStorage.setItem(STORAGE_KEY, JSON.stringify(v3));

		expect(loadCalculatorConfig()).toEqual({
			...DEFAULT_CONFIG,
			decks: 6,
			trueCount: 1,
			splitLimit: 2,
			resplitAces: true,
			// Filled in from the current defaults, whichever way they point.
			hitSplitAces: DEFAULT_CONFIG.hitSplitAces,
			insurance: DEFAULT_CONFIG.insurance,
		});
	});

	it('migrates a v4 config by defaulting the insurance rule it predates', () => {
		const v4: Record<string, unknown> = {
			...DEFAULT_CONFIG,
			version: 4,
			decks: 2,
			count: 5,
			hitSplitAces: false,
		};
		delete v4.trueCount;
		delete v4.insurance;
		localStorage.setItem(STORAGE_KEY, JSON.stringify(v4));

		expect(loadCalculatorConfig()).toEqual({
			...DEFAULT_CONFIG,
			decks: 2,
			trueCount: 3,
			hitSplitAces: false,
			// Filled in from the current default, whichever way it points.
			insurance: DEFAULT_CONFIG.insurance,
		});
	});

	it('migrates a v5 config by reading its running count as a true count', () => {
		const v5: Record<string, unknown> = {
			...DEFAULT_CONFIG,
			version: 5,
			decks: 4,
			count: 10,
		};
		delete v5.trueCount;
		localStorage.setItem(STORAGE_KEY, JSON.stringify(v5));

		expect(loadCalculatorConfig()).toEqual({
			...DEFAULT_CONFIG,
			decks: 4,
			trueCount: 3,
		});
	});

	it('returns null when a table rule is missing or the wrong type', () => {
		const stored = { ...DEFAULT_CONFIG, version: STORAGE_VERSION };
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ ...stored, blackjackPayout: '7:5' })
		);
		expect(loadCalculatorConfig()).toBeNull();

		localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...stored, surrender: 'maybe' }));
		expect(loadCalculatorConfig()).toBeNull();

		localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...stored, dealerPeek: 'yes' }));
		expect(loadCalculatorConfig()).toBeNull();

		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ ...stored, hitSplitAces: 'sometimes' })
		);
		expect(loadCalculatorConfig()).toBeNull();

		localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...stored, insurance: 'yes' }));
		expect(loadCalculatorConfig()).toBeNull();
	});

	it('returns null for malformed JSON', () => {
		localStorage.setItem(STORAGE_KEY, '{not json');

		expect(loadCalculatorConfig()).toBeNull();
	});

	it('returns null when a required field is missing or the wrong type', () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ ...DEFAULT_CONFIG, version: STORAGE_VERSION, decks: '6' })
		);

		expect(loadCalculatorConfig()).toBeNull();
	});

	it('returns null when the tag values are incomplete or unknown', () => {
		const base = { ...DEFAULT_CONFIG, version: STORAGE_VERSION };
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...base, tags: { '2': 0 } }));
		expect(loadCalculatorConfig()).toBeNull();

		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ ...base, system: 'not-a-system', tags: ACE_FIVE_TAGS })
		);
		expect(loadCalculatorConfig()).toBeNull();
	});

	it('returns null for a config saved under a different schema version', () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				version: 999,
				decks: 6,
				trueCount: 1,
				dealerHitsSoft17: false,
				system: 'ace-five',
				tags: ACE_FIVE_TAGS,
			})
		);

		expect(loadCalculatorConfig()).toBeNull();
	});
});

describe('bankroll config', () => {
	it('round-trips a saved config', () => {
		const config: BankrollConfig = {
			bankroll: 25000,
			unit: 50,
			roundsPerHour: 80,
			ramp: [1, 1, 2, 4, 6, 10, 16],
		};
		saveBankrollConfig(config);
		expect(loadBankrollConfig()).toEqual(config);
	});

	it('returns null when nothing has been saved', () => {
		expect(loadBankrollConfig()).toBeNull();
	});

	it('rejects a ramp of the wrong length', () => {
		// A short ramp would leave the top counts silently unbet rather than
		// failing, so it is dropped for the default instead.
		localStorage.setItem(
			BANKROLL_KEY,
			JSON.stringify({
				version: 1,
				bankroll: 10000,
				unit: 25,
				roundsPerHour: 100,
				ramp: [1, 2, 4],
			})
		);
		expect(loadBankrollConfig()).toBeNull();
	});

	it('rejects a stored config from a future version', () => {
		localStorage.setItem(
			BANKROLL_KEY,
			JSON.stringify({ ...DEFAULT_BANKROLL_CONFIG, version: 99 })
		);
		expect(loadBankrollConfig()).toBeNull();
	});

	it('survives unparseable stored bankroll settings', () => {
		localStorage.setItem(BANKROLL_KEY, 'not json');
		expect(loadBankrollConfig()).toBeNull();
	});

	// The two keys are independent: bankroll settings change nothing the worker
	// computes, which is the whole reason they are stored apart from the config.
	it('leaves the calculator config alone', () => {
		saveCalculatorConfig(DEFAULT_CONFIG);
		saveBankrollConfig(DEFAULT_BANKROLL_CONFIG);
		expect(loadCalculatorConfig()).toEqual(DEFAULT_CONFIG);

		localStorage.setItem(BANKROLL_KEY, 'not json');
		expect(loadCalculatorConfig()).toEqual(DEFAULT_CONFIG);
	});
});

describe('cell display mode', () => {
	it('round-trips a saved mode', () => {
		saveCellDisplayMode('occurrence');
		expect(loadCellDisplayMode()).toBe('occurrence');
	});

	it('returns null when nothing has been saved', () => {
		expect(loadCellDisplayMode()).toBeNull();
	});

	// Stored bare, with no version envelope: anything unrecognised is simply
	// dropped and the table falls back to its default mode.
	it('returns null for a stored value that is not a mode', () => {
		localStorage.setItem(DISPLAY_MODE_KEY, 'nonsense');
		expect(loadCellDisplayMode()).toBeNull();
	});
});

describe('play config', () => {
	const CONFIG: PlayConfig = {
		coaching: 'deviations',
		showCount: true,
		animationSpeed: '2x',
	};

	it('defaults to basic coaching, a hidden count and 1x animation', () => {
		expect(DEFAULT_PLAY_CONFIG).toEqual({
			coaching: 'basic',
			showCount: false,
			animationSpeed: '1x',
		});
	});

	it('round-trips a saved config', () => {
		savePlayConfig(CONFIG);
		expect(loadPlayConfig()).toEqual(CONFIG);
	});

	it('returns null when nothing has been saved', () => {
		expect(loadPlayConfig()).toBeNull();
	});

	it('rejects a stored config from another schema version', () => {
		localStorage.setItem(
			PLAY_CONFIG_KEY,
			JSON.stringify({ version: 99, ...DEFAULT_PLAY_CONFIG })
		);
		expect(loadPlayConfig()).toBeNull();
	});

	it('rejects a coaching level it does not know, and a broken payload', () => {
		localStorage.setItem(
			PLAY_CONFIG_KEY,
			JSON.stringify({ version: 1, ...DEFAULT_PLAY_CONFIG, coaching: 'psychic' })
		);
		expect(loadPlayConfig()).toBeNull();

		localStorage.setItem(PLAY_CONFIG_KEY, 'not json');
		expect(loadPlayConfig()).toBeNull();
	});

	it('rejects an animation speed it does not know', () => {
		localStorage.setItem(
			PLAY_CONFIG_KEY,
			JSON.stringify({ version: 1, ...DEFAULT_PLAY_CONFIG, animationSpeed: 'ludicrous' })
		);
		expect(loadPlayConfig()).toBeNull();
	});
});

describe('play stats', () => {
	const STATS: PlayStats = {
		av: -125.5,
		ev: 42.25,
		hands: 310,
		rounds: 290,
		decisions: 402,
		optimalDecisions: 388,
		basicErrors: 9,
		deviationErrors: 5,
		evLost: 18.75,
		variance: 640.5,
	};

	it('round-trips a saved record', () => {
		savePlayStats(STATS);
		expect(loadPlayStats()).toEqual(STATS);
	});

	it('returns null when nothing has been saved', () => {
		expect(loadPlayStats()).toBeNull();
	});

	it('rejects a record from another schema version, defaults taking over', () => {
		localStorage.setItem(PLAY_STATS_KEY, JSON.stringify({ version: 1, ...STATS }));
		expect(loadPlayStats()).toBeNull();
	});

	it('rejects a record missing a field', () => {
		const partial: Record<string, number> = { ...STATS };
		delete partial.evLost;
		localStorage.setItem(PLAY_STATS_KEY, JSON.stringify({ version: 2, ...partial }));
		expect(loadPlayStats()).toBeNull();
	});

	it('clears the record on reset', () => {
		savePlayStats(STATS);
		resetPlayStats();
		expect(loadPlayStats()).toBeNull();
		expect(localStorage.getItem(PLAY_STATS_KEY)).toBeNull();
	});

	it('stores an empty record as the zeroes it is', () => {
		savePlayStats(EMPTY_PLAY_STATS);
		expect(loadPlayStats()).toEqual(EMPTY_PLAY_STATS);
	});
});

describe('sim config', () => {
	const CONFIG: SimConfig = {
		rounds: 100_000,
		deviations: 'full',
		cutCardVarianceDecks: 0.5,
		wongInCount: 1,
		wongOutCount: -1,
		otherSpots: 2,
		seed: 987654,
		reseedEachRun: false,
	};

	it('round-trips a saved config', () => {
		saveSimConfig(CONFIG);
		expect(loadSimConfig()).toEqual(CONFIG);
	});

	it('round-trips the default one', () => {
		saveSimConfig(DEFAULT_SIM_CONFIG);
		expect(loadSimConfig()).toEqual(DEFAULT_SIM_CONFIG);
	});

	it('returns null when nothing has been saved', () => {
		expect(loadSimConfig()).toBeNull();
	});

	it('rejects a stored config from another schema version', () => {
		localStorage.setItem(
			SIM_CONFIG_KEY,
			JSON.stringify({ version: 99, ...DEFAULT_SIM_CONFIG })
		);
		expect(loadSimConfig()).toBeNull();
	});

	it('drops a version 1 record, whose wong-out counted the other way', () => {
		// Version 1 read `wongOutCount` as a count to get up *above*, so a stored +6
		// means the opposite of what it would mean now. The bump is what keeps it
		// from being restored as a setting that sits the session out.
		localStorage.setItem(
			SIM_CONFIG_KEY,
			JSON.stringify({ version: 1, ...DEFAULT_SIM_CONFIG, wongOutCount: 6 })
		);
		expect(loadSimConfig()).toBeNull();
	});

	it('rejects a value no option in the form offers', () => {
		// A round count the select cannot show would leave the form with nothing
		// selected, so the record is dropped rather than restored.
		localStorage.setItem(
			SIM_CONFIG_KEY,
			JSON.stringify({ version: 2, ...DEFAULT_SIM_CONFIG, rounds: 12_345 })
		);
		expect(loadSimConfig()).toBeNull();

		localStorage.setItem(
			SIM_CONFIG_KEY,
			JSON.stringify({ version: 2, ...DEFAULT_SIM_CONFIG, deviations: 'psychic' })
		);
		expect(loadSimConfig()).toBeNull();
	});

	it('rejects a malformed record', () => {
		localStorage.setItem(SIM_CONFIG_KEY, 'not json');
		expect(loadSimConfig()).toBeNull();

		localStorage.setItem(SIM_CONFIG_KEY, JSON.stringify({ version: 2 }));
		expect(loadSimConfig()).toBeNull();
	});
});

describe('train config', () => {
	it('round-trips the drill and every mode', () => {
		const config = {
			drill: 'deviation' as const,
			modes: {
				basic: 'hard' as const,
				counting: 'test' as const,
				deviation: 'easy' as const,
			},
		};
		saveTrainConfig(config);
		expect(loadTrainConfig()).toEqual(config);
	});

	it('returns null when nothing has been saved', () => {
		expect(loadTrainConfig()).toBeNull();
	});

	it('drops a record naming a drill or mode this build does not offer', () => {
		localStorage.setItem(
			TRAIN_CONFIG_KEY,
			JSON.stringify({ version: 1, ...DEFAULT_TRAIN_CONFIG, drill: 'poker' })
		);
		expect(loadTrainConfig()).toBeNull();
		localStorage.setItem(
			TRAIN_CONFIG_KEY,
			JSON.stringify({
				version: 1,
				...DEFAULT_TRAIN_CONFIG,
				modes: { ...DEFAULT_TRAIN_CONFIG.modes, basic: 'expert' },
			})
		);
		expect(loadTrainConfig()).toBeNull();
	});
});

describe('train scores', () => {
	const boards = {
		'basic:easy:6|0|0|1|4|0|1|none': [
			{
				correct: 9,
				total: 10,
				timeMs: 31_000,
				date: '2026-09-11T00:00:00.000Z',
				seed: 12,
				rules: '6 decks · S17',
			},
		],
	};

	it('round-trips every board', () => {
		saveTrainScores(boards);
		expect(loadTrainScores()).toEqual(boards);
	});

	it('returns null when nothing has been saved', () => {
		expect(loadTrainScores()).toBeNull();
	});

	it('drops a record from another schema version, or a malformed one', () => {
		localStorage.setItem(TRAIN_SCORES_KEY, JSON.stringify({ version: 99, boards }));
		expect(loadTrainScores()).toBeNull();
		localStorage.setItem(
			TRAIN_SCORES_KEY,
			JSON.stringify({ version: 1, boards: { 'basic:easy:x': [{ correct: 'nine' }] } })
		);
		expect(loadTrainScores()).toBeNull();
	});
});
