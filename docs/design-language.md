# Design language

Why the stylesheets look the way they do. `src/styles/_palette.scss` and
`_theme.scss` hold the tokens; the component sheets are expected to reach for
them rather than to re-derive a colour, a depth or a duration. AGENTS.md lists
the conventions — this file is the reasoning behind them, so a component
stylesheet can keep its comments to a line.

## The table is the ground

The app is a blackjack table seen from above, so its ground is baize rather than
paper and every scale in `_palette.scss` is a _dark_ scale: step 1 is the
deepest surface, step 12 the lightest ink. That is the inverse of a Radix light
scale, which is why the Radix imports are gone, but the slot names
`_colourset()` maps them onto keep their meaning — `bg` is what a surface is
painted, `fg` what text is set in.

Four materials make up everything:

- **Baize** (`baize` scale, `baize` mixin) — the table. Two repeating gradients
  are the woven nap and a radial is the pit light. The light is fixed to the
  viewport and the cloth is not: a pit light hangs over the table rather than
  over the page, and left scrolling the lit spot stretched to the content's
  height and slid off the top entirely on a long Sim run. The nap is the
  opposite case — a weave that holds still while the page moves over it reads as
  texture on glass rather than as cloth. Pinning the radial compresses the ramp
  into one screen, so its fall-off is widened and stops at `$felt-deep` rather
  than `--baize-1`, roughly halving the lightness spread the EV grid's fills are
  composited over.
- **Rail** (`rail` scale, `rail` mixin) — the padded mahogany bounding the
  table, and the one surface that is not felt, which is what makes the felt read
  as a table rather than as a page colour. Surfaces only; it carries no ink of
  its own.
- **Panel** (`$panel`) — an opaque patch of table a shade deeper than the felt,
  used by the `card` mixin. Opaque rather than black at an alpha so panels never
  stack their own translucency, but the `card` mixin holds it just short of
  opaque: `$panel` is fixed and the felt under it is not, so an opaque panel sits
  a fixed distance below the table at the top of the page and a much smaller one
  at the bottom. Letting a little ground through keeps a panel the same depth of
  table wherever it is. Only panels drawn straight onto the felt get this — the
  select menu, the drawer and the figure bands' tiles have something other than
  felt behind them and stay opaque.
- **Card stock** (`$stock…`, `card-stock` mixin) — warm, bevelled, dropped onto
  the felt rather than drawn on it. Not a scale: a card is a card.

Nothing in the data views floats. A panel is a deeper patch of table bounded by
a printed hairline (`$rule`, `$rule-strong`) — the rules that structure the data
views are ink, not borders in a lighter grey, because there is no lighter grey
here.

### Two grounds, two inks

Cream on baize is the app's voice. `$ink` / `$ink-muted` / `$ink-faint` are the
three steps of it, and the rule between them is: a figure is full ink, the label
naming it is muted, and faint is for text that qualifies something else rather
than saying it — a placeholder, a house rule under the layout print, a footnote
to a figure already on the page. They are named once because fifteen stylesheets
were each deriving their own, nine landing on 0.45 and eleven on 0.5 for the
same job.

`EvCellDialog.scss` is the one place the ground inverts: the cell drill-down is
set on card stock, because the material and the subject agree — a card is what
it is about. It carries the same three-step ink rule read the other way up
(`$stock-ink-muted`, `$stock-ink-faint`, `$stock-rule`), and the app's mint and
ruby are tuned to be read off baize and go muddy on cream, so the sign there is
carried the way a suit is: black for a hand that makes money, red for one that
loses it.

## Depth

`$cut-trace` → `$cut-pressed` is one ramp of black over baize, which is the
app's second material and the one that had no name: a cut is how far into the
table a surface is sunk. Six steps rather than four, because four cannot be
drawn without one spanning 0.28 to 0.46, which is a jump you can see. Sixteen
different alphas were in use before it. `$scrim` sits at the end of the same
ramp although it is not a cut but the darkness _behind_ a lifted object.

