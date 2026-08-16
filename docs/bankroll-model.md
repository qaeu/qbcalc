# The bankroll model

How `src/utils/bankroll.ts` turns an EV result into a win rate and a risk of ruin, and
what those figures do and do not assume. The EV result itself is documented separately in
[ev-model.md](./ev-model.md); this is the layer above it.

Everything here is derived on the main thread from a result the worker already produced.
No bankroll setting reaches the engine, which is why a bet spread can be edited and the
figures re-read without another few seconds of enumeration — and why the bankroll settings
live under their own storage key rather than in `CalculatorConfig`.

## The three inputs

A bankroll figure needs three things the grids do not directly show:

1. **The edge at each true count**, not just at the one on screen (§The edge curve).
2. **How often each true count comes up** (§How often a count comes up).
3. **The variance of one round**, since risk is a ratio of edge to spread
   (§Variance per round).

## The edge curve

The edge is modelled as a quadratic in the true count, in the units the selected counting
system keeps it in (§The ramp's count axis converts):

```
edge(TC) = baseEvPercent + slope · TC + curvature · TC²
```

No conversion is needed to fit it: the app works in true counts throughout, and
`applyTrueCountToComposition` sizes a count's removals as `TC · decks` (see ev-model.md
§Simplifications (3)), so a set of grids is already priced at the true count it was asked
for. Count-adjusted shoes beside the baseline therefore fit the curve directly.

`fitEdgeCurve` in `evWorkerProtocol.ts` walks four of them, at ±4 and ±8 Hi-Lo-equivalent
(converted to the system's own counts, so every system is fitted over the same range of
shoes rather than the same range of its own numbers), and fits by
least squares with the intercept pinned at the full shoe's own EV — that one is exact and
has nothing to fit. Probing symmetrically splits the fit in two, since across a `±P` pair
the odd half of the difference is all slope and the even half all curvature:

```
slope     = Σ P·(edge(+P) − edge(−P))/2  /  Σ P²
curvature = Σ P²·((edge(+P) + edge(−P))/2 − baseEv)  /  Σ P⁴
```

Neither the count on screen nor a single step up from the baseline is used. Half-card
rounding in `applyTrueCountToComposition` puts about a tenth of a point on any one probe
however far out it sits, so a shoe at +1 — a couple of half-cards from the baseline — is
mostly noise, enough to reorder two counting systems that are genuinely within a percent of
each other. Two pairs rather than one because the coefficients want different lever arms:
the inner pair sits where the ramp's own money is, while the curvature is a second
difference and needs the wider pair before the bend clears that same noise.

### Why a straight line was not enough

The curve is **convex** — both tails sit above any line drawn through it. That is not the
shoe running out of cards; it is the grids being played off the count. The engine picks the
best action for each count-implied composition, and a maximum over actions is convex in the
composition, so the further the count sits from zero either way, the more the play
deviations are worth on top of the betting edge. Measured over the presets on six decks,
the curvature comes out at 0.004–0.008 points per squared true count, positive for every
one of them.

Fitting it matters most exactly where the money is. Over the counts the ramp prices
(−3 to +9 Hi-Lo-equivalent), a straight line through ±4 is off by 0.14–0.30 points RMS
depending on the system, and it understates the top bucket — a Hi-Lo +8 is worth 3.94
points against the line's 3.67. The quadratic cuts that error by two to six times.

Two consequences worth naming:

- **A flat bet no longer collects exactly `baseEvPercent`.** It collects
  `baseEvPercent + curvature · E[TC²]` over the whole distribution, a hundredth of a point
  or so. This is correct rather than a leak: a flat better who still plays every hand off
  the count is worth a shade more than the basic-strategy house edge, and that shade is
  what the curvature measures.
- **The curvature is priced against each bucket's mean square, not the square of its
  mean.** `trueCountFrequencies` carries `meanSquaredTrueCount` beside `meanTrueCount` for
  this. The gap between them is the spread of counts inside a bucket, which is widest in
  the two open-ended ends — where a spread has most of its money.

The curve describes the shoe and the tags alone, never the count on screen, and is cached
on exactly those — so sweeping the count pays for the probe shoes once. A calculation walks
the grids once (the count-adjusted shoe), plus four more the first time a rule or a tag
changes. The full-shoe baseline is cached per rule set and is usually free.

