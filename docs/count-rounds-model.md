# The round frequency model

How `src/utils/countRounds.ts` works out what share of a shoe's rounds are played at each
true count, which is the weight the graph card above the grids prices each count's edge by.
The bet-sizing layer is documented separately in [bankroll-model.md](./bankroll-model.md),
and the EV result both sit above in [ev-model.md](./ev-model.md).

## The same question as the bankroll model's, answered differently

Both modules describe how much of the play happens at each count, and they are deliberately
not the same calculation:

|        | `bankroll.ts`                     | `countRounds.ts`                 |
| ------ | --------------------------------- | -------------------------------- |
| Method | closed form, normal at each depth | Monte Carlo over shuffled shoes  |
| Tails  | unbounded                         | bounded by the shoe's tags       |
| Reads  | a continuous density              | whole-count buckets, rounded     |
| Feeds  | edge, win rate, risk of ruin      | the graph card, and nothing else |

The bankroll figures integrate a bet ramp against the distribution, and a smooth closed
form is both faster and easier to integrate. The graph is read by eye, bucket by bucket,
and what it most needs to get right is where the play actually is — including the fact
that a shoe holds only so many tagged cards. A single deck under Ace-Five holds four fives
and four aces, so its running count can never leave ±4; shuffling a real composition keeps
that bound automatically, where the normal approximation would hand it a tail it cannot
reach.

## The method

For each of 20,000 trials:

1. Shuffle the shoe — Fisher-Yates over one card per entry in `baseComposition`, each
   holding that card's tag **centred on the tag vector's frequency-weighted mean**. The
   centring is what lets an unbalanced system be dealt like a balanced one: the count is
   then mean-zero around the system's own pivot, exactly as `tagSpread` reads it for the
   EV engine.
2. Deal to the cut card at `penetrationPercent`, `CARDS_PER_ROUND` — five, about a
   heads-up round — at a time.
3. Before each round, read the true count as `runningCount / decksRemaining`, convert it
   to its **Hi-Lo equivalent** through `hiLoCountScale`, and file the round under the
   nearest whole count, adding the count and its square into that bucket. Reading _before_
   the round is dealt is what makes the bucket the count the round is bet at.

Rounding rather than truncating is a choice about the drawing. Truncating towards zero is
the closer description of what a player does — at +2.9 you are betting the +2 step of the
ramp — but it gives the zero bucket everything from −1 to +1, twice the width of every
other bucket, and a point drawn from twice the play reads as twice the weight. Rounding
makes every bucket one count wide, so the readings compare. It roughly halves the zero
bucket: for six decks of Hi-Lo at 75%, truncating puts 45.5% of rounds at zero where
rounding puts 27%.

### The buckets are Hi-Lo-equivalent