Radius says what a thing is made of, in three steps matching the shadows: 2px
for something cut into the felt (a cut edge is nearly sharp), 3px for a panel
laid on it, 6px for a lifted object with a real edge catching real light. Left
as literals — a radius reads fine as a number. Two objects sit outside the
ladder because they are only a few pixels tall and would round into lozenges:
the Sim trajectory's legend swatch, and the Play view's card backs at phone
size.

Shadows are black and heavier than a shadow on white needs to be, because on
baize an object is told from its surface by the light it blocks. `shadow()`
takes a direction, for the two objects that do not lie flat on the table: the
rail overhangs the felt and the settings drawer slides in from the side. Two
kinds of local `box-shadow` stay hand-written on purpose — a cut only a few
pixels deep (a toggle's slot, the discard rack, a field) carries its own
`inset 0 1px 2px`, which is the shape of the cut rather than an elevation and
which `shadow-inset`'s 12px blur would fill solid; and a chip sits at three
heights with a lit bevel on top, which needs more elevations than `shadow()`
describes.

## Print

`print()` is lettering stencilled on the felt — the condensed face, tracked out,
in cream. It defaults to uppercase because that is how a table is lettered; pass
`$caps: false` for anything that is a sentence rather than a label, since the
face and the tracking carry the voice on their own and prose in capitals is just
hard to read. Headings are the same material as "BLACKJACK PAYS 3 TO 2", so they
are set the same way.

Figures are set as printed numbers rather than as big body text: Archivo Narrow,
tracked tight, `tabular-nums` so a figure does not jitter its own width as it is
recalculated.

## Colour carries meaning

Gold is the cut card — the one bright object on a real table — so it is the
accent, and everything that is _the one in play_ is marked in it: focus rings,
the live tab's underline, a checked toggle, the trajectory's money line.

The actions have fixed colours, and `EvTable`, `EvCellDialog` and `PlayTable`
must agree: Hit `$successes`, Stand `$errors`, Double `$infos`, Split
`$warnings`, Surrender `$sands`. They were crossed over once, and a Stand on the
felt reading as a Hit in the grid is a real bug.

Mint is money the player's way, ruby money the other way. Sky is the one cool
hue on the table, so a Double never reads as a warmer or cooler version of
anything else. Sand is the palette's cream — the warmest scale with almost no
chroma — which suits the one cell on the EV board that is not a way of playing
the hand.

### Fills are mixed into their own scale

A fill is its own colour mixed down into that colour's dark end (`bg-light`),
not laid over the table at an alpha and not mixed into the panel. Both of those
put a green under it, and in oklab a warm tint blended into a green ground
travels through the neutral axis on the way: a Hit came out at hue 141 and a
Split at 122 — both still green, at less chroma than the felt they sat on. That
is the mud. Sunk into their own scale's step 3 instead, they hold their hue all
the way down (sand and gold at 82, ruby at 12, sky at 237) and the strength only
decides how far up the scale the cell has come.

Strength and opacity are separate knobs saying different things: strength picks
the colour, opacity says how firmly the board asserts it. A cell is a wash on
the card, so the colour is mixed opaque and only then let down onto it
(`wash()`), which also keeps it working on a `color-mix` result that has no
channels to rewrite.

One strength serves the four playable actions, with two deliberate exceptions:

- **Surrender** is held light, because it is the one cell that is not a way of
  playing the hand.
- **Split** is drawn from the top of its scale and carried further up, because
  brown is a dark yellow: gold's step 11 mixed to the usual strength lands near
  L48, and at that lightness the hue reads as brown however much chroma it
  carries. It ends the lightest cell on the board, which the accent can afford
  to be.

The heat ramps (EV, occurrence) step tint _and_ opacity together. Ramping tint
alone moved the negative cells over eleven steps of lightness and almost no
chroma at all — 0.09 to 0.12 across the whole scale — so fading the low end into
the card takes chroma from 0.01 to 0.12 and a weak cell reads weak in both of
the ways the eye measures. The tint floor is not zero because at
`step / 8 * 45%` three of eight steps were indistinguishable from an unfilled
cell; the opacity floor is low because a cell one step positive and one step
negative are next to nothing apart in value and the ramp should say so. The EV
ramp diverges around a bare break-even cell; occurrence is sequential and has no
meaningful middle, so its step 0 is simply the bare cell.

Chips in the drill-down mix the _saturated_ step into stock rather than the light
step into panel, and stronger than the board's fills: over cream it is the dark
end of a scale that reads as a tint, and the same percentage disappears.

## The EV board

The board is gapped rather than ruled. A cell is a tile with felt showing
between it and its neighbours, which is what a laid-out table looks like and
what leaves room for a counter to stand on one tile without touching the next.
The rules it replaces were a cream hairline over whatever each cell was painted,
so they read differently under a fill, over a bare cell, and around a clipped
one — three weights of the same line. Two pixels is the whole separation; more
and the board reads as a grid of chips rather than as one layout. Cells stay
square, since the gaps are what divide the board.

Row heights are fixed rather than left to each state's font metrics, because a
cell's contents change under it: the numeric modes drop to 11px and the loading
skeleton is a 14px block, so under `normal` every grid grew 3px a row as
skeletons came in and shrank back as numbers landed.

Pointing at a cell draws a gold hairline inside it. Brightening the fill is also
what a change in the count does, so on its own that reads as a recalculation
rather than as an invitation; the hairline is what says the cell opens
something. The highlight arrives fast and releases slowly — a transition reads
its duration from the state being moved _into_ — which is deliberate and
documented, not a bug to normalise.

A cell whose action the count has moved off basic strategy carries two plays at
once, so two elements carry them: the cell keeps the basic play whatever the
count does, and a counter stands on it holding the play the count has moved to.
That split is worth more than any of the finish — a change in the count only
lands and lifts pieces, so the board itself never repaints under them. It
replaces a ring drawn in the cell's own padding, which said the same two things
but spent the padding on itself and read as a border wherever it met the board's
rules.

The counter is an object, not a wash: its face takes the action's colour at full
strength and two slices of rim sit under it, turned in place and then dropped
down the screen (a box-shadow would turn with the face and stay glued square to
it). It has a lit top edge, the same one the felt's keys and buttons wear, which
is the whole of what says it has a face. It sits at three heights — on the cell,
lifted under the pointer, held above the cell and a shade larger while unplayed,
far enough that a piece is seen travelling rather than fading in place. An
unplayed piece is still mounted at zero opacity, which is the only way a
transition can run in both directions.

Landing is dealt down the board a row at a time: every cell carries its row,
deviated or not, since a board where only the deviated cells knew theirs dealt
those late and the rest instantly. Down rather than across because a hand is
found by its total first and its upcard second. Each piece also carries a seat —
a rotation and a small jog off centre, derived from the hand rather than per
render precisely so it survives a count step untouched — so the pieces read as
something someone put down rather than as a second grid printed on the first.
Every counter state is written as its own rule with real values rather than
swapped in through a custom property, since a change arriving purely through a
`var()` substitution is not something to trigger a transition from.

## Motion

Three durations, so a control's states are told apart by how fast they arrive
rather than by each component picking a number: `$dur-fast` (press, hover-in),
`$dur-base` (hover-out, colour), `$dur-slow` (a recalculated figure settling),
all on one `$ease` — fast out of rest, settling into the new state.

There is no `prefers-reduced-motion` guard anywhere. The Play view's own
animation-speed setting is where motion is turned down, and its `instant` option
skips the reveal queue outright; don't add a per-component guard back.

Loading skeletons start mid-cycle through negative animation delays, so a band
or a board is already twinkling on the first frame rather than fading up
together.

## Controls

`button`, `form-control`, `tab`, `icon-button`, `key-cap` and
`disabled-control` each carry every state — hover, press, focus, disabled — and
the touch floor, so a new control should take one rather than paint its own
resting look. `$control-height` is the height a field, a button and a tab in one
row all land on; `$control-height-touch` is the 44px tap target the mixins apply
under `touch`.

A control is cut into the felt rather than laid on it, with a lit top edge, and
sinks under a press: the movement is how a click is known to have landed before
its result arrives. A field is written into rather than merely pointed at, so its
focus lights the cut edge itself rather than floating the global ring 2px off a
recess — the border is where the field ends, so that is where "this one has the
keyboard" belongs. `.highlight` marks the one to press with a gold hairline and
gold ink but no fill, so `.active`'s gold keeps meaning "this is the selected
one".

Anything the pointer or keyboard lands on is marked in gold, and a rule the
table forbids looks forbidden the same way wherever it is met
(`disabled-control`).

Hotkeys are printed as caps on the face of the button they fire, and hidden on
touch — the handlers stay wired, so a phone with a keyboard still works, it just
gets no hints.

## Layout holds still

Recalculation is constant here, so the layout is expected not to move under it.
The recurring devices:

- **Reserve the box.** Loading skeletons match the line box of the figure they
  stand in; a seat reserves a card's height before its first card lands; a
  result line reserves the height a wrapped multi-hand result can reach; a
  reading is held to one line's height so a card does not resize as the pointer
  moves between readings.
- **Shelve, don't swap.** The Play felt stacks every phase's controls in one
  grid cell and hides the inactive ones with `visibility`, not `display`, so the
  shelf is always as tall as the tallest phase. Buttons that take turns in a slot
  share the wider one's width.
- **Bands are subgrids.** `StatBand` and `EvSummary` make each cell a subgrid of
  the band's rows, so a label that wraps makes room across the whole line and
  the figures stay level. Their dividing hairlines are the cells' own borders
  pulled back by a negative margin, so the ones falling on the band's edges land
  outside the padding box and are clipped — which a plain per-cell border cannot
  arrange, since it cannot know where the row wraps. A balanced last line starts
  a column or two in, where there is no edge to clip against, so those cells
  clear their own rule (see `#utils/gridBalance`).
- **Reserve the scrollbar.** `scrollbar-gutter: stable` on `<html>`, with `body`
  at `width: 100%` rather than `100vw` — with the gutter reserved, the viewport
  unit is wider than the content box.
- **Floors, not squeezes.** A wide table scrolls in its wrapper rather than
  shrinking its columns until every cell ellipsises.

## Ark UI and Zag

The headless components leave a few traps, all of which have bitten here:

- Ark hides an inactive panel, tab panel, menu item mark or toggle mark with the
  `hidden` attribute **alone**, which a bare `display: flex` overrides. Write
  `&:not([hidden])`.
- A dialog positioner covers the whole viewport for good once opened, so it must
  never be the thing a click lands on: it disowns pointer events and the panel
  inside takes them back. Dismissing by tapping outside still works, since that
  is a document-level listener rather than hit-testing.
- Menus portalled out of a form inside the drawer are hosted by the drawer's own
  `__layer`, so the dismissable-layer stack counts a click on one as inside the
  dialog rather than as a reason to close.
- Zag writes `pointer-events: auto` and `--arrow-offset` inline on the open
  layer, so the popovers that must not take the pointer, and the arrow tips that
  must clear their content's border, need `!important` to win.
- Sass leaves a nested `@keyframes` nested in the compiled CSS, where it is not
  a valid at-rule and is silently dropped. Declare them at the top level of the
  layer.

## Things kept in sync by hand

- `compact` mixin ↔ `COMPACT_LAYOUT_QUERY` in `src/utils/media.ts`.
- `$skeleton-phase-count` ↔ `LOADING_PHASE_COUNT` (`src/utils/loadingPhase.ts`,
  and `EvTable.tsx`'s own copy).
- `$counter-seats` ↔ `COUNTER_SEAT_COUNT` in `src/utils/counterSeat.ts`.
- `$counter-row-count` ↔ `HARD_TOTALS` / `PAIR_RANKS` in `src/utils/ev/rules.ts`.
- `$heat-steps` ↔ `HEAT_STEPS` in `src/utils/cellDisplay.ts`.
- The Sim trajectory's popover corner offsets ↔ that plot's `PAD_*` and
  `VIEW_*` constants.
