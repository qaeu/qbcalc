import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';

import { HI_LO_TAGS } from '#utils/settings/countingSystems';
import { DEFAULT_RULE_SET } from '#utils/ev/rules';
import { DEFAULT_PLAY_CONFIG, type PlayConfig } from '#utils/settings/storage';

import PlayView from '#c/play/PlayView';

/** Instant dealing, so the felt is never mid-animation when a test reads it. */
const CONFIG: PlayConfig = {
	...DEFAULT_PLAY_CONFIG,
	animationSpeed: 'instant',
	showCount: true,
};

function renderView(seed = 1234): void {
	render(() => (
		<PlayView
			ruleSet={DEFAULT_RULE_SET}
			tags={HI_LO_TAGS}
			config={CONFIG}
			bankroll={1000}
			unit={25}
			grids={null}
			onCountChange={() => {}}
			seed={seed}
		/>
	));
}

/** The ranks currently on the felt, dealer's seat first. */
function felt(): string[] {
	return [...document.querySelectorAll('.felt__card-rank')].map(
		(card) => card.textContent ?? ''
	);
}

function runningCount(): string {
	return screen.getByText(/^RC/).textContent ?? '';
}

/** Deals one round and settles it, leaving the felt on the pause. */
function playARound(): void {
	fireEvent.click(screen.getByRole('button', { name: 'Deal' }));
	// A natural either way settles on its own; anything else needs a decision.
	const stand = screen.queryByRole('button', { name: /Stand/ });
	if (stand !== null) fireEvent.click(stand);
}

afterEach(() => {
	localStorage.clear();
});

describe('PlayView', () => {
	describe('persistence', () => {
		it('puts the same shoe and hand back on a reload', () => {
			renderView();
			fireEvent.click(screen.getByRole('button', { name: 'Deal' }));
			const dealt = felt();
			const count = runningCount();
			expect(dealt.length).toBeGreaterThan(0);

			cleanup();
			renderView();

			expect(felt()).toEqual(dealt);
			expect(runningCount()).toBe(count);
			// Still the same round, waiting on the same decision.
			expect(screen.getByRole('button', { name: /Stand/ })).toBeDefined();
		});

		it('deals on from the shoe rather than the top of it', () => {
			renderView();
			playARound();
			fireEvent.click(screen.getByRole('button', { name: 'Next hand' }));
			const count = runningCount();

			cleanup();
			renderView();

			expect(runningCount()).toBe(count);
			expect(count).not.toBe('RC 0');
		});

		it('drops a stored session dealt under other rules', () => {
			renderView();
			fireEvent.click(screen.getByRole('button', { name: 'Deal' }));
			const dealt = felt();

			cleanup();
			render(() => (
				<PlayView
					ruleSet={{ ...DEFAULT_RULE_SET, decks: 2 }}
					tags={HI_LO_TAGS}
					config={CONFIG}
					bankroll={1000}
					unit={25}
					grids={null}
					onCountChange={() => {}}
					seed={1234}
				/>
			));

			// A fresh shoe under the new rules: nothing dealt, nothing counted.
			expect(felt()).toEqual([]);
			expect(runningCount()).toBe('RC 0');
			expect(dealt.length).toBeGreaterThan(0);
		});
	});

	describe('New shoe', () => {
		it('shuffles up: a full shoe, a zero count, and cards nobody has seen', () => {
			renderView();
			playARound();
			fireEvent.click(screen.getByRole('button', { name: 'Next hand' }));
			expect(runningCount()).not.toBe('RC 0');

			fireEvent.click(screen.getByRole('button', { name: 'New shoe' }));

			expect(runningCount()).toBe('RC 0');
			expect(screen.getByText('6 decks left')).toBeDefined();
		});

		it('deals a different shoe each time, and stores the one it moved to', () => {
			renderView();
			fireEvent.click(screen.getByRole('button', { name: 'Deal' }));
			const first = felt();

			fireEvent.click(screen.getByRole('button', { name: /Stand/ }));
			fireEvent.click(screen.getByRole('button', { name: 'Next hand' }));
			fireEvent.click(screen.getByRole('button', { name: 'New shoe' }));
			fireEvent.click(screen.getByRole('button', { name: 'Deal' }));
			const second = felt();
			expect(second).not.toEqual(first);

			cleanup();
			renderView();
			expect(felt()).toEqual(second);
		});

		it('answers the N key while betting', () => {
			renderView();
			playARound();
			fireEvent.click(screen.getByRole('button', { name: 'Next hand' }));
			expect(runningCount()).not.toBe('RC 0');

			fireEvent.keyDown(document.body, { key: 'n' });

			expect(runningCount()).toBe('RC 0');
		});
	});
});
