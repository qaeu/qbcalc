import { describe, it, expect } from 'vitest';
import { createSignal } from 'solid-js';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';

import SettingSelect from '#c/settings/SettingSelect';
import SettingsDrawer from '#c/settings/SettingsDrawer';

/** The drawer with its own open state, as `App` gives it. */
function renderDrawer() {
	const [open, setOpen] = createSignal(false);
	render(() => (
		<>
			<button type="button" onClick={() => setOpen(true)}>
				Settings
			</button>
			<SettingsDrawer open={open()} onOpenChange={setOpen}>
				<p>Panel contents</p>
			</SettingsDrawer>
		</>
	));
	const panel = () => document.querySelector('.settings-drawer');
	return { panel, contents: () => screen.queryByText('Panel contents') };
}

describe('SettingsDrawer', () => {
	it('stays out of the document until it is first opened', () => {
		const { panel, contents } = renderDrawer();
		expect(panel()).toBeNull();
		expect(contents()).toBeNull();
	});

	it('opens on the trigger and closes again on its close button', async () => {
		const { panel, contents } = renderDrawer();

		fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
		await waitFor(() => expect(panel()).not.toBeNull());
		expect(contents()).not.toBeNull();

		fireEvent.click(screen.getByRole('button', { name: 'Close' }));
		await waitFor(() => expect(panel()?.getAttribute('data-state')).not.toBe('open'));
	});

	// Escape is deliberately not asserted here. The dialog answers it, but it is
	// handled by a dismissable-layer stack that is shared module state, so which
	// layer a synthetic key press reaches depends on what ran before -- the same
	// reason EvTable's tests close the drill-down by its button.

	it('marks the closed panel hidden rather than just unstyling it', async () => {
		// The panel is kept mounted, so `hidden` is the only thing that takes it
		// off the screen -- and `.settings-drawer`'s own `display: flex` is quite
		// capable of overriding it. When that happened the sidebar sat there in
		// full view and ignored every click, since Zag drops the pointer events
		// on the positioner around it the moment the dialog closes.
		const { panel } = renderDrawer();

		fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
		await waitFor(() => expect(panel()).not.toBeNull());
		expect(panel()?.hasAttribute('hidden')).toBe(false);

		fireEvent.click(screen.getByRole('button', { name: 'Close' }));
		await waitFor(() => expect(panel()?.hasAttribute('hidden')).toBe(true));
	});

	describe('a dropdown opened inside it', () => {
		/** The drawer holding a select, which is what the sidebar's fields are. */
		function renderDrawerWithSelect() {
			const [open, setOpen] = createSignal(false);
			const [value, setValue] = createSignal('uk');
			render(() => (
				<>
					<button type="button" onClick={() => setOpen(true)}>
						Settings
					</button>
					<SettingsDrawer open={open()} onOpenChange={setOpen}>
						<SettingSelect
							options={[
								{ value: 'uk', label: 'UK' },
								{ value: 'us', label: 'US' },
							]}
							value={value()}
							onChange={setValue}
						/>
					</SettingsDrawer>
				</>
			));
			return { value, panel: () => document.querySelector('.settings-drawer') };
		}

		it('renders its menu inside the panel rather than out on the body', async () => {
			// A menu portalled to the body sits outside the dialog: it paints
			// under the drawer's own z-index, and the dialog's dismissable layer
			// reads a click on it as a click outside itself and shuts.
			const { panel } = renderDrawerWithSelect();
			fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
			await waitFor(() => expect(panel()).not.toBeNull());

			fireEvent.click(screen.getByRole('combobox'));
			const menu = await screen.findByRole('listbox');
			expect(panel()?.contains(menu)).toBe(true);
		});

		it('picks an option without closing the drawer', async () => {
			const { value, panel } = renderDrawerWithSelect();
			fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
			await waitFor(() => expect(panel()).not.toBeNull());

			fireEvent.click(screen.getByRole('combobox'));
			fireEvent.click(await screen.findByRole('option', { name: 'US' }));

			await waitFor(() => expect(value()).toBe('us'));
			expect(panel()?.getAttribute('data-state')).toBe('open');
		});
	});

	it('keeps its children mounted across a close and reopen', async () => {
		// The `unmountOnExit={false}` guarantee, and the reason for it: the
		// sidebar inside seeds its form at mount, so a teardown per close would
		// throw away anything typed but not yet settled.
		const { panel, contents } = renderDrawer();

		fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
		await waitFor(() => expect(panel()).not.toBeNull());
		const first = contents();

		fireEvent.click(screen.getByRole('button', { name: 'Close' }));
		await waitFor(() => expect(panel()?.getAttribute('data-state')).not.toBe('open'));
		expect(contents()).toBe(first);

		fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
		await waitFor(() => expect(panel()?.getAttribute('data-state')).toBe('open'));
		expect(contents()).toBe(first);
	});
});
