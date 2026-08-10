// Setup file for tests
import { afterEach } from 'vitest';
import { cleanup } from '@solidjs/testing-library';

// jsdom has no ResizeObserver; Ark UI's floating-ui positioning (popovers,
// hover cards, tooltips, ...) needs one to observe anchor/content elements.
class ResizeObserverStub {
	observe() {}
	unobserve() {}
	disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub;

// Cleanup after each test
afterEach(() => {
	cleanup();
});
