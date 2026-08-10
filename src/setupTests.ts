// Setup file for tests
import { afterEach } from 'vitest';
import { cleanup } from '@solidjs/testing-library';

// Cleanup after each test
afterEach(() => {
	cleanup();
});
