/**
 * The settings sidebar as an edge-anchored panel, for viewports too narrow --
 * or too short -- to give it a column of its own. Holds nothing itself: the
 * sidebar is handed in as children, and `App` decides which of the two places
 * it is mounted in.
 */

import { Dialog } from '@ark-ui/solid/dialog';
import { Portal } from 'solid-js/web';
import { createSignal, type Component, type JSX } from 'solid-js';

import { X } from 'lucide-solid';

import { PortalMountProvider } from '#c/common/portalMount';

import '#styles/settings/SettingsDrawer';

interface SettingsDrawerProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	children: JSX.Element;
}

const SettingsDrawer: Component<SettingsDrawerProps> = (props) => {
	// The panel's own element, offered to everything inside it as the place to
	// portal popups to -- see `#c/portalMount`. Created up front rather than
	// captured by a ref, so it is already there when the children below are
	// evaluated: a `Portal` reads its mount once, at creation, and a select that
	// rendered a tick too early would portal to the body for good. It is
	// attached to the panel by the ref, and anything rendered into it in the
	// meantime comes along when it is.
	const layer = document.createElement('div');
	layer.className = 'settings-drawer__layer';
	const [mount] = createSignal<HTMLElement>(layer);

	return (
		<Dialog.Root
			open={props.open}
			onOpenChange={(details) => props.onOpenChange(details.open)}
			// Mounted on first open and kept mounted from then on, so the form
			// behind it holds its state -- the selected tab, and anything typed but
			// not yet settled -- across a close and reopen.
			lazyMount
			unmountOnExit={false}
		>
			<Portal>
				<Dialog.Backdrop class="settings-drawer__backdrop" />
				<Dialog.Positioner class="settings-drawer__positioner">
					<Dialog.Content class="settings-drawer">
						<header class="settings-drawer__header">
							<Dialog.Title class="settings-drawer__title">Settings</Dialog.Title>
							<Dialog.CloseTrigger class="settings-drawer__close" aria-label="Close">
								<X />
							</Dialog.CloseTrigger>
						</header>
						<PortalMountProvider value={mount}>{props.children}</PortalMountProvider>
						{layer}
					</Dialog.Content>
				</Dialog.Positioner>
			</Portal>
		</Dialog.Root>
	);
};

export default SettingsDrawer;
