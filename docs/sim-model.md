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

Runs always price at `'fast'`. A sim deals against a handful of grids a million times, so
the seconds-long full-precision walk would cost the whole run's budget for a decimal place
nothing here reports. See §Against the bankroll model for what that precision costs in
accuracy.

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
3. Below `wongInCount` or above `wongOutCount`, sit out: the round is still dealt, the
   cards still burn and the count still moves, but nothing is wagered. A count the ramp
   stakes nothing at is sat out the same way.
4. Otherwise size the bet with `betAtCount`, `startRound`, answer insurance, and drive
   `applyAction` through the policy until the round settles — grading every decision with
   `gradeDecision` and folding it with `recordDecision` / `recordRound`.
5. Burn the other spots' cards.

The run is stepped in chunks and is mutable on purpose: copying an accumulator a million
times to keep it pure would be the whole cost of the run.

### What a run is measured in

`SimConfig.rounds` counts **rounds dealt at the table, played or not**. It is the session
being sized, not the action in it: a back-counter who plays one shoe in nine has still
stood there for all nine, and what that waiting costs is one of the things a sim exists to
answer. So `roundsWatched`, its share of the run and the hours it came to are reported
beside the money — see §What the result reports.

Two things follow. A chunk is bounded in rounds dealt, which is what keeps it finite
however much of the session is spent waiting. And **no combination of settings is
refused**: a wong window with no count inside it, or a ramp that stakes nothing anywhere,
is a finite run that wagers on nothing and says so, rather than a loop with no way out.
`wongOutCount` below `wongInCount` is a perfectly measurable thing to ask about.

The two ends of the wong range are sentinels meaning _never_, not literal ±10 counts: a
shoe dealt to the cut card reaches past ten often enough that reading them literally would
sit out a handful of rounds in a run that asked to play every one of them.

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

| Figure                                            | What it is                                                                                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `stats.av`                                        | Money actually won or lost                                                                                                              |
| `ev`                                              | Expectation of the rounds as they were opened                                                                                           |
| `evEdgePercent`                                   | `ev / wagered` — what the hands played were _worth_, per unit staked                                                                    |
| `edgePercent`                                     | `av / wagered` — what the cards actually _paid_                                                                                         |
| `averageBet`                                      | `wagered / roundsPlayed`, in currency                                                                                                   |
| `roundsSeen`                                      | Rounds dealt — the run's own budget, and its clock                                                                                      |
| `roundsPlayed`                                    | Of those, the ones wagered on                                                                                                           |
| `roundsWatched`, `watchedPercent`, `hoursWatched` | And the ones sat out: wonged past, or dealt at a count the ramp stakes nothing at. Where a back-counting strategy's cost actually lives |
| `hours`                                           | Rounds **dealt** ÷ `roundsPerHour` — a back-counter's watching is time too                                                              |
| `winRatePerHour`, `sdPerHour`                     | `av` and `√variance` over those hours                                                                                                   |
| `n0Rounds`                                        | Read off the _expectation_, not the money: N0 is a property of the game, and a run that ran hot would otherwise report a shorter one    |
| `evDeviationSigmas`                               | `(av − ev) / σ`, through `stats.ts`'s own `evDeviation` over the sim's round-level totals                                               |
| `buckets`                                         | Per `ROUND_TRUE_COUNTS` bucket: rounds seen, rounds played, hands, wagered, AV and EV                                                   |
| `samples`                                         | ~200 checkpoints of cumulative AV, EV and σ, spaced by rounds **dealt**, so a stretch spent back-counting draws as the flat line it is  |

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
the money ran from the hands as priced, and the pricing is the engine's, at fast
precision. Two of the engine's own approximations show up here as a systematic offset
rather than as noise: fast precision's draw cap under-prices hitting (ev-model.md
§Precision modes, worth about 0.06–0.08 points), and the split model under-prices splitting
by rather more. Measured over the default six-deck game, AV runs about **0.3 points of edge
above EV** for reasons that have nothing to do with luck — roughly **+1σ per hundred
thousand hands**. A reading of +1σ is therefore unremarkable; it is the departures from
that, and the sign and size of a run at ±3σ, that carry information. This is the sim
telling the truth about the engine, and it is recorded here rather than corrected away.

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

`SimConfig` lives under `qbcalc:sim-config`, version 1, saved as typed. Like the bankroll
and play configs it reaches nothing the EV worker computes, so it stays out of
`CalculatorConfig` — filing it there would send every settings change off to recompute
results it cannot alter. Each field is validated against the option list the form offers
it from, so a record written under an older set of options is dropped rather than restored
into a select with nothing to select.
