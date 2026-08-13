import { describe, it, expect, afterEach } from 'vitest';

import { ACE_FIVE_TAGS, type TagValues } from '#utils/blackjackEv';
import { loadCalculatorConfig, saveCalculatorConfig } from '#utils/storage';

const STORAGE_KEY = 'qbcalc:calculator-config';

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
		saveCalculatorConfig({
			decks: 6,
			count: -3,
			dealerHitsSoft17: false,
			system: 'custom',
			tags: CUSTOM_TAGS,
		});

		expect(loadCalculatorConfig()).toEqual({
			decks: 6,
			count: -3,
			dealerHitsSoft17: false,
			system: 'custom',
			tags: CUSTOM_TAGS,
		});
	});

	it('migrates a v1 config to the Ace-Five system', () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ version: 1, decks: 6, count: 4, dealerHitsSoft17: false })
		);

		expect(loadCalculatorConfig()).toEqual({
			decks: 6,
			count: 4,
			dealerHitsSoft17: false,
			system: 'ace-five',
			tags: ACE_FIVE_TAGS,
		});
	});

	it('returns null for malformed JSON', () => {
		localStorage.setItem(STORAGE_KEY, '{not json');

		expect(loadCalculatorConfig()).toBeNull();
	});

	it('returns null when a required field is missing or the wrong type', () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				version: 2,
				decks: '6',
				count: 1,
				dealerHitsSoft17: false,
				system: 'ace-five',
				tags: ACE_FIVE_TAGS,
			})
		);

		expect(loadCalculatorConfig()).toBeNull();
	});

	it('returns null when the tag values are incomplete or unknown', () => {
		const base = {
			version: 2,
			decks: 6,
			count: 1,
			dealerHitsSoft17: false,
			system: 'ace-five',
		};
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...base, tags: { '2': 0 } }));
		expect(loadCalculatorConfig()).toBeNull();

		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ ...base, system: 'hi-lo', tags: ACE_FIVE_TAGS })
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
