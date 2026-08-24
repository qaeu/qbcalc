# The play model

How the Play view deals a game, grades what the player does with it, and keeps score. The
modules are `src/utils/play/` — `rng.ts`, `shoe.ts`, `game.ts`, `coach.ts`, `stats.ts` — plus
the `'play'` scope in `src/utils/evWorkerProtocol.ts` that prices what the coach grades
against. The EV engine those prices come from is documented in [ev-model.md](./ev-model.md);
the bet-sizing layer in [bankroll-model.md](./bankroll-model.md) and the shoe simulation behind
the graph card in [count-rounds-model.md](./count-rounds-model.md) are separate questions.

The point of the view is deliberate practice. A wrong action is allowed and flagged rather
than blocked, so the session stays a real game: the money is genuinely lost, and the record
below says how much of that was the cards and how much was the player.

## The dealt shoe

The EV engine works in _compositions_ — how many of each rank a shoe holds — because it
enumerates every card the shoe could turn. A played shoe turns one card, so `shoe.ts` is an
ordered array of ranks with a cursor:

- Built from `baseComposition(ruleSet)`, which counts in half-card units, so each rank
  contributes `halfCards / 2` real cards.
- Fisher-Yates shuffled from a single `mulberry32` stream (`rng.ts`, lifted out of
  `countRounds.ts` so both the simulated and the dealt shoe run off the same generator). One
  stream serves the shoe's whole life, so a session replays exactly from its seed however many
  times it reshuffles — AGENTS.md's "if simulation is ever used, seed it".
- The cut card sits at `penetrationPercent` of the shoe. `needsShuffle()` goes true once it is
  passed; the round in progress finishes first, as at a table.
- The running count (`DealtShoe`, built by `createShoe`) is kept over the cards **the player
  has seen**, with the tags as the
  system prints them. The dealer's hole card is drawn through `drawHidden` and folded into the
  count by `revealHidden` when it turns. This is not how `countRounds.ts` counts a shoe: that
  module centres each tag on the tag vector's own mean, because it is measuring a whole shoe's
  count distribution, where a player at the table simply adds up what is on the felt.
- `trueCount()` is `runningCount / decksRemaining` in the **system's own** counts, not
  converted to a Hi-Lo equivalent. It is what the player is keeping, and the shoe the grading
  composition is built at. `decksRemaining()` is fractional; the HUD is what rounds it up.

## The round

`game.ts` is a pure state machine over a `GameState` whose `phase` runs
`bet → insurance? → act → dealer → settled`: `createGame` once per shoe, then `startRound`,
`resolveInsurance` where the table offers it, `legalActions` / `applyAction` per decision, and
`settleRound` to turn the hole card over and pay. Every entry point returns a new state object;
the shoe is the one thing shared by reference, since un-dealing a card is not a transition
anyone can make.

Nothing but `settleRound` settles, which is what gives the felt a `dealer` phase to animate the
reveal in. A round with no decision in it — a player natural, or a dealer natural the peek has
just found — therefore comes back from `startRound` already in `dealer` rather than paid.

Cards come out in a table's order — player, upcard, player, hole card — and every rule in
`RuleSet` reaches the machine: H17/S17, `dealerPeek`, `splitLimit`, `doubleAfterSplit`,
`resplitAces`, `hitSplitAces`, `surrender`, `blackjackPayout` and `insurance`. Three points are
worth recording:

1. **The peek can wait for the player.** Early surrender is taken _before_ the dealer looks at
   the hole card — that is what makes it worth taking against a ten or an ace (ev-model.md
   §Surrender frames). So at an `early` or `es10` table the check is deferred to the player's
   first action: surrender settles for half the wager and beats a natural, while any other
   action sends the dealer to the hole card first, and a natural there ends the round with the
   action never played. No flag records whether the check has happened: a natural always sends
   the round straight to the dealer, so a state still being acted on is one whose check either
   has not happened or found nothing, and asking again is free.
2. **A no-peek dealer natural takes everything**, doubled and split money included — ev-model.md
   §Simplifications (5)'s "all bets lost", not the "original bets only" variant. A player
   natural still pushes against it, and a wager already surrendered is off the table.
3. **A split deals to both halves at once.** A table deals them one at a time; nothing here
   depends on the order, and a resplit works either way. Split aces take one card and freeze
   unless `hitSplitAces`, in which case they play on normally.

`PlayHand.net` and `GameState.net` are _net_ money — `+bet` for a win, `−bet` for a loss, `0`
for a push, `−bet / 2` for a surrender, `bet × payout` for a natural — never the stake coming
back. `PlayHand.bet` is the money on that hand and is already doubled where the hand doubled, so
a loss is `−bet` whatever was riding on it. Insurance stakes half the wager and settles into
`GameState.net` at 2:1 in `settleRound`, alongside the hands.

## Grading a decision

### The grading basis

