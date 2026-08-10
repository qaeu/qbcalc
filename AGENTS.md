## Project Overview

qbcalc is a client-side blackjack expected value (EV) calculator. It's a single-page static app built with **SolidJS** and **Vite**, performing all EV computation locally in the browser.

> **Status**: early scaffold. `src/App.tsx` renders a placeholder; the EV engine has not been implemented yet.

### Key Architectural Principles

- **Stateless Hosting**: Deployed as a static site to GitHub Pages with no backend server required.
- **Browser Storage**: All user data is persisted exclusively in browser storage (localStorage/IndexedDB).
- **Pure Computation**: EV logic lives in `src/utils/` as pure, framework-free functions so it can be unit tested without rendering components.

### Technology Stack

| Layer          | Technology                        |
| -------------- | --------------------------------- |
| **Language**   | TypeScript                        |
| **Hosting**    | GitHub Pages                      |
| **Framework**  | SolidJS                           |
| **Build Tool** | Vite                              |
| **Testing**    | Vitest + @solidjs/testing-library |
| **Styling**    | SASS/SCSS                         |
| **Linting**    | ESLint (flat config) + Prettier   |

### Code Organization

```
src/
├── App.tsx                      # Main entry point; layout
├── index.tsx                    # SolidJS app initialization
├── setupTests.ts                # Test configuration
├── types.d.ts                   # Global type definition file
├── styles/
│   ├── _theme.scss              # Colour sets, shadows, reusable mixins
│   ├── _base.scss               # Cascade layers, element defaults
│   └── *.scss                   # Component specific stylings
├── components/
│   └── *.tsx                    # SolidJS components
└── utils/
    └── *.ts                     # EV engine and utility scripts
tests/
└── **/*.test.ts(x)              # Mirrors the src/ tree
```

### Subpath Imports

`package.json` `imports` and the matching `tsconfig.json` `paths` define:

| Prefix      | Resolves to           |
| ----------- | --------------------- |
| `#*`        | `./src/*`             |
| `#c/*`      | `./src/components/*`  |
| `#styles/*` | `./src/styles/*.scss` |

Use these instead of relative `../../` chains. Order matters when adding aliases to
`vitest.config.ts` — list the most specific prefix first, or `#` will swallow `#c/`.

## Development Guidelines

### SolidJS Best Practices

- **Use fine-grained reactivity**: Prefer `createSignal`, `createEffect`, and `createMemo` over broad re-renders.
- **Avoid refs unless necessary**: SolidJS generally doesn't need refs; use signal-based state instead.
- **Resource management**: Always clean up timers, workers, and event listeners in cleanup functions.

### TypeScript Standards

- **Strict mode**: All code uses `strict: true` in `tsconfig.json`.
- **Explicit types**: Avoid `any`; use union types and generics instead.
- **Component types**: Always specify `Component` return type or generic interface for SolidJS components.
- **Interface over type**: Prefer `interface` for object shapes; use `type` only when required.

### Code style

Formatting is enforced by Prettier (`.prettierrc`): tabs, single quotes, 90 column width.

- **Code structure**: TypeScript files follow this ordered structure:
  - File header
  - Imports
    - External packages
    - Types
    - Constants
    - Components
    - Utils
    - Stylings
  - Exported constants
  - Local types
  - Local constants
  - Local functions
  - Exported functions

### SASS/SCSS Styling

- **Module system**: Use `@use` for importing theme variables and mixins.
- **Theme file**: `src/styles/_theme.scss` contains:
  - **Colour variables**: Radix colour scales mapped through `_colourset()` into semantic slots (`fg`, `base`, `sep`, `bg`, `fade`, …), grouped as `$primaries`, `$neutrals`, `$successes`, `$warnings`, `$errors`.
  - **Reusable mixins**: `container`, `card`, `info-box`, `button`, `code-block`, `shadow`/`shadow-short`/`shadow-inset`.
- **Dark mode**: Colours are CSS custom properties; toggling `.dark-theme` on `<body>` reskins the app.
- **Component stylesheets**: Each component has a corresponding `.scss` file using mixins from `_theme.scss`.
- **Class naming**: Use BEM-like convention for nested components.
- **Selector clarity**: Avoid heavily nested selectors; prefer adding classes or ids if necessary.
- **No inline styles**: Avoid inline `style` attributes; use CSS classes and mixins instead.

### Browser Storage Patterns

- **Storage choice**: Use `localStorage` for persistent data (simple, synchronous, ~5-10MB limit).
- **Structured data**: Always serialize/deserialize JSON with try-catch error handling.
- **Versioning**: Include a schema version field in stored JSON for future migrations.
- **Export format**: When exporting, use `.json` with ISO timestamps for auditability.

### EV Engine Guidelines

- **Pure functions**: EV calculation must be side-effect free and independent of SolidJS so it is directly unit testable.
- **Rules as data**: Table variations (deck count, dealer hits soft 17, blackjack payout, DAS, surrender) belong in a `RuleSet` object passed in — never hardcoded.
- **Exact over sampled**: Prefer exact combinatorial computation; if simulation is ever used, seed it so tests are deterministic.
- **Floating point**: Compare EVs in tests with `toBeCloseTo`, not `toBe`.
- **Known baselines**: Validate against published basic-strategy EV tables; encode those as test fixtures.

## Tests

Run individual test files using:

```bash
npm test -- example.test.ts
```

- **Maintain test coverage**: Add tests for each new feature, update existing tests when the underlying behaviour has changed.
- **Test file readability**: Use nested `describe()` blocks to create reasonable sections.

See [TESTING.md](./TESTING.md) for setup details.

## Contributing Tips

- Keep components focused and composable.
- Document complex logic with comments.
- Write tests for edge cases.
- Avoid side effects in render functions; use `createEffect` instead.
