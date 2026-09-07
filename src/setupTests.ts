// Setup file for tests
import { afterEach } from 'vitest';
import { cleanup } from '@solidjs/testing-library';

import { computeEvWorkerResponse, type EvWorkerRequest } from '#utils/evWorkerProtocol';
import { handleSimWorkerMessage, type SimWorkerMessage } from '#utils/simWorkerProtocol';

// jsdom has no ResizeObserver; Ark UI's floating-ui positioning (popovers,
// hover cards, tooltips, ...) needs one to observe anchor/content elements.
class ResizeObserverStub {
	observe() {}
	unobserve() {}
	disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub;

// jsdom implements no scrolling, so Element.scrollTo is missing. Ark UI's
// select scrolls its highlighted option into view when the listbox opens,
// and the resulting TypeError otherwise aborts the interaction mid-flight.
Element.prototype.scrollTo ??= () => {};

// jsdom has no Worker implementation. Two of the app's modules are offloaded to
// real Workers in the browser -- blackjackEv.worker.ts and sim.worker.ts -- so
// this stub runs the same protocols in-process instead of on a thread. Which one
// a stub answers is decided by the URL it was constructed with, exactly as the
// browser decides it: an EV request answers on a microtask, a sim request runs
// its own chunked loop and emits the progress/complete sequence the real worker
// would.
class WorkerStub {
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	private readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();
	private readonly isSim: boolean;

	constructor(url?: URL | string) {
		this.isSim = String(url ?? '').includes('sim.worker');
	}

	private emit(data: unknown) {
		const event = new MessageEvent('message', { data });
		this.onmessage?.(event);
		for (const listener of this.listeners.get('message') ?? []) listener(event);
	}

	postMessage(data: EvWorkerRequest | SimWorkerMessage) {
		if (this.isSim) {
			handleSimWorkerMessage(data as SimWorkerMessage, (response) => this.emit(response));
			return;
		}
		queueMicrotask(() => this.emit(computeEvWorkerResponse(data as EvWorkerRequest)));
	}

	addEventListener(type: string, listener: (event: MessageEvent) => void) {
		if (!this.listeners.has(type)) this.listeners.set(type, new Set());
		this.listeners.get(type)!.add(listener);
	}

	removeEventListener(type: string, listener: (event: MessageEvent) => void) {
		this.listeners.get(type)?.delete(listener);
	}

	terminate() {}
}
// @ts-expect-error -- test stub, not a full DOM Worker implementation
globalThis.Worker ??= WorkerStub;

// Cleanup after each test
afterEach(() => {
	cleanup();
	localStorage.clear();
});
