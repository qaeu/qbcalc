# The EV model

How `src/utils/ev/` computes what it computes, and what its numbers do and do not
include. The source modules keep short comments and point here for the reasoning.

## Method

Composition-dependent, exact, and not sampled. The dealer's final-hand distribution and
the player's hit/stand EV are both computed by recursive enumeration over the shoe
composition, memoised on which cards have been removed.

Card counts are tracked in **half-card units**: one card is two units. This keeps a
0.5-card count adjustment an integer, at the cost of every draw loop having to guard on
`n >= CARD_UNITS` rather than `n > 0` — a leftover half-unit is not a card anyone can be
dealt.

The engine computes each table twice: once for the full shoe, once for a shoe adjusted to
represent a given running count. The tables display the second, with the delta against
the first.

## Simplifications

These are deliberate, and they are what the numbers should be read against.

1. **The player's own cards are not removed from the shoe composition.** Only the
   dealer's upcard is removed before computing dealer and player EV. This isolates the
   primary count effect — ten/five/ace density driving dealer bust and dealer-completion
   probabilities — while skipping the second-order effect of exactly which cards the
   player is holding. For split hands this extends to the sibling hand too: each split
   hand's draws are computed independently against the same shoe composition, not
   conditioned on what the other hand actually drew.

2. **Only the playing-decision channel of the count is captured.** The tables do not
   include the extra 3:2 payout from more player blackjacks at the deal — that only
   matters at the two-card stage, which is outside the scope of a hit/stand/double/split
   table.

3. **A running count is translated into a shoe composition by spreading the implied
   removals across every rank**, in proportion to that rank's shoe frequency and its
   tag's deviation from the frequency-weighted mean tag (see `applyCountToComposition` in
   `ev/composition.ts`). Shoe size is held fixed. This is one reasonable way to collapse a
   count value into a composition — it is not the only shoe that produces a given running
   count, since the same count can arise from many different actual removal histories.

4. **`splitLimit` is a genuine per-round cap** — the hands a split produces share one
   budget and can never exceed it — but because simplification 1 keeps sibling split hands
   from seeing each other's cards, there is no way to know which sibling will actually
   need the remaining slots. The budget is therefore divided as evenly as an integer
   allows at each split rather than allocated on demand, which slightly understates the
   value of resplitting at odd limits.

5. **At a no-peek table a dealer natural takes the player's whole wager**, doubles and
   splits included — "all bets lost", not the "original bets only" variant some no-peek
   tables use.

## Insurance

Insurance is a side bet on the dealer's hole card, not a play of the hand, so it never
enters the recursion: `ev/insurance.ts` reads it straight off the shoe composition. With
the ace upcard removed and nothing else (simplification 1 keeps the player's own cards
in), the chance the hole card is a ten is `comp[T] / (totalCards - 1)`, and a bet paying
2:1 is worth `3p - 1` per unit staked. It breaks even at `p = 1/3` — the reason a count
that lifts ten density is the only thing that ever makes insurance correct.

The EV is reported per unit staked _on the insurance bet_, which is the frame the 2:1
payout and the 1/3 break-even both live in. A full insurance stakes half the main wager,
so its contribution to the round is half that figure — note that this is not the frame
the play EVs beside it are in.

It is a property of the upcard and not of the player's hand, so the UI hangs it off the
ace column: every cell popover under an ace reports the same insurance EV, and no other
column reports one at all.

`RuleSet.insurance` says only whether the table offers the bet; the price is the same
wherever it is offered, so the flag gates the recommendation rather than the maths. It is
offered at no-hole-card tables too, where it is settled against the dealer's second card.

## The average hand

The figure above the grids is what one round is worth on average: every starting hand
the shoe can deal, against every upcard it can show, played optimally and weighted by how
likely it is. It is the one number in the app that answers "what is this game worth",
where a cell answers "what is this spot worth".

The weights come from `dealWeights` in `ev/deal.ts`, over three cards drawn without
replacement. This is the one place the player's own cards _are_ removed as they are dealt
(against simplification 1), because the chance of being dealt a hand is exactly the
question those cards answer; they still stay in the shoe for the EV of playing it.

Two things the grids leave out have to be put back, and `analyzeAverage` in `ev/engine.ts`
does both:

