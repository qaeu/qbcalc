/**
 * The help icon beside a label, and the short explanation it reveals.
 *
 * A native `title` tooltip is unreachable on a touch screen -- there is no
 * hover there, and a long press raises the browser's own menu instead -- so
 * the hint lives in a real popover. It opens on hover for a mouse, on tap or
 * click for everyone, and on Enter/Space for the keyboard.
 *
 * Hover and click share one open state, with a `pinned` flag deciding whether
 * leaving the trigger closes it: a hint opened by pointing at it follows the
 * pointer away, one opened deliberately stays until it is dismissed.
 *
 * A hover waits out a short delay first, so that crossing a column of settings
 * does not trail popovers behind the pointer; a click or a keypress opens the
 * hint at once. Only one hint shows at a time -- see `activeHint` below.
 */

import { Popover } from '@ark-ui/solid/popover';
import { createSignal, onCleanup, type Component, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';

import { Info } from 'lucide-solid';

import { usePortalMount } from '#c/portalMount';

import '#styles/HintPopover';

/** Zag's trigger props less `type`, which belongs to a `<button>` alone. */
function spanProps(triggerProps: JSX.HTMLAttributes<HTMLElement>) {
	const rest: Record<string, unknown> = { ...triggerProps };
	delete rest.type;
	return rest as JSX.HTMLAttributes<HTMLSpanElement>;
}

/**
 * How long the pointer has to rest on a trigger before its hint appears.
 * Sweeping across a column of settings should not set off a row of popovers;
 * a click or a keypress still opens one at once.
 */
const HOVER_DELAY_MS = 400;

/**
 * The hint that is open or about to open, closed by whichever one opens next.
 * A single shared slot rather than a signal: nothing renders from it, and the
 * hints only ever hand it between themselves.
 */
let activeHint: (() => void) | null = null;

interface HintPopoverProps {
	/** The explanation itself. Plain text -- a sentence or two, no markup. */
	text: string;
	/** What the hint is about, for the trigger's accessible name. */
	label: string;
}

const HintPopover: Component<HintPopoverProps> = (props) => {
	// The body, except inside the settings drawer, where a popover portalled to
	// the body would open underneath it and close it on the way -- see
	// `#c/portalMount`.
	const mount = usePortalMount();

	const [open, setOpen] = createSignal(false);
	// Set by a click or a keypress on the trigger, cleared by whatever closes
	// the hint again. Only an unpinned hint closes when the pointer leaves.
	const [pinned, setPinned] = createSignal(false);

	// Set while the pointer rests on the trigger, waiting out HOVER_DELAY_MS.
	let hoverTimer: ReturnType<typeof setTimeout> | undefined;

	const cancelHover = () => {
		clearTimeout(hoverTimer);
		hoverTimer = undefined;
	};

	const close = () => {
		cancelHover();
		if (activeHint === close) activeHint = null;
		setPinned(false);
		setOpen(false);
	};

	// Taking the floor: only one hint shows at a time, so whichever was open --
	// or was counting down to open -- gives way to this one.
	const show = (asPinned: boolean) => {
		if (activeHint && activeHint !== close) activeHint();
		activeHint = close;
		cancelHover();
		setPinned(asPinned);
		setOpen(true);
	};

	// A hover-opened hint is already showing what the click would ask for, so
	// the click pins it in place rather than toggling it shut and reopening it
	// on the hover that never left.
	const toggle = () => {
		if (open() && pinned()) close();
		else show(true);
	};

	// A hint torn down mid-hover -- a tab switched away from, say -- must not
	// leave its timer or its claim on the shared slot behind.
	onCleanup(close);

	return (
		<Popover.Root
			positioning={{ placement: 'top', gutter: 6 }}
			// A settings tab carries a dozen of these and shows one at a time,
			// so the hint's own subtree is built on first use and torn down
			// again when it closes rather than sitting hidden in the DOM.
			lazyMount
			unmountOnExit
			// A hint the pointer merely passed over must not pull focus off
			// whatever the user was doing. One that was asked for should: it is
			// a dialog, so focusing it is what has a screen reader read it out,
			// and Escape hands focus back to the trigger afterwards.
			autoFocus={pinned()}
			open={open()}
			// Only ever a dismissal -- Escape, or a click outside. Opening and
			// toggling are handled on the trigger below, so that hover and
			// click can share the one state.
			onOpenChange={(details) => {
				if (!details.open) close();
			}}
		>
			{/*
			 * Not a <button>: the hint sits inside its setting's `<label>`, and
			 * a button there would become the label's control -- stealing the
			 * setting's accessible name and the click on its text. A span is
			 * not labelable, so the real control keeps both; the ARIA role and
			 * the key handling below put back what the element gives up, and
			 * `type`, which Zag sets for the button it expects, comes off.
			 */}
			<Popover.Trigger
				asChild={(triggerProps) => (
					<span
						{...spanProps(triggerProps())}
						role="button"
						tabIndex={0}
						class="hint-popover__trigger"
						aria-label={`About ${props.label}`}
						// Zag's own click handler toggles the popover, but it is
						// declared before ours in the spread and so cannot see
						// the `preventDefault` that stops the surrounding label
						// from activating its control. Owning the toggle here
						// keeps the two in one place.
						onClick={(event: MouseEvent) => {
							event.preventDefault();
							toggle();
						}}
						onKeyDown={(event: KeyboardEvent) => {
							if (event.key !== 'Enter' && event.key !== ' ') return;
							event.preventDefault();
							toggle();
						}}
						onPointerEnter={(event: PointerEvent) => {
							// Touch and pen raise this too, just before the tap
							// the click handler above is already answering.
							if (event.pointerType !== 'mouse') return;
							// Returning to a hint already up -- a pinned one
							// especially -- has nothing to wait for.
							if (open()) return;
							cancelHover();
							hoverTimer = setTimeout(() => show(false), HOVER_DELAY_MS);
						}}
						onPointerLeave={(event: PointerEvent) => {
							if (event.pointerType !== 'mouse') return;
							cancelHover();
							if (!pinned()) close();
						}}
					>
						<Info />
					</span>
				)}
			/>
			<Portal mount={mount()}>
				<Popover.Positioner>
					{/* Named for the setting it explains: the content is a
					    dialog as far as ARIA is concerned, and an unnamed one
					    announces itself as nothing but "dialog". */}
					<Popover.Content class="hint-popover__content" aria-label={props.label}>
						<Popover.Arrow class="hint-popover__arrow">
							<Popover.ArrowTip class="hint-popover__arrow-tip" />
						</Popover.Arrow>
						<Popover.Description class="hint-popover__text">
							{props.text}
						</Popover.Description>
					</Popover.Content>
				</Popover.Positioner>
			</Portal>
		</Popover.Root>
	);
};

export default HintPopover;
