# The sim model

How the Sim view deals a session, plays it, and reports what it paid. The modules are
`src/utils/sim/` — `config.ts`, `indices.ts`, `policy.ts`, `strategy.ts`, `run.ts`,
`result.ts` — plus `src/utils/sim.worker.ts` and `src/utils/simWorkerProtocol.ts`, the
worker the run lives in.

Everything else the app reports is computed. `src/utils/ev/` enumerates a shoe exactly,
[bankroll-model.md](./bankroll-model.md) integrates a bet ramp against a normal
approximation of the count distribution, and [count-rounds-model.md](./count-rounds-model.md)
deals shuffled tag vectors for a round-frequency histogram. None of them plays a hand. The
sim does, and it exists to answer two questions the others cannot: what would a session of
this actually have paid, and how far can a real result sit from the expectation the
Bankroll cards quote.

## One set of rules

The sim does not implement blackjack. It drives the stack the Play view is already dealt
on ([play-model.md](./play-model.md)):

| What it needs                                                         | Where it comes from                            |
| --------------------------------------------------------------------- | ---------------------------------------------- |
| The round, and every table rule in it                                 | `play/game.ts`                                 |
| A shoe dealt card by card, counted as seen                            | `play/shoe.ts`                                 |
| A seeded, resumable random stream                                     | `play/rng.ts`                                  |
| Pricing a decision, and telling a basic error from a missed deviation | `play/coach.ts`                                |
| The error counts and what they cost                                   | `play/stats.ts`                                |
| The priced grids to play off                                          | `ev/playGrids.ts`                              |
| A bet at a count                                                      | `bankroll.ts` — `betAtCount`, `hiLoCountScale` |
| The buckets play is filed into                                        | `countRounds.ts` — `ROUND_TRUE_COUNTS`         |

This is deliberate, and it costs something: a private loop that inlined the rules would
deal several times faster. It is not worth it. A second implementation of the rules is a
second game, and a sim that quietly played a different game from the one the grids price
would be worse than no sim — every figure it produced would look right.

The one thing shared with the coach that had to be lifted rather than copied is `cellFor`,
which decides which of the three grids a live hand belongs to. It is exported from
`coach.ts` and used by `policy.ts`, so the cell a hand is _played_ out of is by
construction the cell it is _graded_ against. `ev/playGrids.ts` was moved out of
`evWorkerProtocol.ts` for the same reason: the EV worker and the sim worker now build
identical grids from one implementation.

## Throughput

`game.ts` returns a new `GameState` on every transition rather than mutating one. That is
the right shape for a pure state machine and the wrong shape for a hot loop, so the cost
was measured before the form was allowed to offer a million hands:
`tests/utils/benchmarks.test.ts` pins it at **microseconds a round** — a hundred thousand
hands in a second or two, a million in tens of seconds. The hand counts in `config.ts`
rest on that figure; if it ever degrades, they are what should change.

## Pricing the counts

`strategy.ts` prices one set of `PlayGrids` per whole true count, on demand, and memoises
it for the worker's lifetime — keyed on the rule-set key, the tags, the precision and the
count. A run visits perhaps twenty counts and then deals against them hundreds of
thousands of times, so pricing is a fixed opening cost of a second or so and dealing is
everything after it. The cache is module-level rather than per-run: a second run under the
same game — a new seed, a different ramp, another deviation mode — deals immediately.

Counts are clamped to **±10**. Past that `applyTrueCountToComposition` is asking for
removals approaching what the shoe holds, the composition is barely representable, and the
play it produces has stopped changing.

A run prices at `'fast'` unless the sidebar's full calculation is the last thing that
priced the figures beside it, in which case it deals off full-precision grids so that both
halves of the comparison are quoted in one frame. Precision is an opening cost and not a
per-round one: pricing twenty counts goes from about a quarter of a second to about a
second and a half, and dealing is unchanged. What it buys is small — see §Against the
bankroll model — so it is offered rather than defaulted to, and any other recalculation
drops the next run back to fast on its own.

