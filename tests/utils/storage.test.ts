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
	type BankrollConfig,
	type CalculatorConfig,
} from '#utils/storage';

const STORAGE_KEY = 'qbcalc:calculator-config';
const DISPLAY_MODE_KEY = 'qbcalc:cell-display-mode';
const BANKROLL_KEY = 'qbcalc:bankroll';
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
			count: -3,
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

		expect(loadCalculatorConfig()).toEqual({
			...DEFAULT_CONFIG,
			decks: 6,
			count: 4,
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
			count: 4,
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
			splitLimit: 2,
			resplitAces: true,
		};
		delete v3.hitSplitAces;
		delete v3.insurance;
		localStorage.setItem(STORAGE_KEY, JSON.stringify(v3));

		expect(loadCalculatorConfig()).toEqual({
			...DEFAULT_CONFIG,
			decks: 6,
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
			hitSplitAces: false,
		};
		delete v4.insurance;
		localStorage.setItem(STORAGE_KEY, JSON.stringify(v4));

		expect(loadCalculatorConfig()).toEqual({
			...DEFAULT_CONFIG,
			decks: 2,
			hitSplitAces: false,
			// Filled in from the current default, whichever way it points.
			insurance: DEFAULT_CONFIG.insurance,
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
				count: 1,
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