`coach.ts` (`gradeDecision`, returning a `Grading`) computes no EVs of its own. A `'play'`-scope worker request returns `PlayGrids`:
every cell of the hard, soft and splits grids with each action priced twice — once against the
count-adjusted shoe (`actions`) and once against the unadjusted one (`baseActions`) — which is
exactly what `EvCellData` already carries for the Tables view. Grading is then a filter and two
maxima:

- **`basicAction`** — the best action in `baseActions` that is legal right now.
- **`countAction`** — the best action in `actions` that is legal right now.
- **`evLostPercent`** = `countEv(chosen) − countEv(countAction)` on the count-adjusted prices. It is
  **zero or negative**, never positive, and exactly zero when the best action was taken.
- Attribution: chosen ≠ `basicAction` is a **basic-strategy error**; chosen = `basicAction` but
  ≠ `countAction` is a **deviation error**. A play is at most one of the two.

`gradeDecision` returns `null` where there is nothing to grade against — outside the `act`
phase, or for a hand the grids do not reach — and the caller then counts no decision at all
rather than a free one.

Note what the first of those means at a count that has moved the play: taking the deviation is
chosen ≠ `basicAction`, so it raises `basicError` even though it is the right play. That is the
literal reading of "not what basic strategy plays", and it is why `optimalDecisions` counts
`chosen === countAction` rather than the absence of the two error flags — a correctly taken
deviation is an optimal decision.

Filtering to `legalActions` first is what keeps the coach from recommending a double on three
cards, a surrender the table has already refused, or a split past the limit.

Two simplifications sit under this, both inherited from the engine:

- **The composition is the count's, not the shoe's.** The grids are priced at the true count
  the shoe is actually standing at, **rounded to a whole count**, through
  `applyTrueCountToComposition` — the same model the Tables view and its deviation marks use.
  It is not the literal remaining composition; the same count can arise from many removal
  histories (ev-model.md §Simplifications (3)). Rounding is what lets a count's grids be cached
  and reused, and a whole count is what a player is playing off anyway.
- **A hand is priced by its total.** The grids are indexed by total and upcard, so 9,7 and
  5,4,7 are both graded in the hard-16 cell. The totals are widened for this view —
  `PLAY_HARD_TOTALS` 4–20 and `PLAY_SOFT_TOTALS` 12–21, against the strategy tables' narrower
  ranges — so that no live hand falls outside the grids and goes ungraded.

Play always grades at `'fast'` precision. The worker keeps one `cachedPlayBaseGrids` entry per
rule set and precision, plus an eight-entry LRU of count-adjusted grids keyed by rules,
precision, tags and count: a shoe wanders back and forth over a handful of whole counts and
revisits each of them for round after round, so most of a session's grading is a cache hit.

**Grading runs regardless of the coaching setting.** The Play settings' Coaching level decides
only how much of the verdict reaches the screen. A session played with the feedback banner off
is recorded exactly as one played with it on, which is what makes the lifetime figures
comparable across sessions.

## What the stats measure

`stats.ts` accumulates one lifetime record, in currency units, not segmented by rule set:

| Field                            | What it holds                                             |
| -------------------------------- | --------------------------------------------------------- |
| `av`                             | Money actually won or lost                                |
| `ev`                             | Expectation of the hands **as they were actually played** |
| `hands`, `rounds`                | Hands settled and rounds dealt                            |
| `decisions`, `optimalDecisions`  | Graded decisions, and those taking `countAction`          |
| `basicErrors`, `deviationErrors` | The two error kinds, attributed as above                  |
| `evLost`                         | Currency given away by the errors                         |

`ev` is summed over the action the player _chose_, not the best one available. That is the
whole point of the split: AV/EV then measures luck alone — how the cards ran against what the
hands as played were worth — while the cost of playing them badly sits in `evLost`, where it
can be read directly. Summing `ev` over the optimal action instead would bury the errors in the
denominator and make a bad session look unlucky.

Signs are deliberately opposite either side of the boundary. `Grading.evLostPercent` is zero or
negative, because it is a difference of EVs and the banner reads it as "−2.1% EV".
`PlayStats.evLost` accumulates the **magnitude**, `−bet × evLostPercent / 100`, so it is zero or
positive and a bigger number is plainly worse.

`optimalPlayPercent` is `optimalDecisions / decisions` as a percentage, and `null` — shown as
"—" — before the first graded decision, since a record with nothing in it has no rate to report. `avOverEv` is suppressed — returned as `null`, shown as
"—" — while `|ev|` is under one unit of currency: the ratio divides by a number that starts at
zero and grows slowly, and a few early rounds can otherwise put it anywhere at all.

## The bookkeeping around it

The chip rail places a bet from the player's stack, floored at the Play settings' table
minimum; the stack starts from the bankroll figure the Bankroll view is configured with.
Bets drive the money and nothing else — they are **never graded** against the bet ramp.
Coaching is strictly about playing decisions, so a session bet flat scores exactly as one bet
to a spread.

Only the stats are persisted (`qbcalc:play-stats`, alongside `qbcalc:play-config`). The shoe and
the hand in progress are not: a reload deals a fresh shoe, which is also what a settings change
does, since the rules the shoe was built under would otherwise no longer be the rules being
graded.
