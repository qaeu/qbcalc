# The train model

`src/utils/train/` holds the Train view's drills: short, graded sets of questions dealt
on the Play felt, under the sidebar's rules and counting system. There are three:

- **Basic strategy.** A hand is dealt, and the answer is the best legal play at a count of
  zero.
- **Counting accuracy.** Rounds deal and play themselves, and at each checkpoint the
  player gives the running count.
- **Deviation recall.** A hand and a whole true count are shown, and the answer is the
  count's own play. Sometimes that is still basic strategy.

Each drill runs at one of three modes. Easy and Hard give a verdict after every answer.
Test holds every verdict until the end and allows 5 s per question.

| Mode | Decision questions | Counting checkpoints |
| ---- | ------------------ | -------------------- |
| Easy | 10                 | 5                    |
| Hard | 20                 | 10                   |
| Test | 40                 | 12                   |

The modules:

- `drills.ts` decides what is asked.
- `grade.ts` decides whether an answer was right.
- `scores.ts` keeps the boards.
- `run.ts` holds a finished drill and the words its verdicts are written in.
- `clock.ts` times each answer.

`TrainView` owns every piece of state. `TrainPicker`, `TrainDecision`, `TrainCounting`
and `TrainResults` draw it.

## A question is a real hand

A decision question is stored as its cards: the player's cards in the order dealt, the
upcard, and a hole card. `questionState` deals it through `game.ts` from a shoe restored
from a snapshot of exactly those cards, in table order (player, upcard, player, hole,
then each hit). It declines insurance where it is offered and takes each card past the
second as a hit.

The result is a live `GameState` in its `act` phase. The felt, the action bar,
`legalActions` and the coach all read it exactly as they read a Play hand, so a drill has
no second idea of what a hand is.

The hole card is drawn from the ranks that cannot complete a dealer natural. At a peek
table a natural ends the round before the player acts, so a question dealt one would
have nothing to ask.

The felt, the reveal queue and the action bar are shared with the Play view. They live in
`#c/Felt`, with the queue's arithmetic in `play/reveal.ts`. The queue takes a `dealKey`:
when it changes, the felt is dealt again from nothing. A drill's next question can have
the same shape as the last, and without the key it would appear with no deal at all.

## Pricing a drill

A drill has to have its grids before it can ask anything. `planDrill` names the counts it
needs: count 0 for Basic and Counting, and a run of whole counts for Deviation. The app
asks the EV worker for all of them in one `'train'`-scope request. The response is a
`TrainGrids` map from each whole count to that count's Play grids, each paired with the
same unadjusted grids. Pricing a Hard Deviation drill's fourteen counts takes around
0.1–0.25 s at `'fast'`.

The `'train'` branch bypasses the worker's count LRU. A drill's spread of counts would
otherwise push out the handful of entries the Play view's shoe keeps coming back to.

In the app, a train request is held while a tables or summary response is out. Unlike a
felt request, it then holds the worker itself: a drill cannot start without its grids, so
a felt request must not be allowed to supersede it. The grids are stored with the
settings they were priced under. A settings change hides them, and a change of rules
abandons any drill in progress rather than regrading it under a game nobody is looking
at.

The app keeps the counts a drill is waiting on so it can ask again once a superseding
calculation lands. The view cancels them as soon as it leaves the loading screen, for
whatever reason: otherwise the next free worker would price an abandoned drill, and a
train request sent from the Tables view would leave the count guard there comparing
against 0.

The response is keyed on the same `liveSettings` signal the grids are read back through.
Serialising a fresh settings object instead could order the tags differently from the
one the signal holds, and a key that never matches leaves the drill on "Pricing…" for
good.

## The pools

Every pool is drawn from a seeded stream (`mulberry32`), and the seed is kept with the
result.

**Ties.** Two actions within `TIE_EPSILON_POINTS` (0.02 points) of each other are a tie.
At `'fast'` precision the winner of a tie could be noise, and nobody can be expected to
know it, so such a cell is never asked.

