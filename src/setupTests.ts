// Setup file for tests
import { afterEach } from 'vitest';
import { cleanup } from '@solidjs/testing-library';

import { computeEvWorkerResponse, type EvWorkerRequest } from '#utils/evWorkerProtocol';

// jsdom has no ResizeObserver; Ark UI's floating-ui positioning (popovers,
// hover cards, tooltips, ...) needs one to observe anchor/content elements.
class ResizeObserverStub {
	observe() {}
	unobserve() {}
	disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub;

// jsdom has no Worker implementation. EvTable offloads EV computation to
// blackjackEv.worker.ts via a real Worker in the browser; this stub runs the
// same request/response protocol on a microtask instead of a real thread, so
// component tests can await it like the real async flow.
class WorkerStub {
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	private readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();

	postMessage(data: EvWorkerRequest) {
		queueMicrotask(() => {
			const event = new MessageEvent('message', { data: computeEvWorkerResponse(data) });
			this.onmessage?.(event);
			for (const listener of this.listeners.get('message') ?? []) listener(event);
		});
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
