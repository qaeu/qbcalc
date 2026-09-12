## Project Overview

qbcalc is a client-side blackjack expected value (EV) calculator. It's a single-page static app built with **SolidJS** and **Vite**, performing all EV computation locally in the browser.

> **Status**: early scaffold. `src/App.tsx` renders five views off a hash route — the EV grids (`EvTable`, backed by `src/utils/ev/`), the Bankroll cards and graph, the Play felt, the Train view's graded drills on that same felt, and the Sim view, which deals a simulated session through the play stack and reports it against what the Bankroll view predicted.

### Key Architectural Principles

- **Stateless Hosting**: Deployed as a static site to GitHub Pages with no backend server required.
- **Browser Storage**: All user data is persisted exclusively in browser storage (localStorage/IndexedDB).
- **Pure Computation**: EV logic lives in `src/utils/` as pure, framework-free functions so it can be unit tested without rendering components.

### Technology Stack

| Layer          | Technology                                     |
| -------------- | ---------------------------------------------- |
| **Language**   | TypeScript                                     |
| **Hosting**    | GitHub Pages                                   |
| **Framework**  | SolidJS                                        |
| **Build Tool** | Vite                                           |
| **Testing**    | Vitest + @solidjs/testing-library              |
| **Styling**    | SASS/SCSS                                      |
| **Components** | @ark-ui/solid (headless), lucide-solid (icons) |
| **Linting**    | ESLint (flat config) + Prettier                |

### Code Organization