## Deviation modes

Three levels, because "does counting pay" and "does index play pay" are different
questions:

- **`basic`** — the best legal action off the _unadjusted_ full-shoe grids, at every
  count. Never takes insurance: it is a bet on the count, and a player not using the count
  has nothing to make it on.
- **`i18`** — the same, with the Illustrious 18 laid over it where a row fires. This is
  what a counter who has learnt a card's worth of indices actually plays.
- **`full`** — the best legal action off the _count-adjusted_ grids outright: the engine's
  own index at every cell. It is the ceiling, and it is exactly what the Play view's coach
  grades against — which is why a `full` run scores 100% optimal play, and why that is a
  useful check that the policy and the coach are reading one cell rather than two.

### The Hi-Lo axis

`indices.ts` holds the eighteen as data: seventeen playing rows plus insurance at Hi-Lo
+3, which is how Wong's list numbers them. **The indices are Hi-Lo-denominated**, as the
bet ramp is (bankroll-model.md §The ramp's count axis) and as `countRounds.ts`'s buckets
are. The run converts the system's own true count through `hiLoCountScale` before asking,
so the same eighteen rows mean the same _shoes_ under Zen or KO. Asking with a raw
level-two count would fire every row about two counts early.

A row is matched on the same basis `cellFor` picks a grid: a pair the player may still
split is a pair, and anything else is its total. That is what keeps 8,8 against a ten out
of the hard-16 row while it is still splittable. A row whose action the table will not
allow right now is dropped rather than forced — a departure you cannot make is not a
departure.

## The loop

`run.ts`, per round:

1. Read the shoe's true count and convert it to its Hi-Lo equivalent.
2. File the round in its `ROUND_TRUE_COUNTS` bucket — every round _dealt_, played or not.
3. Take or give up the seat, then bet from it: a standing player sits down at
   `wongInCount`, and a seated one gets up below `wongOutCount`. Sat out, the round is
   still dealt, the cards still burn and the count still moves, but nothing is wagered. A
   count the ramp stakes nothing at is sat out the same way.
4. Otherwise size the bet with `betAtCount`, `startRound`, answer insurance, and drive
   `applyAction` through the policy until the round settles — grading every decision with
   `gradeDecision` and folding it with `recordDecision` / `recordRound`.
5. Burn the other spots' cards.

The run is stepped in chunks and is mutable on purpose: copying an accumulator a million
times to keep it pure would be the whole cost of the run.

### The observer seam

`SimInputs.observe` is an optional callback, never set by the app, called once per round
the player was in with a `SimRoundRecord`: the cell the opening decision came out of, the
action taken, what the round was priced at, the bet, what it paid, and the count. It is
what `tests/utils/sim/attribution.ts` decomposes the AV-over-EV gap with, and it exists as
a seam rather than as attribution code in the loop so that `playRound` stays the thing it
is. A run that asks for nothing pays one `undefined` check per round.

Two things about its shape are deliberate. The cell key comes from `cellAddressFor`, the
same function `coach.ts` looks a live hand up with, so a round can never be filed under one
cell and graded against another. And `evPercent` is the round's whole priced expectation —
insurance and unplayed naturals included — rather than `Grading.chosenEvPercent` alone, so
that summing `net − ev` over the records gives back the run's own gap exactly and the
resulting table is a decomposition rather than a set of loose readings.

**Bucket only on what was known before the cards fell** — cell, action, count, bet.
Conditioning on the outcome is worthless at a no-peek table: splitting rounds by "did the
dealer have a natural" produces buckets of +3.24 and −3.09 points whose only meaningful
content is their sum, because a no-peek cell is priced unconditionally.

### What a run is measured in

`SimConfig.rounds` counts **rounds dealt at the table, played or not**. It is the session
being sized, not the action in it: a back-counter who plays one shoe in nine has still
stood there for all nine, and what that waiting costs is one of the things a sim exists to
answer. So `roundsWatched`, its share of the run and the hours it came to are reported
beside the money — see §What the result reports.

Two things follow. A chunk is bounded in rounds dealt, which is what keeps it finite
however much of the session is spent waiting. And **no combination of settings is
refused**: an entry count the shoe never reaches, or a ramp that stakes nothing anywhere,
is a finite run that wagers on nothing and says so, rather than a loop with no way out.

### The seat, and why it is stateful

Both wong settings are counts to sit out _below_ — the entry is where the player sits
down, the exit where they get back up — and they are read with hysteresis, carried on
`SimRun.seated` so a chunk boundary cannot move it. That is the only way the two can
differ: a counter who sits down at +2 and leaves under −1 plays the shoe as it cools in
between, which is a real strategy and a measurably different one from leaving the moment
the count drops under the entry. The seat is carried across shuffles too — a fresh shoe
counting zero is not the player standing up.

The foot of either range is a sentinel meaning _never_, not a literal −10: a shoe dealt to
the cut card reaches past ten often enough that reading it literally would sit out a
handful of rounds in a run that asked to play every one of them. With no exit set, the
entry count does both jobs, which is the plain round-by-round reading of wonging in. An
exit set _above_ the entry is measured rather than refused, and simply wins: sitting down
at a count you would stand up at again next round is not a strategy, so `wongCounts` lifts
the entry to meet it instead of seating the player every other round.

### Cut-card jitter

`createShoe` takes an options bag carrying `cutCardVarianceDecks`. When set, `shuffle()`
redraws the cut card each time from the shoe's own stream: the nominal depth plus a
uniform jitter of that many decks, clamped to leave a deck dealable on each side. A real
dealer does not place the cut card to the card, and where it lands decides how many rounds
of a shoe get played — which is a bet-sizing question, not a cosmetic one.

Omitted, the shoe is **byte-identical** to the one the Play view has always been dealt: no
number is drawn at all, so every subsequent shuffle deals what it would have. `restoreShoe`
is untouched, and the drawn `cutCard` already rode in `ShoeSnapshot`, so nothing about
persistence changes.

## What is simplified

Beyond everything the EV engine and the play stack already assume:

1. **Other players are burned cards, not hands.** Each spot burns two cards plus a seeded
   0–2 hits between rounds, off a random stream of its own so a neighbour's decisions can
   never shift which card the shoe deals next. What another player costs a counter is
   penetration and nothing else: they take cards, they change how deep the shoe gets, and
   they make no decision the counter's money depends on.
2. **Rounds are summed as independent.** The variance accumulator adds each round's
   variance as though the next round were a fresh shoe. This is the same assumption
   bankroll-model.md makes per round, and it is wrong in the direction of understating
   correlation within a shoe.
3. **Insurance carries its expectation but not its variance.** The side bet's EV is priced
   off the composition the decision was made on and added to the round; its spread is left
   out, which makes the deviation figure very slightly optimistic on runs that insure.

## Accumulating EV

This is the one place the sim deliberately does _not_ reuse `PlayStats`.

`recordDecision` folds a hand's EV in once **per decision taken in it**. For a lifetime
training record that is a reasonable reading and play-model.md documents it; for a session
figure it is badly wrong — a hand that hits three times counts three times over, and the
resulting "EV" comes out about seven percentage points adrift.

So the run keeps two records:

- `SimRun.stats`, folded by `stats.ts` exactly as the Play view folds it, for **`av`, the
  two error counts, `evLost` and the optimal-play share**.
- `SimRun.ev` and `SimRun.variance`, accumulated **per round**, for everything else.

A round's expectation is read off its **opening decision alone**: a priced action's EV
already covers playing the hand on from there, and a split's covers both of its stakes, so
the opening decision prices the whole main wager. Insurance adds its own term.

A round in which the player never acts — a natural of their own, or a dealer natural the
peek found at the deal — has no decision to price, so it is priced directly: a natural
pays `payout × (1 − P(dealer matches))`, a peeked dealer natural loses the wager flat.
Naturals are about 4.8% of rounds paying 1.5, so leaving them out would put **seven points
of edge** in AV with nothing to answer it in EV. `tests/utils/sim/run.test.ts` is written
against exactly that bug.

At a peeking table the grids are priced conditional on the dealer having already missed
(ev-model.md), and this arrangement handles that correctly without a correction: the
rounds the peek ends are the ones taken out into the natural path, and what is left is
what the conditional cells describe.

## What the result reports

`result.ts` derives everything in one pure function, so no component does arithmetic:

| Figure                                            | What it is                                                                                                                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `stats.av`                                        | Money actually won or lost                                                                                                                   |
| `ev`                                              | Expectation of the rounds as they were opened                                                                                                |
| `evEdgePercent`                                   | `ev / wagered` — what the hands played were _worth_, per unit staked                                                                         |
| `edgePercent`                                     | `av / wagered` — what the cards actually _paid_                                                                                              |
| `averageBet`                                      | `wagered / roundsPlayed`, in currency                                                                                                        |
| `roundsSeen`                                      | Rounds dealt — the run's own budget, and its clock                                                                                           |
| `roundsPlayed`                                    | Of those, the ones wagered on                                                                                                                |
| `roundsWatched`, `watchedPercent`, `hoursWatched` | And the ones sat out: not in the seat, or dealt at a count the ramp stakes nothing at. Where a back-counting strategy's cost actually lives  |
| `hours`                                           | Rounds **dealt** ÷ `roundsPerHour` — a back-counter's watching is time too                                                                   |
| `blackjacks`, `blackjackPercent`                  | Rounds opened on a natural, and their share of the rounds played. A dealer's matching natural still counts one; a split hand's 21 never does |
| `winRatePerHour`, `sdPerHour`                     | `av` and `√variance` over those hours                                                                                                        |
| `n0Rounds`                                        | Read off the _expectation_, not the money: N0 is a property of the game, and a run that ran hot would otherwise report a shorter one         |
| `evDeviationSigmas`                               | `(av − ev) / σ`, through `stats.ts`'s own `evDeviation` over the sim's round-level totals                                                    |
| `buckets`                                         | Per `ROUND_TRUE_COUNTS` bucket: rounds seen, rounds played, hands, wagered, AV and EV                                                        |
| `samples`                                         | ~200 checkpoints of cumulative AV, EV and σ, spaced by rounds **dealt**, so a stretch spent back-counting draws as the flat line it is       |

`wagered` is the **opening** bet summed over the rounds played — what the ramp actually
set — not the money that ended up on the felt once a hand doubled or split. That is what
makes it comparable with `analyzeBankroll`'s `averageBetCurrency`, and it is what a
per-unit-wagered edge is conventionally read against.

Results are not persisted. A run is minutes of dealing and megabytes of buckets, and it is
re-runnable from its seed — which is why the seed is written back into the form on every
run, so the figure on screen is always the one that dealt the result beside it.

## Against the bankroll model

`bankroll.ts` and the sim answer the same question by different means, and the interesting
part is where they part company.

**Where they should agree.** Under a tag vector that carries no information — every round
played and priced at a count of zero — the sim's `evEdgePercent` reproduces the engine's
own whole-shoe average, and `analyzeBankroll`'s flat-bet edge is that same average plus a
curvature term over a count distribution that is not there. They land within about a tenth
of a point of each other, which is sampling error rather than disagreement: one round's EV
has a spread of roughly 0.4 units, so a hundred thousand of them leave a standard error
around 0.1 points. Under Hi-Lo tags and a real ramp the two still track each other, and
the sim's answer is the more trustworthy of the two about the _shape_ of the count
distribution, since it deals a finite shoe where the bankroll model integrates a normal
approximation.

**Where they should not.** `edgePercent` — what the cards actually paid — is one sample of
a walk. Over a hundred thousand hands it is routinely half a point either side of the
expectation, which is the whole reason the trajectory chart draws σ bands rather than a
single number.

**And where the deviation figure is not purely luck.** `evDeviationSigmas` reads how far
the money ran from the hands as priced, so anything the game pays that the grids do not
price shows up in it as a systematic offset rather than as noise. That makes it a test of
the two implementations against each other, and it has already caught one bug: `game.ts`
paid a 21 dealt to a split hand as a natural, at 3:2, which the grids correctly price as
an ordinary 21. It was worth **+0.23 points of edge** on the default game, nearly all of it
on split aces, where it moved a round's average result by a third of a unit.

What is left is small, and it is **not** a second bug. Measured over 4M rounds of the
default six-deck game, flat-bet and playing the engine's own index at every cell, AV runs
about **0.15–0.25 points of edge above EV** — roughly **+0.6σ to +1σ per hundred thousand
rounds**. That residual has since been attributed, and both terms in it are simplifications
the EV model states outright rather than defects in either implementation.

### What the residual is

`tests/utils/sim/attribution.ts` measures it, driven by `attribution.test.ts`, which is
skipped unless `QBCALC_ATTRIBUTION` is set. Two experiments, both run over the same
twenty-seed set so the arms are paired, on a peeking six-deck game, flat bet, heads up, full
indices.

**Is it a settlement disagreement?** A control arm makes the priced composition equal the
dealt one: a null tag vector, so every round is priced off `baseComposition` via the count-0
grids, and a cut card 3% in, so the shoe reshuffles about every round. Over 35M rounds it
leaves a gap of **+0.057 ± 0.017 points** — real, but a fraction of the residual, so most of
the residual is the pricing frame rather than anything `game.ts` pays.

**What the frame is worth.** The decisive measurement compares _predictions_ rather than
outcomes, so it carries no settlement variance and 5,000 rounds settle what tens of millions
of dealt ones would be needed for: price the same opening decision off the grids the sim
used, and off grids built from the shoe's actual remaining composition.

| Arm       | Tags  | Pen. | frame Δ            | own-cards Δ        |
| --------- | ----- | ---- | ------------------ | ------------------ |
| control   | null  | 3%   | −0.020 ± 0.009     | **+0.084 ± 0.005** |
| depletion | null  | 75%  | +0.018 ± 0.060     | **+0.142 ± 0.011** |
| count map | Hi-Lo | 75%  | **+0.107 ± 0.041** | **+0.145 ± 0.011** |

Read down the columns:

- **Depletion is worth nothing.** Dealing from a shoe two-thirds gone while pricing it as a
  full one moves the opening decision by 0.018 ± 0.060 points. Composition EV is near enough
  linear over the range a shoe actually wanders.
- **The count→composition map is worth about +0.09.** All of the frame column's movement
  appears when the tags start carrying information — that is `applyTrueCountToComposition`
  (ev-model.md §Simplifications (3)) collapsing a count into one idealised shoe out of the
  many that produce it, and the shoe in front of the player being reliably worth a little
  more than that one.
- **The player's own cards are worth +0.08 to +0.15**, and this is the larger term. The
  grids leave the player's two cards in the shoe, because a grid is indexed by _total_ and
  cannot know which two cards made it (ev-model.md §Simplifications (1)). Taking them out
  raises the price of the same decision by that much. No precision mode reaches it: `full`
  removes them only in the average hand, which is why repricing an identical run at full
  precision moves the gap by **about 0.004 points** and changes not one action.

The two add to roughly the observed residual, and the own-cards term alone accounts for the
control arm's +0.057 — it is a per-decision figure over the ~92% of rounds that have an
opening decision, so about +0.077 of gap, which is where the control arm sits.

**Per-cell attribution agrees.** Decomposing the control arm's gap over 35M rounds and 331
`(cell, action)` pairs — via `SimInputs.observe`, §The observer seam — turns up no cell
worth more than **0.008 points**, so there is no second split-ace bug hiding in it. What the
table shows instead is a signature: every _double_ cell reads high, `11-2` by +1.7 points,
`10-7` by +1.8, `soft 18-3` by +2.8. Doubling means two low cards have left the shoe, which
enriches it in tens exactly as the own-cards measurement says. A cell seen in 1% of rounds
gets a standard error near 0.19 points on its own mean, so anything thinner than about
13,000 rounds cannot resolve a one-point cell error and the report marks those rows rather
than inviting them to be read.

**Why this is documented and not fixed.** Both terms are the EV model working as specified.
A flat correction constant was considered and rejected: this gap is the only cross-check the
app has between the dealt game and the priced grids, and a constant would have masked the
split-ace bug above entirely.

### What cannot be in the figure at all

Anything the grids and `game.ts` agree on. The
no-hole-card "all bets lost" convention (ev-model.md §Simplifications (5)) is the clearest
case — `standTable` charges a dealer natural as a full loss and `doubleEv` scales it with
the stake, `settleHand` takes the same money, so it cancels here exactly. It is a rule
choice that moves the edge itself rather than the agreement about it, and a small one: the
extra stake it takes beyond the opening wager comes up in about 0.034% of rounds and is
worth **0.034 points of edge** against an original-bets-only table.

The offset is an edge, so its σ reading grows as the square root of the rounds dealt: about
+1σ at a hundred thousand rounds is roughly +3σ at a million and +7σ at five million. A
large sigma figure on a long run is therefore expected rather than surprising, and the
figure worth reading against this section is `edgePercent − evEdgePercent` in points, which
does not grow with the run.

## The worker

A sim is not a calculation. It runs for seconds or minutes, it has something to say while
it runs, and it has to be abandonable — none of which the EV worker's protocol offers: one
in-flight request, no progress, no cancellation. So the sim gets a worker of its own,
split the same way (`simWorkerProtocol.ts` holds the message types and the pure driver,
`sim.worker.ts` is the thin `onmessage` shell, so tests exercise the protocol without a
thread).

- **Request**: the rule set, the tags, the `SimConfig`, the ramp, the unit and the rounds
  per hour. Plus `{ type: 'cancel', requestId }`.
- **Responses**: `progress` (with `phase`, the rounds played and how many counts have been
  priced), `complete`, `cancelled`, `error`.
- The loop runs in chunks of a couple of thousand rounds and yields on a zero-delay
  timeout between them, so the worker drains its own queue and a cancel lands within a
  frame or two. Progress is throttled to about 100 ms, except that a chunk which had to
  price a count reports it immediately — that chunk spent nearly all of itself doing so,
  which is what the `pricing` phase is for.
- One run at a time. A second request supersedes the first, which is the EV worker's
  "latest request wins" rule, except that here the superseded run is actually stopped.

`src/setupTests.ts` routes on the URL a `Worker` was constructed with, so a sim request
runs the sim protocol in-process and an EV request runs the EV protocol on a microtask,
exactly as the browser would route them.

## Storage

`SimConfig` lives under `qbcalc:sim-config`, version 2, saved as typed. Like the bankroll
and play configs it reaches nothing the EV worker computes, so it stays out of
`CalculatorConfig` — filing it there would send every settings change off to recompute
results it cannot alter. Each field is validated against the option list the form offers
it from, so a record written under an older set of options is dropped rather than restored
into a select with nothing to select. The version went to 2 when `wongOutCount` changed
sense — version 1 read it as a count to get up _above_, so a stored +6 would have restored
as the opposite of what it was set to.
