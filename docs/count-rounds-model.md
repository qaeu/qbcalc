# The round frequency model

How `src/utils/countRounds.ts` works out what share of a shoe's rounds are played at each
true count, which is what the frequency graph above the grids draws. The bet-sizing layer
is documented separately in [bankroll-model.md](./bankroll-model.md), and the EV result
both sit above in [ev-model.md](./ev-model.md).

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
3. Before each round, read the true count as `runningCount / decksRemaining` and file the
   round under the nearest whole count. Reading _before_ the round is dealt is what makes
   the bucket the count the round is bet at.

Rounding rather than truncating is a choice about the drawing. Truncating towards zero is
the closer description of what a player does — at +2.9 you are betting the +2 step of the
ramp — but it gives the zero bucket everything from −1 to +1, twice the width of every
other bucket, and a bar drawn twice as wide as its neighbours reads as twice as much play.
Rounding makes every bucket one count wide, so the heights compare. It roughly halves the
zero bar: for six decks of Hi-Lo at 75%, truncating puts 45.5% of rounds at zero where
rounding puts 27%.

Every round of every shoe goes into the same histogram, so the bars are the share of a
session's play at each count, not a statement about any one shoe. A count a shoe visits
for one round in sixty is one sixtieth of a shoe's play, and the graph says so.

The seed is fixed, so the same settings always draw the same graph rather than twitching
by a fraction of a percent on every unrelated recalculation.

## What the graph shows

One bar per whole count from −6 to +6, summing to one. The two outermost buckets are open,
so a round dealt at +9 is drawn at +6 — which is why those bars can stand taller than
their neighbours.

Counts of +1 and better are drawn in the brand colour and the rest of the shoe in a muted
one: same series, different weight, marking the rounds a counter is actually betting into.
The reading under the plot gives the rounds a shoe deals and the share of them played at
+1 or better, and follows the pointer for a per-bucket figure.

## Assumptions worth naming

- **The count is read between rounds, at five cards a round.** A real table deals a
  varying number of cards per round, and more players mean fewer rounds per shoe from the
  same cards — which shifts the rounds-per-shoe figure more than it shifts the shape.
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
read — not in the EV worker. It takes tens of milliseconds for an eight-deck shoe, and it
needs no EV result at all: the counting system, the shoe size and the penetration settle
it entirely. Hanging it off the settled basis rather than the live config is what keeps it
from rerunning on every keystroke in the settings form, and keeps the card in step with
the figures beside it.
