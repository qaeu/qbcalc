# Testing Documentation

## Overview

This project uses [Vitest](https://vitest.dev/) as the testing framework along with [@solidjs/testing-library](https://github.com/solidjs/solid-testing-library) for component testing.

## Running Tests

```bash
# Run tests once
npm test

# Run tests in watch mode
npx vitest

# Run a single test file
npm test -- App.test.tsx

# Run tests with UI
npm run test:ui

# Run tests with coverage
npm run test:coverage
```

## Test Structure

Tests live in `tests/`, mirroring the `src/` tree:

```
src/
├── App.tsx
└── utils/
    └── ev.ts
tests/
├── App.test.tsx
└── utils/
    └── ev.test.ts
```

## Configuration

### vitest.config.ts

- JSDOM environment for DOM testing
- Global test APIs (`describe`/`it`/`expect` without imports)
- SolidJS plugin integration
- `#`, `#c`, `#styles` subpath aliases (most specific prefix first)
- `setupFiles` pointing at `src/setupTests.ts`

### src/setupTests.ts

Runs `cleanup()` from `@solidjs/testing-library` after each test.

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
