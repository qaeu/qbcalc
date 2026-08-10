import { describe, it, expect, afterEach } from 'vitest';

import { loadCalculatorConfig, saveCalculatorConfig } from '#utils/storage';

const STORAGE_KEY = 'qbcalc:calculator-config';

afterEach(() => {
	localStorage.clear();
});

describe('loadCalculatorConfig', () => {
	it('returns null when nothing has been saved', () => {
		expect(loadCalculatorConfig()).toBeNull();
	});

	it('returns the saved config after a round trip through saveCalculatorConfig', () => {
		saveCalculatorConfig({ decks: 6, count: -3, dealerHitsSoft17: false });

		expect(loadCalculatorConfig()).toEqual({
			decks: 6,
			count: -3,
			dealerHitsSoft17: false,
		});
	});

	it('returns null for malformed JSON', () => {
		localStorage.setItem(STORAGE_KEY, '{not json');

		expect(loadCalculatorConfig()).toBeNull();
	});

	it('returns null when a required field is missing or the wrong type', () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ version: 1, decks: '6', count: 1, dealerHitsSoft17: false })
		);

		expect(loadCalculatorConfig()).toBeNull();
	});

	it('returns null for a config saved under a different schema version', () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ version: 999, decks: 6, count: 1, dealerHitsSoft17: false })
		);

		expect(loadCalculatorConfig()).toBeNull();
	});
});
