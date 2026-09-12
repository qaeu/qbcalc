/**
 * Where popups that escape their container -- select menus, and anything else
 * portalled out to avoid being clipped -- should be mounted.
 *
 * The default, and the right answer nearly everywhere, is the document body.
 * Inside a modal dialog it is the wrong one three times over: a popup portalled
 * to the body sits outside the dialog's own DOM, so it paints beneath the
 * dialog's z-index, the dialog's dismissable layer reads a click on it as a
 * click outside itself and shuts, and the modal's aria-hidden sweep takes it
 * away from screen readers. A dialog that has somewhere better to offer
 * provides it here, and the popups follow.
 */

import { createContext, useContext, type Accessor } from 'solid-js';

const PortalMountContext = createContext<Accessor<HTMLElement | undefined>>();

export const PortalMountProvider = PortalMountContext.Provider;

/** The container popups should mount into, or `undefined` for the body. */
export function usePortalMount(): Accessor<HTMLElement | undefined> {
	return useContext(PortalMountContext) ?? (() => undefined);
}