A quadratic is still a fit, not the truth. It is anchored inside ±8 and the buckets stay
inside that, but a figure quoted at a true count of +12 is an extrapolation, and one that
now bends as it goes.

## How often a count comes up

This is the one place `penetrationPercent` reaches any maths — ev-model.md §Rules that
don't reach the maths sets it aside for exactly this purpose.

After `n` of a shoe's `N` cards have been seen, the running count is a sum of `n` tags
drawn without replacement, so

```
Var(RC | n) = n · σ_t² · (N − n) / (N − 1)
```

with `σ_t²` the per-card variance of the tag vector. That is `tagSpread / N`, reusing the
same quantity `applyTrueCountToComposition` divides by. `tagSpread` centres the tags on their
frequency-weighted mean, which is what lets an unbalanced system be read as mean-zero
around its own pivot rather than drifting.

Dividing by the `(N − n)/52` decks remaining gives the true count's spread at that depth:

```
SD(TC | n) = 52 · σ_t · √( n / ((N − 1)(N − n)) )
```

which widens as the shoe is dealt out — the reason deeper penetration is worth money.
Depth is then averaged uniformly over the dealt portion, in 128 slices at their midpoints.

Two assumptions are worth naming:

- **Rounds are assumed evenly spread through the dealt portion.** A real table deals a
  varying number of cards per round, and a back-counter does not play them all.
- **The count is treated as normal at each depth.** It is a sum of many bounded terms, so
  this is good in the middle and thins out in the tails, where the shoe's own composition
  imposes limits a normal does not.

### The ramp's count axis

A true count means nothing until the tags it was kept with are named. Doubling every tag
doubles every count without adding a scrap of information, and a level-two system like RPC
or Omega II already runs on an axis roughly twice Hi-Lo's: its +6 is about Hi-Lo's +3.

Everything above is indifferent to that. The removals `applyTrueCountToComposition` makes
for one true count fall as `1/tagSpread`, so the edge slope does too, while the count's own
spread rises as `√tagSpread` — and the product, which is what a bet spread is really worth,
is the tag vector's betting correlation whatever scale it is written on.

`RAMP_TRUE_COUNTS` is the exception: it is a fixed set of integers. A ramp indexed by a
stretched count reaches its top bets more often for no better reason than the tags being
bigger, which flatters wide-axis systems on win rate and penalises them on edge per unit
wagered — and the effect is large enough to reorder the presets outright, in a way that
also moved with penetration.

So the ramp is denominated in **Hi-Lo-equivalent** true counts, and `hiLoCountScale`
converts:

```
scale = √( tagSpread(tags) / tagSpread(Hi-Lo) )
TC_system = scale · TC_Hi-Lo-equivalent
```

`trueCountFrequencies` divides the count's spread by `scale` before bucketing it, which
leaves the bucket distribution identical for every system — a function of the shoe and the
penetration alone — and `analyzeBankroll` multiplies each bucket's mean back up by `scale`
before pricing it with the system's own slope. What then separates two systems is only the
product `slope · scale ∝ slope · √tagSpread`, i.e. how much information the tags carry. A
system's own counts still appear untouched everywhere else: the grids, the count control
and the true count frequency graph are all in the units the player actually keeps.

The bet spread editor is labelled accordingly. Betting 8 units at the `+4` column means
8 units at the advantage a Hi-Lo player has at +4, which an RPC player reaches at about
+8 of their own count.

### Buckets are priced at their moments, not their label

The ramp has seven buckets, and the two on the ends are open: the first holds every count
at or below zero, the last everything at or above +6. Each bucket is therefore priced at
the counts actually seen inside it — the mean for the linear term and the mean square for
the curvature, both computed as partial expectations — not at the label it carries.

This matters more than it sounds. Pricing the bottom bucket at 0 would charge the whole
negative half of the shoe the count-zero edge, quietly forgiving the losses that the deck
being bad is supposed to cause — and a flat bet would then appear to make money. Taking
each term against its own moment makes the sum exact rather than a curve read off at an
average count: on a straight line a flat bet earns precisely `baseEvPercent`, and with the
bend it earns that plus `curvature · E[TC²]`. `tests/utils/bankroll.test.ts` pins down
both.