**Trivial cells.** Easy and Hard both leave these out:

- hard 8 or less that hits;
- hard 17 or more that stands, other than a pair of nines;
- soft 20 or more that stands.

A pair of tens standing is trivial; a pair of nines standing against 7, 10 or ace is
one of the most missed cells in basic strategy, so it stays in.

Where the rules make one of them something else, such as 17 surrendering against an ace,
it stays in.

**Basic, Easy.** Every two-card hand against every upcard, weighted by how often the full
shoe deals it.

**Basic, Hard.** The same cells, weighted toward the rare and the borderline. Rarity is
`sqrt(mean / occurrence)`, capped at 4. Borderline is `1 / (1 + gap / 2)`, where the gap
is the margin in points between the two best plays. About 30% of the questions are
three-card hands: a two-card hand that basic strategy hits, plus the card it drew, still
short of 21. By then double and surrender are gone, which is the point — soft 18 on
three cards is a different question from soft 18 on two.

**Deviation.** For each hand, each side of zero is read outward, count by count, until
the priced range ends. Each count gives its best play and whether that play is a tie.
Counts where the play differs from basic are grouped by the index they share: walking
back toward zero, the index is the last count that still makes the same play. A play that
holds for eight counts is therefore one deviation, asked at one of its eight counts, not
eight deviations.

About 30% of the questions are controls. A control sits one count short of an index,
toward zero, where basic strategy still holds and is not itself a tie there. Without
controls every answer would be "not basic".

**Deviation, Easy.** Draws from the central counts. `easyCounts` grows a run of whole
counts outward from zero, toward whichever side holds more rounds, until it covers 90% of
the rounds played inside the priced range. Frequencies come from `wholeCountFrequencies`
in bankroll.ts, the same depth-averaged spread the ramp buckets use, taken over unit
intervals in the system's own units.

The share is of the rounds inside the range rather than of all rounds. A one- or two-deck
count spreads so wide that the range itself holds less than 90%, and Easy would otherwise
be the whole range.

Items are weighted by how often the hand and the count come up together.

**Deviation, Hard and Test.** Everything Easy would ask is dropped: a central positive
count on a common hand, with neither the play nor basic being a split or a surrender. What
is left are extreme and negative counts, rare hands, and split and surrender plays, drawn
evenly per index group.

The priced range is Hi-Lo −5 to +8, converted into the system's own units by
`hiLoCountScale` and clamped where the sim clamps (`MAX_PRICED_COUNT`).

**Drawing.** `drawQuestions` draws without replacement until a pool is exhausted, and
then refills it. It never asks the same cell twice in a row. It also damps a cell by a
factor of 3 each time it has been asked: several deals share a cell (hard 14 is 4,T, 5,9
and 6,8), and a common one would otherwise come round three times in a ten-question
drill.

## Grading

The answer to a decision question is the coach's own `countAction`, read off the grids at
the question's count. `gradeAnswer` goes through `gradeDecision`, so a drill can never
disagree with the Play view about what was right. At count zero, that answer is simply
basic strategy. The EV cost is the coach's `evLostPercent`.

A Test answer that times out is wrong. It chose nothing, so it has no cost.

The clock starts when the last card of the question lands, not when the deal starts:
time spent watching cards arrive belongs to the animation, not the player. A Test's clock
runs out at 5 s, and a timeout counts as exactly 5 s.

## Counting checkpoints

A Counting drill deals one seeded shoe from start to finish. `dealCountingRound` plays
each round to basic strategy through `game.ts`: one seat, insurance declined, and every
decision the best legal play off the unadjusted grids. The round is dealt settled in a
single step and handed to the felt, where the reveal queue lands its cards in table order.
The cards land at the mode's own speed, and the time to count them, then the next round,
wait on the last card landing.

