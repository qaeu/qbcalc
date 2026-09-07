# Testing Documentation

## Overview

This project uses [Vitest](https://vitest.dev/) as the testing framework along with [@solidjs/testing-library](https://github.com/solidjs/solid-testing-library) for component testing.

## Running Tests

```bash
# Run tests once
npm test

# Run tests in watch mode
npx vitest

# Run one project on its own
npm run test:unit
npm run test:integration

# Run a single test file
npm test -- EvTable.test.tsx

# Run tests with UI
npm run test:ui

# Run tests with coverage
npm run test:coverage
```

## Test Structure

Tests live in `tests/`, mirroring the `src/` tree, with the end-to-end tests in
`tests/integration/` instead:

```
src/
├── App.tsx
└── utils/
    └── ev.ts
tests/
├── components/
│   └── EvTable.test.tsx
├── integration/
│   ├── appHarness.ts
│   └── app.play.test.tsx
└── utils/
    └── ev.test.ts
```

Two projects, split by what a test drives rather than by what it asserts:

- **unit** — everything outside `tests/integration/`: a utility, or a component
  rendered on its own with props it is handed.
- **integration** — `tests/integration/`, which renders the whole `<App />` over
  the real worker and the real EV engine, and drives it through the header, the
  sidebar and the viewport the way a user would. Each case costs seconds, so
  every one carries an explicit timeout (`MOUNT_TIMEOUT_MS` and friends from
  `appHarness.ts`, which also holds the view switches, the viewport stub and the
  worker spy the files share). One file per feature: mount and recalculation,
  the count keys, the full-calculation button, the compact viewport, Play, Sim.
  `app.sim.test.tsx` runs a deliberately tiny simulation — a thousand hands,
  written straight to `qbcalc:sim-config` rather than driven through the form —
  and carries `SIM_RUN_TIMEOUT_MS`, since the run finishes over many turns of the
  event loop rather than in one call.

`npm test` runs both.

## Configuration

### vitest.config.ts

- JSDOM environment for DOM testing
- Global test APIs (`describe`/`it`/`expect` without imports)
- SolidJS plugin integration
- `#`, `#c`, `#styles` subpath aliases (most specific prefix first)
- `setupFiles` pointing at `src/setupTests.ts`

### src/setupTests.ts

Runs `cleanup()` from `@solidjs/testing-library` after each test, and clears
`localStorage`.

It also stands in for jsdom's missing `ResizeObserver`, `Element.scrollTo` and
`Worker`. The `Worker` stub serves **two** protocols and routes on the URL it was
constructed with, exactly as the browser would:

- anything else — `evWorkerProtocol.ts`'s `computeEvWorkerResponse`, answered on a
  microtask so a component test can await it like the real async flow;
- a URL naming `sim.worker` — `simWorkerProtocol.ts`'s `handleSimWorkerMessage`,
  which runs its own chunked loop across zero-delay timeouts and emits the same
  `progress` / `complete` / `cancelled` / `error` sequence the real worker does.

The sim protocol can also be driven directly, without a stub Worker at all — see
`tests/utils/simWorkerProtocol.test.ts`, which is what the split between the
protocol module and the thin worker shell is for.

## Writing New Tests

### For Utility Functions

```typescript
import { describe, it, expect } from 'vitest';
import { yourFunction } from '#utils/yourModule';

describe('yourFunction', () => {
	it('should do something', () => {
		const result = yourFunction(input);
		expect(result).toBe(expected);
	});
});
```

EV values are floating point — assert with `toBeCloseTo`, not `toBe`:

```typescript
expect(result.ev).toBeCloseTo(-0.0053, 4);
```

### For Components

```typescript
import { render, screen } from '@solidjs/testing-library';
import YourComponent from '#c/YourComponent';

describe('YourComponent', () => {
	it('should render', () => {
		render(() => <YourComponent />);
		expect(screen.getByText('Expected Text')).toBeDefined();
	});
});
```

## Continuous Integration

`.github/workflows/test.yml` runs the suite on every pull request targeting `main`, `master`, or `dev`.

## Best Practices

1. **Descriptive Test Names**: Use clear, descriptive names for test cases
2. **Arrange-Act-Assert**: Follow the AAA pattern in tests
3. **Test Isolation**: Each test should be independent
4. **Mock External Dependencies**: Use `vi.mock` for storage, timers, and other side effects
5. **Test Edge Cases**: Include tests for error conditions and edge cases
6. **Keep Tests Simple**: Each test should verify one specific behaviour