- **The dealer's natural.** A peeking table's cells are all priced conditional on the
  dealer having missed it (§The dealer's natural), so the lost wager is mixed back in at
  that upcard's natural odds. Note this is exactly the inverse of the rebasing
  `surrenderEv` does, so an early surrender comes back out at its true flat −0.5. A
  no-peek table's cells are unconditional and need no such correction.
- **The player's natural.** It is no play at all, so it never enters the grids
  (simplification 2). Here it is worth `blackjackPayout` per unit, except against a dealer
  natural, which pushes it — at a no-hole-card table too, where the "all bets lost"
  convention (simplification 5) governs a _losing_ hand's extra stakes and has nothing to
  say about a hand that ties.

Insurance is left out, as a side bet rather than a play of the hand (§Insurance).

The average inherits the grids' simplifications, and simplification 1 is the one that
shows. Leaving the player's cards in the shoe is most of what the deck count is worth, so
the average separates a single deck from a six-deck shoe by far less than a published
house-edge table does, and reads a shade optimistic in absolute terms (about a tenth of a
percentage point on a standard six-deck game). What it tracks closely is the _differences_
between rule sets — H17, 6:5, surrender, no-hole-card — since those move the play grids it
sums rather than the removal effect it skips.

## Rules that don't reach the maths

Every field of `RuleSet` reaches the EV computation except two, which cannot move a
hit/stand/double/split table:

- **`penetrationPercent`** sets how deep the shoe is dealt, which governs how often a
  given count occurs, not what a hand is worth once it has. It belongs to bet sizing and
  risk of ruin rather than to playing decisions.
- **`insurance`** prices a side bet on the hole card, settled before the hand is played
  and independently of how it is played (§Insurance).

**`blackjackPayout`** is a third that never reaches a grid: it only prices a two-card
natural, and the tables start after that has been settled (simplification 2). Note that 21
made by drawing to a split ace is not a natural, and is already paid as an ordinary 21
here. It does reach the average, but not through the engine — `analyzeAverage` returns the
natural's probability weight and `ev/tables.ts` multiplies the payout in afterwards, which
is what keeps a payout change from invalidating a cached grid.

`ruleSetKey` in `ev/rules.ts` covers exactly the fields the engine reads, so these never
needlessly invalidate a cached grid. Extend it alongside the models if a rule ever starts
reaching the maths.

## The dealer's natural

At a **peeking** table the dealer has already checked a ten or ace upcard for a natural,
so any hand still being played is one where the hole card did not make blackjack. The
distribution is conditioned on that by enumerating the hole card explicitly, skipping the
rank that would have ended the hand, and renormalising over what is left.

**Without the peek** the dealer's natural is still live, and it is tracked as its own
`NATURAL` outcome rather than folded into an ordinary dealer 21: a genuine two-card
blackjack beats even a player hand that lands on a _made_ 21 by drawing (a split ace
pulling a ten, say) — the standard rule that a natural is never merely tied by a hand
built from more than two cards. The stand table charges every `NATURAL` outcome as a loss
unconditionally, which is safe because these tables never depict a player two-card
natural to begin with (simplification 2).

## Surrender frames

`surrenderEv` returns its value in the _same frame_ as the play EVs it is about to be
compared against and displayed beside, so a caller can treat it as one more candidate
action.

- **Late surrender, dealer peeks.** The peek has already happened, so both sides live in
  the same no-dealer-blackjack world and the hand is simply worth half the wager back.
- **Early surrender, dealer peeks.** Here surrender genuinely does dodge the natural —
  which is exactly what makes it worth taking against a ten or an ace — so its true value
  is −0.5 in the _pre-peek_ world. Every other cell at a peeking table is reported
  conditional on no dealer natural, so −0.5 is rebased into that frame as
  `(-0.5 + pBJ) / (1 - pBJ)`. That rebasing is monotonic, so the action chosen is
  identical to comparing both sides pre-peek, and the number displayed no longer sits in
  a different frame from its neighbours.
- **No peek.** The dealer takes no hole card at all, so a surrender is settled and the
  stake is off the table before the dealer draws their second card. A natural that
  arrives later has nothing left to collect, which makes every no-hole-card surrender an
  early one worth a flat −0.5 — and cells at a no-peek table are already unconditional,
  so that is directly comparable to its neighbours. (The "all bets lost" convention still
  applies to doubles and splits, whose stakes _are_ still live when the dealer draws.) A
  no-peek table therefore has no late surrender to offer; the UI does not present the
  combination, and the engine treats it as the early one it necessarily is.
- **ES10.** Surrender against a ten only, taken before any check, so it is priced as the
  early one wherever it is offered and is absent against every other upcard. It exists as
  a rule because early surrender against an ace is worth so much that tables offering it
  did not last. Being available only before the dealer checks, it is offered at
  no-hole-card tables too.

## The split budget

`splitLimit` is a budget belonging to the **round**, not to either hand: it caps how many
hands one starting hand may end up as in total. The two hands the first split creates
share it, and a hand that splits again shares its own allowance between its two children
in turn — as evenly as an integer allows, since sibling independence (simplification 1)
leaves no way to know which of them will actually need the slots. An allowance of one
hand is a hand that may not split.

That independence is also what makes the resplit ladder cheap. A hand with a larger
allowance is worth the same draw-by-draw play EVs as one with none — the only difference
is that a paired-up draw may instead be traded for two hands that divide the allowance.
So the play EVs are computed once and the ladder is climbed over allowances alone, rather
than re-entering the whole draw enumeration (and its stand/hit/double recursions) per
level.

Note that EV and settlement odds are not scaled alike across a split. EV accumulates
across every hand the slot turns into, because that is where the money is; the settlement
odds are averaged over them instead, because the question they answer is what becomes of
one of the hands in front of the player. This is why `ActionAnalysis.outcome` for a split
describes _one_ of the resulting hands while its `evPercent` covers both hands' stakes
together.

## Settlement odds from EV

A hand that is not surrendered ends in exactly one of win/push/lose, and its EV is
`stake * (win - lose)`. Two equations, two unknowns — so the push probability is the only
thing the engine has to carry alongside the EV it already computes, rather than a third
parallel recursion. That is what `outcomeFromEv` in `ev/outcome.ts` inverts, with `stake`
being the units riding on the hand: 2 for a double, 1 otherwise.

## Performance notes

The engine's shape is driven by the cost of the recursion. Each of these is load-bearing.

- **In-place draws.** Draws decrement a rank in the shared `comp` array and restore it on
  the way back out, rather than copying the composition at every node. Nothing may hold a
  reference to `comp` across a recursive call, and **every path out of a draw loop must
  leave it as it found it**.

- **The distribution arena.** A full set of tables memoises on the order of a million
  dealer distributions; allocating each as its own array made garbage collection the
  second-largest cost in the engine after the recursion itself. `DistArena` puts them all
  in one growable `Float64Array`, addressed by integer id at `id * DIST_LEN`. Its
  per-distribution `lo` is the lowest slot with any mass — 17 for any real shoe, since the
  dealer cannot stand lower — so the accumulation loop touches six slots rather than
  nineteen while the exhausted-shoe case that strands the dealer on a stiff total stays
  exact. An arena slot is allocated only _after_ its children are in hand: the arena can
  move its backing store while they are being computed.

- **The packed removal key.** A node is identified by which cards have been removed from
  the root composition, packed into a single exact float: ten ranks at five bits each is
  50 bits, inside the 53 a double carries. A child's key is its parent's plus one place
  value (`KEY_MULT`), so identifying a node costs one addition instead of rebuilding a
  string from the whole composition at every level. Five bits caps a rank at 31 removals;
  a dealer hand and a player hand between them cannot draw that many of one rank — twelve
  aces or eleven twos already bust a single hand — so keys stay collision-free. Keys are
  relative to the root composition, so a different root invalidates every cache.

- **`totCards` threaded, not summed.** Every recursive step removes exactly one card, so
  the remaining half-card count is decremented arithmetically as it is passed down instead
  of re-summed from the composition at every node.

- **The stand table.** Collapsing the dealer's distribution into a lookup table keyed by
  player total is what makes standing free: the loop over dealer outcomes runs once per
  (composition, upcard) instead of once per stand-EV query, and the thousands of queries
  the player recursion makes against that composition become array reads. The table runs
  past 21 so a caller asking about a total no real hand can hold still gets an answer.
  It carries a second half at `PUSH_OFFSET + total` — the chance the dealer ties that
  total — riding in the same array rather than a memo of its own, because both are read
  off one dealer distribution and a second map would be entered once per node of the
  player recursion.

- **`bestPush` shadows `bestEv`** rather than being folded into it. The EV recursion is
  the hot path and runs for every cell, while push probabilities are only ever needed for
  the handful of top-level hands whose action breakdown is displayed. Which branch
  `bestEv` took is read back off its own memo: a hand only stands where standing is at
  least as good, so a best EV strictly above the stand EV is one that hit.

- **Grids share one engine.** Dealer distributions — and, for splits, the hit/stand/double
  sub-EVs — depend only on shoe composition and hand state, not on which table asked, so
  the memos populated by the first grid are reused by the other two. And since a grid
  depends only on the rule set and the composition, never on the count that produced it, a
  caller sweeping the count can hold the unadjusted grids across calls (keyed by
  `ruleSetKey`) and pay for one composition per change instead of two.