## Variance per round

`analyzeAverage` accumulates a second moment beside the EV it already sums, over the same
`dealWeights`. A hand riding `s` units returns `±s` or `0`, so `E[X²] = s²·(1 − push)`,
and `outcomeFromEv` already recovers the push probability for every action
(ev-model.md §Settlement odds from EV). `actionSecondMoment` in `ev/outcome.ts` applies
the per-action stakes: 1 for a hit or stand, 2 for a double, a flat 0.25 for a surrender
that never reaches a showdown, and for a split the two symmetric hands summed as
independent.

The result for a standard six-deck game is about 1.22 units², a little under the 1.26–1.32
usually published. Both simplifications point the same way: leaving the player's own cards
in the shoe (ev-model.md §Simplifications (1)) and treating split siblings as independent
each trim spread rather than add it. A double after a split is also counted at the split's
two units rather than its true stake.

Variance is treated as the same at every count. It does move — a ten-rich shoe pays more
naturals and doubles harder — but only by a percent or two across the usable range, which
is well inside the error already carried above.

## Putting it together

Over the buckets, with frequency `fᵢ`, mean and mean-square Hi-Lo-equivalent true counts
`tcᵢ` and `tc²ᵢ`, bet `bᵢ` units and the edge taken a term at a time,

```
eᵢ = baseEv + slope · scale · tcᵢ + curvature · scale² · tc²ᵢ
```

the figures are:

| Figure             | Formula                                     |
| ------------------ | ------------------------------------------- |
| EV per round       | `Σ fᵢ·bᵢ·eᵢ` units                          |
| Player edge        | `EV / Σ fᵢ·bᵢ` per unit wagered             |
| Variance per round | `Σ fᵢ·bᵢ²·(σ² + eᵢ²) − EV²` units²          |
| Win rate           | `EV · roundsPerHour · unit`                 |
| Standard deviation | `√(roundsPerHour · variance) · unit`        |
| N0                 | `variance / EV²` rounds                     |
| Kelly unit         | `bankroll · EV / variance`                  |
| Risk of ruin       | `exp(−2 · (bankroll/unit) · EV / variance)` |

The variance term carries the second moment rather than a bet-weighted average, because
the bet itself varies with the count and that spread is part of the risk.

**Player edge** is the figure the summary card above the grids shows, and it is a
different question from the one the grids answer. A cell — and `average.countEvPercent`
behind it — prices the shoe at the count currently set, which is a snapshot. The edge here
is the whole shoe: each count's edge weighted by how often that count is reached under
`penetrationPercent` and by how many units the ramp puts on it. Dividing the round's EV by
the round's average bet is what makes it a weighted mean rather than a per-round figure, so
it stays in the same units as the cells and can be read beside them.

Two consequences follow from the count being mean-zero. Under a flat bet the weights
collapse to the frequencies alone and the edge comes back to `baseEvPercent` plus the
curvature term — the house edge, as it should, and a hundredth of a point for playing the
hands off the count. And the card does not move when the count on screen is changed: the
count sets which shoe the grids describe, while the edge is averaged over every shoe the
penetration reaches. What moves it is the rules, the counting system, the penetration and
the spread.

**N0** is the number of rounds at which the expected win equals one standard deviation —
the usual "how long before the edge outruns the noise" yardstick.

**Risk of ruin** is the standard exponential approximation, and it assumes a player who
never resizes their unit, plays forever, and stops only on going broke. It follows that
betting full Kelly — a unit of `bankroll · EV / variance` — gives `e⁻²`, about 13.5%,
whatever the game. A losing game is reported as certain ruin however deep the bankroll,
which is correct: the exponential describes a winning game only.

Two consequences that surprise people, and are not bugs:

- **A steeper spread can lower risk of ruin.** The rare high counts add edge faster than
  they add variance, because the common low counts — where both ramps bet one unit —
  dominate the variance. What always raises risk is a bigger unit against the same
  bankroll.
- **The figures scale with the unit, not the bankroll, for the win rate**, and with their
  ratio for the risk. Doubling both leaves the risk of ruin unchanged.
