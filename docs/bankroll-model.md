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

1. **The edge at each true count**, not just at the one on screen (§The edge line).
2. **How often each true count comes up** (§How often a count comes up).
3. **The variance of one round**, since risk is a ratio of edge to spread
   (§Variance per round).

## The edge line

The edge is modelled as a straight line in the true count:

```
edge(TC) = baseEvPercent + slope · TC
```

No conversion is needed: the app works in true counts throughout, and
`applyTrueCountToComposition` sizes a count's removals as `TC · decks` (see ev-model.md
§Simplifications (3)), so a set of grids is already priced at the true count it was asked
for. One count-adjusted shoe beside the baseline therefore fixes the line.

`edgeSlope` in `evWorkerProtocol.ts` measures it from the count the user asked for
whenever that count is at least 1. Below that, the half-card rounding in
`applyTrueCountToComposition` is most of what separates the two shoes — a fraction of a
true count moves an eight-deck shoe by half a card or not at all — and dividing that by a
true count near zero magnifies the rounding into a slope that is mostly noise. Those cases compute one extra shoe at a true count of +2 instead. So a calculation
walks the grids once (neutral or small counts, plus the probe), twice (the ordinary case,
where the count itself sets the line), or three times (a small but shoe-moving count). The
full-shoe baseline is cached per rule set and is usually free.

A line is a real simplification: the true edge curve bends away at extreme counts, where
the shoe runs out of the cards the count is claiming are gone. Since those counts are also
the rarest, the error they contribute is small — but a figure quoted at a true count of
+10 should be read as an extrapolation.

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

### Buckets are priced at their mean, not their label

The ramp has seven buckets, and the two on the ends are open: the first holds every count
at or below zero, the last everything at or above +6. Each bucket is therefore priced at
the average true count actually seen inside it, computed as a partial expectation, not at
the label it carries.

This matters more than it sounds. Pricing the bottom bucket at 0 would charge the whole
negative half of the shoe the count-zero edge, quietly forgiving the losses that the deck
being bad is supposed to cause — and a flat bet would then appear to make money. Because
the edge is linear in the count and the count is mean-zero, pricing at the conditional
mean makes the sum exact: a flat bet earns precisely `baseEvPercent`, which is what
`tests/utils/bankroll.test.ts` pins down.

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

Over the buckets, with frequency `fᵢ`, mean true count `tcᵢ`, bet `bᵢ` units and
`eᵢ = edge(tcᵢ)`:

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
collapse to the frequencies alone and the edge comes back to exactly `baseEvPercent` — the
house edge, as it should. And the card does not move when the count on screen is changed: the
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