```
src/
├── App.tsx                      # Main entry point; layout
├── index.tsx                    # SolidJS app initialization
├── setupTests.ts                # Test configuration
├── types.d.ts                   # Global type definition file
├── styles/                      # Mirrors the components/ folders one for one
│   ├── _palette.scss            # The 12-step baize/gold/sand/mint/ruby/sky scales
│   ├── _theme.scss              # Colour sets, materials, shadows, reusable mixins
│   ├── _base.scss               # Cascade layers, element defaults
│   ├── App.scss                 # The app shell's own sheet
│   └── <folder>/*.scss          # One sheet per component, `@use '../base' as *`
├── components/                  # Grouped by the view each belongs to
│   ├── common/                  # AppHeader, Felt, HintPopover, StatBand, portalMount
│   ├── ev/                      # The EV board: table, cell popover, drill-down dialog
│   ├── bankroll/                # Bankroll cards, bet ramp editor, weighted-EV graph
│   ├── play/                    # The Play felt, its table and its stats
│   ├── train/                   # The Train view: picker, the drills, HUD, results
│   ├── sim/                     # The Sim view: setup, config, stats, trajectory
│   └── settings/                # The drawer/sidebar, its tabs, the shared inputs
└── utils/
    ├── ev/
    │   ├── cards.ts             # Rank vocabulary, hand arithmetic
    │   ├── rules.ts             # RuleSet, hand sets, rule-set cache key
    │   ├── composition.ts       # Shoe compositions, count adjustment
    │   ├── outcome.ts           # Win/push/lose algebra, per-action shape
    │   ├── precision.ts         # Fast/full presets: draw cap, player-card removal
    │   ├── shoe.ts              # The mutable composition models draw against
    │   ├── dealer.ts            # Dealer distribution, stand-EV table
    │   ├── player.ts            # Hit/double/surrender EVs and push odds
    │   ├── split.ts             # Split draw enumeration, resplit ladder
    │   ├── insurance.ts         # Insurance side bet, priced off the composition
    │   ├── engine.ts            # Action pricing, the three analysis grids
    │   ├── playGrids.ts         # The widened grids a played hand is looked up in
    │   └── tables.ts            # Base/count comparison tables, entry points
    ├── play/
    │   ├── rng.ts               # The one seeded generator both shoes deal from
    │   ├── shoe.ts              # A shoe dealt card by card, counted as it is seen
    │   ├── game.ts              # The round state machine, every table rule in it
    │   ├── coach.ts             # Grading a decision against the engine's prices
    │   ├── reveal.ts            # The reveal queue's arithmetic, shared by both felts
    │   ├── session.ts           # The shoe and round on the felt, stored and read back
    │   └── stats.ts             # The lifetime training record
    ├── train/
    │   ├── drills.ts            # The three drills, their modes and seeded question pools
    │   ├── grade.ts             # Pricing a question, grading answers and checkpoints
    │   ├── run.ts               # A finished drill, and the words its verdicts use
    │   ├── scores.ts            # Highscore boards: keys, ranking, validation
    │   └── clock.ts             # The answer clock, and a Test's time limit
    ├── sim/
    │   ├── config.ts            # What a run is set to, and the options the form offers
    │   ├── indices.ts           # The Illustrious 18 as data, on the Hi-Lo count axis
    │   ├── policy.ts            # How the simulated player decides: basic / i18 / full
    │   ├── strategy.ts          # Grids per whole count, priced on demand and memoised
    │   ├── run.ts               # The loop: deal, bet, play, grade, bucket
    │   └── result.ts            # A finished run's derived figures, in one pure function
    ├── bankroll/
    │   ├── bankroll.ts          # Count frequency, bet spread, risk of ruin
    │   └── countRounds.ts       # Simulated shoes: rounds played at each count
    ├── settings/                # What the settings UI reads and persists
    │   ├── storage.ts           # Every stored config, loaded and validated
    │   ├── countingSystems.ts   # Counting system presets, as tag vectors
    │   └── rulePresets.ts       # Table-rule presets, and recovering one from rules
    ├── ui/                      # How a computed figure is displayed
    │   ├── format.ts            # Number and label formatting
    │   ├── actionStyle.ts       # Action fills and sign classes
    │   ├── cellDisplay.ts       # The grid's cell view modes and heat steps
    │   ├── counterSeat.ts       # Where a deviation counter sits on its cell
    │   ├── loadingPhase.ts      # Scattering skeletons across the pulse cycle
    │   └── gridBalance.ts       # Centring an auto-fit grid's last line
    ├── app/                     # App-shell plumbing
    │   ├── hashRoute.ts         # The five views, addressed by URL fragment
    │   ├── keyboard.ts          # Global shortcuts, and what may swallow a key
    │   ├── media.ts             # Media queries as signals
    │   └── settle.ts            # How long an input waits before a calculation
    ├── blackjackEv.worker.ts    # The EV calculator, off the main thread
    ├── sim.worker.ts            # A simulated session, in chunks, cancellable
    └── *WorkerProtocol.ts       # The two worker protocols, shared with the stub
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

### UI Component Guidelines

- **Ark UI for behaviour, not looks**: Use `@ark-ui/solid` headless components (dialogs, popovers, selects, sliders, etc.) for accessibility and interaction logic instead of hand-rolling focus traps, keyboard nav, or ARIA wiring.
- **Style with existing conventions**: Ark UI ships unstyled — target its parts with classes and style them via `_theme.scss` mixins/BEM classes like any other component; never reach for Ark's inline `style` props or a separate CSS-in-JS system.
- **Wrap, don't scatter**: If an Ark UI primitive is used in more than one place, wrap it in a component under `src/components/` with the project's own props/API rather than importing `@ark-ui/solid` parts ad hoc throughout the app.
- **Lucide for icons**: Use `lucide-solid` for all iconography instead of inline SVGs or other icon sets. Import icons individually (e.g. `import { ChevronDown } from 'lucide-solid'`) so unused icons are tree-shaken.
- **Icon sizing/colour**: Size and colour icons via `class`/CSS (`currentColor`, theme variables), not hardcoded `stroke`/`fill`/`size` props, so they follow dark-mode theming automatically.

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

- **Read the design doc first**: [docs/design-language.md](./docs/design-language.md)
  records the materials, the depth and colour systems, the EV board's fills and
  counters, and the Ark UI/Zag traps the stylesheets work around. Reasoning belongs
  there; the stylesheets keep short comments that point at it.
- **Module system**: Use `@use` for importing theme variables and mixins.
- **Palette file**: `src/styles/_palette.scss` holds hand-authored 12-step scales as CSS
  custom properties. They are _dark_ scales — step 1 is the deepest surface and step 12 the
  lightest ink — because the app's ground is baize rather than paper. The scales are
  `baize` (the table), `gold` (the cut card, and the accent), `sand` (printed ink, and the
  Hit fill), `mint`, `ruby` and `sky`, plus the `rail`, `panel` and `stock` materials.
- **Theme file**: `src/styles/_theme.scss` contains:
  - **Colour variables**: the scales above mapped through `_colourset()` into semantic slots
    (`fg`, `base`, `sep`, `bg`, `fade`, …), grouped as `$primaries`, `$neutrals`, `$sands`,
    `$successes`, `$warnings`, `$errors`, `$infos`.
  - **Material mixins**: `baize`, `rail`, `print`, `card-stock` — the physical surfaces the
    design is built from. Reach for these before inventing a background.
  - **Motion tokens**: `$dur-fast` (120ms, press and hover-in), `$dur-base` (180ms,
    hover-out and colour), `$dur-slow` (300ms, a recalculated figure), and `$ease` for all
    of them. `$control-height` / `$control-height-touch` are the heights every control
    lands on. Use the tokens rather than a duration of your own. The app carries no
    `prefers-reduced-motion` guard: the Play view's own animation-speed setting is where
    motion is turned down, so don't add one back per component.
  - **Reusable mixins**: `container`, `card`, `info-box`, `button`, `form-control`, `tab`,
    `icon-button`, `key-cap`, `disabled-control`,
    `shadow`/`shadow-short`/`shadow-inset`. The control mixins carry every state — hover,
    press, focus, disabled — and the touch floor, so a new control should take one rather
    than paint its own resting look.
- **Casing**: `print()` sets the table-layout voice and defaults to uppercase. Pass
  `$caps: false` for anything that is a sentence rather than a label — capitals are how a
  felt is lettered, not how prose is read.
- **Action colours**: Hit is `$sands`, Stand `$errors`, Double `$infos`, Split `$warnings`,
  Surrender `$neutrals`. `EvTable`, `EvCellDialog` and `Felt` must agree — they were
  crossed over once, and a Stand on the felt reading as a Hit in the grid is a real bug.
- **Dark mode**: Colours are CSS custom properties; toggling `.dark-theme` on `<body>`
  deepens the felt (the same table further from the pit light). Nothing sets it yet.
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

- **Read the model doc first**: [docs/ev-model.md](./docs/ev-model.md) records the method, the simplifications the numbers rest on, and why the engine is shaped the way it is. Reasoning belongs there; the modules under `src/utils/ev/` keep short comments that point at it. [docs/bankroll-model.md](./docs/bankroll-model.md) does the same for `src/utils/bankroll/bankroll.ts`, the bet-sizing and risk layer above it, [docs/count-rounds-model.md](./docs/count-rounds-model.md) for `src/utils/bankroll/countRounds.ts`, the shoe simulation behind the weighted-EV graph card, [docs/play-model.md](./docs/play-model.md) for `src/utils/play/`, the dealt game, its coach and its training stats, [docs/train-model.md](./docs/train-model.md) for `src/utils/train/`, the Train view's drills, how they are priced and graded, and how they are scored, and [docs/sim-model.md](./docs/sim-model.md) for `src/utils/sim/`, the simulated session the Sim view runs through that same stack.
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

### Commit Messages

- **First line is a single concise sentence** stating the action taken, starting with a verb (e.g. "Add a bet spread card to the bankroll view").
- **Any further detail goes in bullets** below that line, each one concise.