The axis is the ramp's, not the system's own — a round dealt at a Zen +4 files under +2,
the Hi-Lo count of the same shoe — for the same reason `trueCountFrequencies` does it
(bankroll-model.md §The ramp's count axis): a bucket has to read exactly one step of the
bet ramp off its own count. Filed under the system's own counts, a system whose counts run
on a different axis lands its buckets between the ramp's steps once they are converted,
so several buckets collapse onto one step and other steps drive no bucket at all — under
Ace-Five, whose counts run at under half Hi-Lo's, the +1, +3 and +5 steps moved nothing on
the graph and the +2 step was applied at +1.

Sharing the axis leaves the distribution nearly the same for every system: a count's size
is a property of its tags rather than of the shoe, and normalising it away is the point.
Six decks at 75% put 25%, 37% and 42% of rounds at +1 or better under Ace-Five, Hi-Lo and
Zen when each was read in its own counts, against 36–37% for all three now. What survives
is granularity — a coarse count like Ace-Five, which tags eight cards of a deck, sits at
zero through stretches of the deal that move a full count off it — and that is a real
difference between the systems rather than a unit conversion.

What the systems then differ by is the edge at a count, not the frequency of it, which is
where the difference belongs: the graph prices each bucket through the edge curve, and the
curve is in the system's own counts, so `CountEvGraph` converts the bucket's moments back
through the same scale before reading it. That is the meeting point `analyzeBankroll`
makes for the summary cards, made in the same place for the same reason.

Every round of every shoe goes into the same histogram, so a bucket is the share of a
session's play at that count, not a statement about any one shoe. A count a shoe visits
for one round in sixty is one sixtieth of a shoe's play, and the graph says so.

The seed is fixed, so the same settings always draw the same graph rather than twitching
by a fraction of a percent on every unrelated recalculation.

The two count moments are carried beside the frequency for the same reason
`trueCountFrequencies` carries them (bankroll-model.md §How often a count comes up): the
edge curve is a quadratic, and the two open end buckets hold counts running far past their
label. Pricing the `≥+6` bucket at +6 would understate exactly the rounds a counter cares
most about.

## What the graph shows

**Shoe EV by TC**: one point per whole count from −6 to +6, plotting

```
frequency(TC) · bet(TC) · edge(TC) · unit / 100 · roundsPerShoe
```

in money, over Hi-Lo-equivalent counts (§The buckets are Hi-Lo-equivalent). The frequency
is the simulation above; the edge is the fitted curve (bankroll-model.md §The edge curve),
taken at each bucket's own mean and mean-square count rather than at its label, and
converted back into the system's own counts on the way; and the bet is the ramp as it is
currently set, read off through `betAtCount` — one bucket per step of it. Those three give percent of a unit per round, which the last two factors turn
into pounds a shoe: the unit is what a betting unit is worth, and `roundsPerShoe` is the
rounds the simulation dealt before the cut card.

Per shoe rather than per round because a shoe is the unit a counter actually plays and sits
through, and the figures — a pound or two at a bucket, several pounds across the line —
are ones to weigh against a session. It does mean the scale moves with penetration and deck
count for two reasons at once: a deeper cut both deals more rounds and reaches better
counts. The shape of the line is unaffected by the money, which only rescales the axis.

All three factors, rather than any one of them, is what says where the money in a shoe
actually is. The edge alone climbs forever and suggests the play is all at the top; the
frequency alone is a hill on zero and says nothing about what the play is worth; the ramp
alone says what you meant to do rather than what it earns. Multiplied, the line dips into
the losing counts near zero — where nearly all the rounds are, at the bottom of the ramp —
crosses a little past +1, and rises into the bump where the big bets sit. **Summing the
line gives what the spread makes on an average shoe**, which is what the reading under the
plot gives at rest.

Two consequences of including the ramp, both intended:

- **Editing the spread redraws the line immediately**, with no recalculation — the ramp
  reaches neither the worker nor the simulation, and the shoe is only dealt once per
  settings change (§Where it runs). The unit behaves the same way, rescaling the drawing
  without touching what is under it. Flattening the ramp sinks the whole line under zero;
  steepening it lifts the right-hand bump, which is the argument for a spread drawn rather
  than asserted.
- **A count the ramp sits out contributes nothing**, and the reading says so rather than
  printing a row of zeroes. A back-counter's ramp — nothing below +1 — draws a line that is
  flat on the floor across the negative half of the shoe.

The total is deliberately _not_ divided by the average bet, which would take it back to the
same per-unit-wagered figure the Player Edge card above reports. The two would not quite
agree: the card integrates a normal distribution where this simulates real shoes (§The same
question as the bankroll model's, answered differently), which is worth a few hundredths of
a point — six-deck Hi-Lo at 75% under a 1–12 spread comes out at 0.61% here against the
card's 0.63%. Two figures for one quantity that differ in the second decimal read as a bug
rather than as two methods, so the graph quotes money per shoe instead, which is a figure
no card duplicates.

Positive contributions are filled in the brand colour and negative ones in a muted one,
cut on the zero axis so the two halves meet exactly where the line crosses — which is a
point between buckets, not one the simulation holds. The reading follows the pointer for a
per-bucket figure: how many hands of an average shoe are played at that count, and what the
count is worth — with the money the two make between them labelled on the point itself. The
share is given as hands rather than as a percentage so that it is in the same terms as the
total beside it, which is the money made over a shoe of so many hands.

## Assumptions worth naming

- **The count is read between rounds, at five cards a round.** A real table deals a
  varying number of cards per round, and more players mean fewer rounds per shoe from the
  same cards — which shifts `roundsPerShoe` more than it shifts the shape the graph draws.
- **Every shoe is played to the cut.** A back-counter who sits out the cold shoes plays a
  much better distribution than this one; the graph is what the table deals, not what a
  particular player takes.
- **The true count is `runningCount / decksRemaining`, unfloored.** Near a deep cut the
  divisor is a fraction of a deck, so a small running count reads as a large true count:
  a single deck dealt to 75% has a quarter of a deck behind the cut, where a running count
  of +2 is a true count of +8. Those counts are real, and a counter would bet them, but
  they are extrapolations from very few cards — and the EV engine prices them by removing
  `TC · decks` tags from a _full_ shoe (ev-model.md §Simplifications (3)), which at that
  point is a shoe the deal never had. Read the outer buckets of a deeply dealt single- or
  double-deck game with that in mind.
- **Rounds are not simulated, only cards.** Nothing here knows about hands, hits or
  splits; the deal is a stream of cards and a round is five of them.

## Where it runs

On the main thread, in a `createMemo` in `App.tsx`, off the same basis the summary cards
read — not in the EV worker. It takes tens of milliseconds for an eight-deck shoe, and the
simulation itself needs no EV result at all: the counting system, the shoe size and the
penetration settle the distribution entirely. Only the pricing on top of it reads the
basis' edge curve, which is cached on the rules and the tags and so is already computed by
the time the card draws.

Hanging the whole thing off the settled basis rather than the live config is what keeps it
from rerunning on every keystroke in the settings form, and keeps the card in step with the
figures beside it. It also means the card does not move when the count on screen does,
which is right: it describes every count the shoe reaches, not the one the grids are
currently priced at.

The simulation and the pricing sit in two memos, not one. The shoe is dealt in the inner
one, off the basis alone; the outer one prices its buckets through the edge curve and the
bet ramp. So editing the spread — which reaches no calculation anywhere in the app — redraws
the line for the cost of thirteen multiplications, without shuffling twenty thousand shoes
again.
