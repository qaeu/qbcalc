import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';

import HintPopover from '#c/HintPopover';
import SettingsItem from '#c/SettingsItem';

const HINT = 'Number of decks in the shoe';

const trigger = () => screen.getByRole('button', { name: 'About Decks' });

/** `pointerType` is what tells a mouse's hover from a tap's phantom one. */
const mouse = { pointerType: 'mouse' };

const hintShown = () => waitFor(() => expect(screen.getByText(HINT)).toBeDefined());
const hintGone = () => waitFor(() => expect(screen.queryByText(HINT)).toBeNull());

describe('HintPopover', () => {
	it('shows the hint on hover and hides it again when the pointer leaves', async () => {
		render(() => <HintPopover text={HINT} label="Decks" />);

		expect(screen.queryByText(HINT)).toBeNull();
		fireEvent.pointerEnter(trigger(), mouse);
		await hintShown();

		fireEvent.pointerLeave(trigger(), mouse);
		await hintGone();
	});

	it('shows the hint on a click, which is the only way in on a touch screen', async () => {
		render(() => <HintPopover text={HINT} label="Decks" />);

		// A tap raises a phantom pointerenter of its own before the click; only
		// a mouse's should open anything.
		fireEvent.pointerEnter(trigger(), { pointerType: 'touch' });
		expect(screen.queryByText(HINT)).toBeNull();

		fireEvent.click(trigger());
		await hintShown();
	});

	it('keeps a clicked hint up when the pointer leaves, until it is clicked again', async () => {
		render(() => <HintPopover text={HINT} label="Decks" />);

		fireEvent.pointerEnter(trigger(), mouse);
		fireEvent.click(trigger());
		await hintShown();

		fireEvent.pointerLeave(trigger(), mouse);
		expect(screen.getByText(HINT)).toBeDefined();

		fireEvent.pointerEnter(trigger(), mouse);
		fireEvent.click(trigger());
		await hintGone();
	});

	it('opens on Enter, for a keyboard that has no pointer to hover with', async () => {
		render(() => <HintPopover text={HINT} label="Decks" />);

		trigger().focus();
		fireEvent.keyDown(trigger(), { key: 'Enter' });
		await hintShown();

		fireEvent.keyDown(trigger(), { key: 'Enter' });
		await hintGone();
	});

	it('leaves the setting its label names as the label’s own control', () => {
		render(() => (
			<SettingsItem label="Decks" helptext={HINT}>
				<input type="number" value={6} />
			</SettingsItem>
		));

		// The hint's trigger comes first in the label, so a <button> there would
		// take the association -- and the name -- from the field itself.
		expect(screen.getByLabelText('Decks')).toBe(screen.getByRole('spinbutton'));
	});
});