The running count is `shoe.runningCount()`. `settleRound` turns the hole card over, so
every card shown is a card counted.

At the cut card the felt shows "Shuffle", the shoe shuffles as `startRound` always does,
and the count starts again at 0. The question at each checkpoint is asked after the felt
clears.

| Mode | Deal speed | Most time to count a round | Rounds per checkpoint | Tolerance |
| ---- | ---------- | -------------------------- | --------------------- | --------- |
| Easy | 2x         | 10 s                       | 5                     | ±1        |
| Hard | 4x         | 5 s                        | 6–10                  | exact     |
| Test | 4x         | 5 s                        | 6–10                  | exact     |

The deal speed is part of the mode, not the Play view's setting: how fast the cards come
is part of what the drill asks, and at `instant` a player could read a whole round at
once. The time to count starts on the last card, so it is the same at either speed.

The time to count is a ceiling, not a wait. Space or a tap on the felt deals the next
round as soon as the player has this one counted. Without it, a Hard drill of about 80
rounds would spend most of its eight minutes on rounds already counted.

The felt clears before each round lands. A round no bigger than the last would otherwise
read as already shown, and its time to count would start before its first card did.

Checkpoint lengths are drawn up front from the seed. Easy shows the rounds to the next
checkpoint. Hard hides them, so the checkpoint cannot be timed.

**The basis.** A checkpoint is graded against a basis: the count the player last gave,
paired with the running count it was given at. The expected answer is the basis answer,
moved by the change in the running count since then. How the basis is set:

- **A verdict resets it.** Easy and Hard say the true count after each checkpoint. A
  player who has just been told it counts on from there, so the next checkpoint is graded
  against the true running count.
- **A Test carries the player's own answer.** One miscounted card then costs one
  checkpoint rather than every checkpoint after it. It also means the right answer can
  differ from the running count, so the results list shows the expected answer as
  "Right" and adds the running count wherever the two differ.
- **A timeout resets it.** With no answer there is nothing to measure from.
- **A shuffle resets it to zero.** It overrides all of the above.

## Scoring

A run's score is the number of answers right out of the total. Its time is the sum of its
answer times. Ties go to the faster run, and a run that only equals one already on the
board ranks beneath it.

Each board keeps a top five. A board is one drill at one mode, keyed on exactly what that
drill's answers depend on:

- **Basic:** the rules alone (`ruleSetKey`). Basic strategy does not depend on the
  counting system.
- **Counting:** the tag vector alone. The running count does not depend on the rules.
- **Deviation:** both.

An entry is `{correct, total, timeMs, date, seed, rules}`, where `rules` is the game as
the board names it.

The boards are stored under `qbcalc:train-scores`, and the last drill and each drill's
mode under `qbcalc:train-config`. Both are versioned records in storage.ts. A drill in
progress is not stored, and reloading mid-drill is as good as quitting it. A Counting
drill can run to several minutes, so leaving one on purpose asks twice: once an answer
is in, Esc, the Quit button or another tab only arms the leave, and the same again
within four seconds confirms it. The drill keeps running meanwhile. The browser's own
back button is not guarded.

## Choices on the spec's open questions

1. **Basic's board is keyed by the rules alone**, since the basic answer does not depend
   on the system.
2. **Test grades each checkpoint relative to the last answer, and Easy and Hard against
   the true count**, because their verdicts reset the player. Timeouts and shuffles also
   reset to the true count.
3. **The counting drill deals one seat.**
4. **Hand totals stay on the felt.** Reading the total is not the skill being drilled.
5. **Deviation Hard shows the true count** in the gold counter, as every Deviation mode
   does. The drill tests recall of the index, not the conversion to a true count.
6. **There is no insurance question.** Insurance is declined silently wherever it is
   offered.
7. **The decision drills deal at the Play view's animation speed**, and there is no new
   sidebar tab. The counting drill's deal speed and time to count are part of its mode.
