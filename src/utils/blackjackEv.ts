/**
 * Composition-dependent blackjack EV calculator.
 *
 * Computes exact optimal-action EV for hard totals, soft totals, and
 * splittable pairs against each dealer upcard, for a full shoe and for a
 * shoe adjusted to simulate a given Ace-Five running count, then reports the
 * delta. Ported from the reference Python implementation.
 *
 * METHOD
 * ------
 * Dealer's final-hand distribution and the player's hit/stand EV are both
 * computed by exact recursive enumeration over the shoe composition (not
 * Monte Carlo). Card counts are tracked in "half-card" units (x2) so that a
 * 0.5-card Ace-Five adjustment stays an integer.
 *
 * KEY SIMPLIFICATIONS (documented, not hidden)
 * ----------------------------------------------
 * 1. The player's own cards are NOT removed from the shoe composition. Only
 *    the dealer's upcard is removed before computing dealer/player EV. This
 *    isolates the primary count effect (ten/five/ace density driving dealer
 *    bust and dealer-completion probabilities) while skipping the
 *    second-order effect of exactly which cards the player is holding. For
 *    split hands, this extends to the sibling hand too: each split hand's
 *    draws are computed independently against the same shoe composition,
 *    not conditioned on what the other hand actually drew.
 * 2. These tables only capture the *playing-decision* channel of the count.
 *    They do NOT include the extra 3:2 payout from more player blackjacks
 *    at the deal -- that only matters at the two-card stage, which is
 *    outside the scope of a hit/stand/double/split table.
 * 3. A running count is translated into a shoe composition by spreading the
 *    implied removals across every rank in proportion to that rank's shoe
 *    frequency and its tag's deviation from the frequency-weighted mean tag
 *    (see `applyCountToComposition`). Shoe size is held fixed. This is one
 *    reasonable way to collapse a count value into a composition -- it is
 *    NOT the only possible shoe that produces a given running count, since
 *    the same count can arise from many different actual removal histories.
 * 4. `splitLimit` is a genuine per-round cap -- the hands a split produces
 *    share one budget and can never exceed it -- but because simplification
 *    #1 keeps sibling split hands from seeing each other's cards, there is no
 *    way to know which sibling will actually need the remaining slots. The
 *    budget is therefore divided as evenly as an integer allows at each
 *    split rather than allocated on demand, which slightly understates the
 *    value of resplitting at odd limits.
 * 5. At a no-peek table a dealer natural takes the player's whole wager,
 *    doubles and splits included ("all bets lost", not the
 *    "original bets only" variant some no-peek tables use).
 */

export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'A';

/**
 * Optimal first action: hit, stand, double, surrender, or (pairs only)
 * split.
 */
export type PlayerAction = 'H' | 'S' | 'D' | 'P' | 'R';

/** What a natural pays, written as it appears on the felt. */
export type BlackjackPayout = '3:2' | '6:5' | '1:1';

/**
 * Surrender availability: 'early' before the dealer checks for blackjack,
 * 'late' only after the check, 'none' at tables that don't offer it.
 *
 * 'es10' is the common half-measure: early surrender against a ten, and no
 * surrender at all against anything else. It exists because early surrender
 * against an ace is worth so much that tables offering it did not last. Being
 * available only before the dealer checks, it is always the early kind, so it
 * is offered at no-hole-card tables too.
 */
export type Surrender = 'early' | 'es10' | 'late' | 'none';

/**
 * The table variations the calculator knows about. All of them reach the EV
 * maths except two, which cannot move a hit/stand/double/split table:
 *
 * - `penetrationPercent` sets how deep the shoe is dealt, which governs how
 *   often a given count occurs, not what a hand is worth once it has. It
 *   belongs to bet sizing and risk of ruin rather than to playing decisions.
 * - `blackjackPayout` only prices a two-card natural, and these tables start
 *   after that has been settled (simplification #2). Note that 21 made by
 *   drawing to a split ace is not a natural, and is already paid as an
 *   ordinary 21 here.
 */
export interface RuleSet {
	decks: number;
	dealerHitsSoft17: boolean;
	/** Percentage of the shoe dealt out before the shuffle. */
	penetrationPercent: number;
	blackjackPayout: BlackjackPayout;
	surrender: Surrender;
	/** Total hands one starting hand may be split into (1 = no splitting). */
	splitLimit: number;
	/** Doubling after a split is allowed. */
	doubleAfterSplit: boolean;
	/** Split aces may be split again. */
	resplitAces: boolean;
	/**
	 * Split aces may be drawn to normally instead of taking exactly one card.
	 * Rare, but standard in UK casinos.
	 */
	hitSplitAces: boolean;
	/** Dealer checks for blackjack against a ten or ace upcard. */
	dealerPeek: boolean;
}

/** Shoe composition in half-card units, indexed by RANK_INDEX. */
export type Composition = readonly number[];

/** A counting system's point value ("tag") for each rank. */
export type TagValues = Record<Rank, number>;

/**
 * How a hand settles, as percentages that sum to 100. These are *hand*
 * probabilities, not stake-weighted: a doubled winner counts once here, and
 * shows up as twice the money in the EV beside it.
 */
export interface ActionOutcome {
	winPercent: number;
	pushPercent: number;
	losePercent: number;
}

/** One action a hand may take, priced on its own rather than against the others. */
export interface ActionAnalysis {
	action: PlayerAction;
	/** EV of taking this action and then playing on optimally, in percent of one unit wagered. */
	evPercent: number;
	/**
	 * `null` for surrender, which settles for a flat half-loss without a
	 * showdown, so none of win/push/lose describes it.
	 *
	 * For a split these are the odds for *one* of the resulting hands (the two
	 * are symmetric), while `evPercent` covers both hands' stakes together --
	 * splitting turns one wager into two, so there is no single hand whose
	 * money the EV describes.
	 */
	outcome: ActionOutcome | null;
}

/** Fields an EV table cell (and its popover) needs, shared by every table's row shape. */
export interface EvCellData {
	baseEvPercent: number;
	countEvPercent: number;
	deltaPercentPoints: number;
	optimalAction: PlayerAction;
	/**
	 * The optimal action for the unadjusted shoe. Where it differs from
	 * `optimalAction` the count has moved the play off basic strategy, which
	 * is what the table marks as a deviation.
	 */
	baseAction: PlayerAction;
	playerBustOnHitPercent: number;
	dealerBustPercent: number;
	/**
	 * Every action the table offers this hand, priced individually, in the
	 * engine's own preference order (the first of two equal EVs is the one
	 * `optimalAction` names). The drill-down dialog sorts them for display.
	 */
	actions: readonly ActionAnalysis[];
}

export interface EvComparisonRow extends EvCellData {
	total: number;
	upcard: Rank;
}

export interface EvComparisonResult {
	totals: readonly number[];
	upcards: readonly Rank[];
	rows: readonly EvComparisonRow[];
}

export interface SplitEvComparisonRow extends EvCellData {
	pairRank: Rank;
	upcard: Rank;
}

export interface SplitEvComparisonResult {
	pairRanks: readonly Rank[];
	upcards: readonly Rank[];
	rows: readonly SplitEvComparisonRow[];
}

export const RANKS: readonly Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'A'];
export const HARD_TOTALS: readonly number[] = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
/**
 * Soft totals A,2 (13) through A,9 (20), i.e. an ace plus one non-ace card.
 * A,T (21) is omitted: it's a made blackjack-value hand where hitting is
 * never a real decision, so there's no optimal-play comparison to show.
 */
export const SOFT_TOTALS: readonly number[] = [13, 14, 15, 16, 17, 18, 19, 20];
/** Splittable pairs 2,2 through T,T and A,A -- one entry per rank. */
export const PAIR_RANKS: readonly Rank[] = RANKS;
export const BLACKJACK_PAYOUTS: readonly BlackjackPayout[] = ['3:2', '6:5', '1:1'];
export const SURRENDERS: readonly Surrender[] = ['early', 'es10', 'late', 'none'];
export const DEFAULT_RULE_SET: RuleSet = {
	decks: 6,
	dealerHitsSoft17: false,
	penetrationPercent: 75,
	blackjackPayout: '3:2',
	surrender: 'none',
	splitLimit: 4,
	doubleAfterSplit: true,
	resplitAces: false,
	hitSplitAces: true,
	dealerPeek: false,
};

/** The Ace-Five count: +1 per five seen, -1 per ace seen, every other rank neutral. */
export const ACE_FIVE_TAGS: TagValues = {
	'2': 0,
	'3': 0,
	'4': 0,
	'5': 1,
	'6': 0,
	'7': 0,
	'8': 0,
	'9': 0,
	T: 0,
	A: -1,
};

export interface CalculatorParams extends RuleSet {
	count: number;
	tags: TagValues;
}

export const DEFAULT_PARAMS: CalculatorParams = {
	...DEFAULT_RULE_SET,
	count: 0,
	tags: ACE_FIVE_TAGS,
};

/**
 * A dealer's final-outcome distribution: probability by slot, where slot 0 is
 * a two-card natural, slot 22 is a bust, and slots 4-21 are made totals.
 * Outcomes below 17 are only reachable by a dealer forced to stand on a stiff
 * hand because the shoe ran out, but they are represented exactly all the same.
 */
type Dist = Float64Array;
const NATURAL = 0;
const BUST = 22;
const DIST_LEN = 23;
/**
 * Stand EV indexed by the player's total, with the dealer's bust probability
 * in the otherwise impossible slot 0. It runs past 21 so that a caller asking
 * about a total no real hand can hold still gets the comparison it asked for.
 */
const TABLE_LEN = 31;
/**
 * The stand table carries a second half: the chance the dealer ties the
 * player's total, at `PUSH_OFFSET + total`. It rides in the same array as the
 * EVs rather than a memo of its own because both are read straight off one
 * dealer distribution, and the memo they would live in is entered once per
 * node of the player recursion -- a second allocation and a second map per
 * entry there costs more than the 31 slots this appends.
 */
const PUSH_OFFSET = TABLE_LEN;

const RANK_INDEX: Record<Rank, number> = Object.fromEntries(
	RANKS.map((rank, index) => [rank, index])
) as Record<Rank, number>;

/** Hard value of each rank, indexed by `RANK_INDEX` (an ace counts as 11). */
const RANK_VALUE = Int32Array.from([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
const ACE_INDEX = RANKS.length - 1;

/**
 * Half-card units mean one *card* is two units, so drawing a card subtracts
 * 2. `applyCountToComposition` can leave a rank on an odd number of units, so
 * every draw loop guards on `n >= CARD_UNITS` rather than `n > 0`: the
 * leftover half-unit is not a card anyone can be dealt.
 */
const CARD_UNITS = 2;

/**
 * Place value per rank for the memo key. A node is identified by *which cards
 * have been removed* from the engine's root composition, packed into a single
 * exact float: ten ranks at five bits each is 50 bits, inside the 53 a double
 * carries. A child's key is its parent's plus one place value, so identifying a
 * node costs one addition instead of rebuilding a string from the whole
 * composition at every level.
 *
 * Five bits caps a rank at 31 removals. A dealer hand and a player hand between
 * them cannot draw that many of one rank -- twelve aces or eleven twos already
 * bust a single hand -- so keys stay collision-free.
 */
const KEY_MULT = Float64Array.from({ length: 10 }, (_, index) => 32 ** index);

/**
 * Adds one card to a (total, soft) hand state, demoting aces from 11 to 1
 * only as far as is needed to stay at or under 21. The result is returned
 * packed as `(total << 1) | soft` so that a draw -- the innermost operation in
 * the whole engine -- allocates nothing.
 *
 * `soft` means "exactly one ace in this hand is currently counted as 11" --
 * two aces can never both be 11 (22 busts), so a single flag is enough. A
 * soft hand that draws an ace therefore holds *two* demotable aces for the
 * duration of this call: the new one is demoted first, and only if the hand
 * is still over 21 does the original follow it down. That second ace is what
 * the hand keeps: soft 12 + T is hard 12, but A,A stays soft 12, and A,7,A
 * stays soft 19.
 */
function addPacked(total: number, soft: boolean, rankIndex: number): number {
	let newTotal = total + RANK_VALUE[rankIndex];
	let acesAsEleven = (soft ? 1 : 0) + (rankIndex === ACE_INDEX ? 1 : 0);
	while (newTotal > 21 && acesAsEleven > 0) {
		newTotal -= 10;
		acesAsEleven -= 1;
	}
	return (newTotal << 1) | (acesAsEleven > 0 ? 1 : 0);
}

/** `addPacked` unpacked, for the callers that aren't on the hot path. */
function addValue(total: number, soft: boolean, rank: Rank): [number, boolean] {
	const packed = addPacked(total, soft, RANK_INDEX[rank]);
	return [packed >> 1, (packed & 1) === 1];
}

/** Fields an EV table cell needs, before it is paired with its counterpart. */
export interface CellAnalysis {
	evPercent: number;
	optimalAction: PlayerAction;
	playerBustOnHitPercent: number;
	dealerBustPercent: number;
	actions: readonly ActionAnalysis[];
}

/** A hand's settlement probabilities, as fractions of 1. */
interface Outcome {
	win: number;
	push: number;
	lose: number;
}

const ZERO_OUTCOME: Outcome = { win: 0, push: 0, lose: 0 };

/**
 * Recovers a hand's settlement odds from its EV and its chance of pushing.
 *
 * A hand that is not surrendered ends in exactly one of win/push/lose, and its
 * EV is `stake * (win - lose)`. Two equations, two unknowns -- so the push
 * probability is the only thing the engine has to carry alongside the EV it
 * already computes, rather than a third parallel recursion.
 *
 * `stake` is the number of units riding on the hand: 2 for a double, 1
 * otherwise.
 */
function outcomeFromEv(ev: number, push: number, stake = 1): Outcome {
	const margin = ev / stake;
	const lose = (1 - push - margin) / 2;
	return { win: margin + lose, push, lose };
}

function scaleOutcome(outcome: Outcome, factor: number): Outcome {
	return {
		win: outcome.win * factor,
		push: outcome.push * factor,
		lose: outcome.lose * factor,
	};
}

function addOutcome(a: Outcome, b: Outcome): Outcome {
	return { win: a.win + b.win, push: a.push + b.push, lose: a.lose + b.lose };
}

/** Rounding can push a probability a hair outside [0, 1]; percentages shouldn't show it. */
function toPercent(probability: number): number {
	return Math.min(100, Math.max(0, probability * 100));
}

function outcomePercent(outcome: Outcome): ActionOutcome {
	return {
		winPercent: toPercent(outcome.win),
		pushPercent: toPercent(outcome.push),
		losePercent: toPercent(outcome.lose),
	};
}

/**
 * Picks the action the engine plays, and with it the cell's EV: the highest EV
 * wins, and the earliest entry wins a tie.
 */
function bestAction(actions: readonly ActionAnalysis[]): ActionAnalysis {
	let best = actions[0];
	for (const action of actions) {
		if (action.evPercent > best.evPercent) best = action;
	}
	return best;
}

/**
 * The three analysis grids one shoe composition yields, keyed by `gridKey` /
 * `splitGridKey`. A comparison table is two of these read side by side.
 */
export interface EvGrids {
	hard: Map<string, CellAnalysis>;
	soft: Map<string, CellAnalysis>;
	split: Map<string, CellAnalysis>;
}

/** The two-card hard/soft total of a pair, e.g. 8,8 -> hard 16; A,A -> soft 12
 * (the second ace drops to 1, but the first still counts as 11, so the hand
 * cannot bust on the next card). */
function pairTotal(rank: Rank): [number, boolean] {
	const [afterFirst, softAfterFirst] = addValue(0, false, rank);
	return addValue(afterFirst, softAfterFirst, rank);
}

/** The EV of surrendering: half the wager back, whatever the hand. */
const SURRENDER_EV = -0.5;

/**
 * The hole card that would complete a dealer blackjack, or null for an
 * upcard that cannot make one.
 */
function blackjackHoleRank(upcard: Rank): Rank | null {
	if (upcard === 'A') return 'T';
	if (upcard === 'T') return 'A';
	return null;
}

/**
 * Dealer distributions live in one growable arena instead of being individual
 * arrays: a full set of tables memoises on the order of a million of them, and
 * allocating each one separately made garbage collection the second-largest
 * cost in the engine after the recursion itself. A distribution is addressed by
 * an integer id and occupies `DIST_LEN` slots starting at `id * DIST_LEN`.
 *
 * `lo[id]` is the lowest slot the distribution has any mass in. For any real
 * shoe that is 17 -- the dealer cannot stand lower -- so the accumulation loop
 * touches six slots rather than nineteen, while the exhausted-shoe case that
 * strands the dealer on a stiff total stays exact.
 */
class DistArena {
	private data = new Float64Array(DIST_LEN * 4096);
	private lo = new Int32Array(4096);
	private size = 0;

	get slots(): Float64Array {
		return this.data;
	}

	lowest(id: number): number {
		return this.lo[id];
	}

	alloc(lowest: number): number {
		if ((this.size + 1) * DIST_LEN > this.data.length) {
			const grownData = new Float64Array(this.data.length * 2);
			grownData.set(this.data);
			this.data = grownData;
			const grownLo = new Int32Array(this.lo.length * 2);
			grownLo.set(this.lo);
			this.lo = grownLo;
		}
		const id = this.size;
		this.size += 1;
		this.lo[id] = lowest;
		return id;
	}

	reset(): void {
		this.data.fill(0);
		this.size = 0;
	}
}

/**
 * One engine walks one shoe composition. Draws are made by decrementing a rank
 * in `this.comp` and restoring it on the way back out rather than by copying
 * the composition at every node, so nothing may hold a reference to `this.comp`
 * across a recursive call and every path out of a draw loop must leave it as it
 * found it.
 */
class ShoeEv {
	private readonly h17: boolean;
	private readonly peek: boolean;
	private readonly das: boolean;
	private readonly splitLimit: number;
	private readonly resplitAces: boolean;
	private readonly hitSplitAces: boolean;
	private readonly surrender: Surrender;
	private readonly arena = new DistArena();
	/** Distributions for a dealer who is already finished, allocated once. */
	private readonly terminal = new Int32Array(DIST_LEN);
	/** memoDealer[total * 2 + soft]: removal key -> distribution id. */
	private readonly memoDealer: Map<number, number>[] = Array.from(
		{ length: 64 },
		() => new Map()
	);
	/** memoStand[upcard]: removal key -> stand EV by player total. */
	private readonly memoStand: Map<number, Float64Array>[] = Array.from(
		{ length: RANKS.length },
		() => new Map()
	);
	/** memoPlayer[(total * 2 + soft) * 10 + upcard]: removal key -> best EV. */
	private readonly memoPlayer: Map<number, number>[] = Array.from(
		{ length: 64 * RANKS.length },
		() => new Map()
	);
	/** The same, for `bestPush` -- keyed identically, filled only where a breakdown asks. */
	private readonly memoPush: Map<number, number>[] = Array.from(
		{ length: 64 * RANKS.length },
		() => new Map()
	);
	/** Removal keys are relative to the root composition the engine was first
	 * handed, so a different one invalidates every cache. */
	private rootKey: string | null = null;
	private comp = new Int32Array(RANKS.length);

	constructor(ruleSet: RuleSet) {
		this.h17 = ruleSet.dealerHitsSoft17;
		this.peek = ruleSet.dealerPeek;
		this.das = ruleSet.doubleAfterSplit;
		this.splitLimit = ruleSet.splitLimit;
		this.resplitAces = ruleSet.resplitAces;
		this.hitSplitAces = ruleSet.hitSplitAces;
		this.surrender = ruleSet.surrender;
		this.allocTerminals();
	}

	/** A dealer standing on `total`, and (in slot `BUST`) one who has busted. */
	private allocTerminals(): void {
		for (let total = 0; total < DIST_LEN; total += 1) {
			const id = this.arena.alloc(total);
			this.arena.slots[id * DIST_LEN + total] = 1;
			this.terminal[total] = id;
		}
	}

	private setRoot(comp0: Composition): void {
		const key = comp0.join(',');
		if (this.rootKey === key) return;
		if (this.rootKey !== null) {
			for (const memo of this.memoDealer) memo.clear();
			for (const memo of this.memoStand) memo.clear();
			for (const memo of this.memoPlayer) memo.clear();
			for (const memo of this.memoPush) memo.clear();
			this.arena.reset();
			this.allocTerminals();
		}
		this.rootKey = key;
		this.comp = Int32Array.from(comp0);
	}

	/**
	 * The dealer's final-outcome distribution, as an arena id.
	 *
	 * `totCards` is the caller-supplied count of half-card units remaining in
	 * `this.comp`, i.e. it always equals its sum. Every recursive step below
	 * removes exactly one card (`CARD_UNITS` units), so the count can be
	 * decremented arithmetically as it's threaded down instead of re-summed
	 * from the composition (an O(rank count) scan) at every node. `key` is
	 * threaded down the same way -- see `KEY_MULT`.
	 */
	private dealerDist(
		total: number,
		soft: boolean,
		totCards: number,
		key: number
	): number {
		if (total > 21) return this.terminal[BUST];
		const stands = total >= 18 || (total === 17 && (!soft || !this.h17));
		if (stands) return this.terminal[total];
		// Nothing left to draw: the dealer is stuck on a stiff total.
		if (totCards < CARD_UNITS) return this.terminal[total];

		const memo = this.memoDealer[total * 2 + (soft ? 1 : 0)];
		const cached = memo.get(key);
		if (cached !== undefined) return cached;

		const comp = this.comp;
		const subTotCards = totCards - CARD_UNITS;
		const children: number[] = [];
		const probabilities: number[] = [];
		let lowest = BUST;
		for (let index = 0; index < RANKS.length; index += 1) {
			const n = comp[index];
			if (n < CARD_UNITS) continue;
			const packed = addPacked(total, soft, index);
			comp[index] = n - CARD_UNITS;
			const child = this.dealerDist(
				packed >> 1,
				(packed & 1) === 1,
				subTotCards,
				key + KEY_MULT[index]
			);
			comp[index] = n;
			children.push(child);
			probabilities.push(n / totCards);
			if (this.arena.lowest(child) < lowest) lowest = this.arena.lowest(child);
		}

		// Allocated only once the children are in hand: the arena can move its
		// backing store while they are being computed.
		const id = this.arena.alloc(lowest);
		const slots = this.arena.slots;
		const at = id * DIST_LEN;
		for (let child = 0; child < children.length; child += 1) {
			const p = probabilities[child];
			const from = children[child] * DIST_LEN;
			for (let slot = lowest; slot < DIST_LEN; slot += 1) {
				slots[at + slot] += p * slots[from + slot];
			}
		}

		memo.set(key, id);
		return id;
	}

	/**
	 * Stand EV against `upcard` for every player total at once, with the
	 * dealer's bust probability in slot 0.
	 *
	 * Collapsing the dealer's distribution into a lookup table here is what
	 * makes standing free: the loop over dealer outcomes runs once per
	 * (composition, upcard) instead of once per stand-EV query, and the
	 * thousands of queries the player recursion makes against that same
	 * composition become array reads.
	 */
	private standTable(upcardIndex: number, totCards: number, key: number): Float64Array {
		const memo = this.memoStand[upcardIndex];
		const cached = memo.get(key);
		if (cached !== undefined) return cached;

		const dist = this.upcardDist(upcardIndex, totCards, key);
		const table = new Float64Array(TABLE_LEN * 2);
		table[0] = dist[BUST];
		let made = 0;
		for (let total = 4; total <= 21; total += 1) made += dist[total];
		let below = 0;
		for (let total = 4; total < TABLE_LEN; total += 1) {
			const tie = total <= 21 ? dist[total] : 0;
			// A dealer bust pays; a genuine two-card blackjack beats any hand
			// these tables can show (simplification #2 keeps player naturals out
			// of scope), even one that also lands on 21 by drawing.
			table[total] = dist[BUST] - dist[NATURAL] + below - (made - below - tie);
			table[PUSH_OFFSET + total] = tie;
			below += tie;
		}
		memo.set(key, table);
		return table;
	}

	/**
	 * The dealer's final-hand distribution from an upcard alone, as a standalone
	 * vector rather than an arena id: it is built once per (composition, upcard)
	 * and consumed immediately by `standTable`, so it is off the hot path.
	 *
	 * At a peeking table the dealer has already checked a ten or ace upcard
	 * for a natural, so any hand that is still being played is one where the
	 * hole card did *not* make blackjack -- the distribution is conditioned
	 * on that by enumerating the hole card explicitly, skipping the rank that
	 * would have ended the hand, and renormalising over what is left.
	 *
	 * Without the peek the dealer's natural is still live, but it is tracked
	 * as its own `NATURAL` outcome rather than folded into an ordinary dealer
	 * 21: a genuine two-card blackjack beats even a player hand that lands on
	 * a *made* 21 by drawing (e.g. a split ace pulling a ten), the standard
	 * rule that a natural is never merely tied by a hand built from more than
	 * two cards. `standTable` charges every `NATURAL` outcome as a loss
	 * unconditionally, which is safe because these tables never depict a
	 * player two-card natural to begin with (simplification #2).
	 */
	private upcardDist(upcardIndex: number, totCards: number, key: number): Dist {
		const upcard = RANKS[upcardIndex];
		const startTotal = RANK_VALUE[upcardIndex];
		const startSoft = upcardIndex === ACE_INDEX;
		const holeRank = blackjackHoleRank(upcard);
		if (holeRank === null) {
			const id = this.dealerDist(startTotal, startSoft, totCards, key);
			return this.arena.slots.slice(id * DIST_LEN, id * DIST_LEN + DIST_LEN);
		}

		const comp = this.comp;
		const holeIndex = RANK_INDEX[holeRank];
		const naturalCards = comp[holeIndex];
		const nonNaturalCards = totCards - naturalCards;
		// A shoe holding nothing but the blackjack-completing rank leaves no
		// hand to condition on: the hole card is guaranteed to be it.
		if (nonNaturalCards < CARD_UNITS) {
			const res = new Float64Array(DIST_LEN);
			res[this.peek ? 21 : NATURAL] = 1;
			return res;
		}

		const nonNatural = new Float64Array(DIST_LEN);
		const subTotCards = totCards - CARD_UNITS;
		for (let index = 0; index < RANKS.length; index += 1) {
			if (index === holeIndex) continue;
			const n = comp[index];
			if (n < CARD_UNITS) continue;
			const p = n / nonNaturalCards;
			const packed = addPacked(startTotal, startSoft, index);
			comp[index] = n - CARD_UNITS;
			const child = this.dealerDist(
				packed >> 1,
				(packed & 1) === 1,
				subTotCards,
				key + KEY_MULT[index]
			);
			comp[index] = n;
			const from = child * DIST_LEN;
			for (let slot = 4; slot < DIST_LEN; slot += 1) {
				nonNatural[slot] += p * this.arena.slots[from + slot];
			}
		}

		// The dealer has already checked and confirmed no natural -- the hand
		// being played only exists in this natural-free world.
		if (this.peek) return nonNatural;

		const pNatural = naturalCards / totCards;
		const res = new Float64Array(DIST_LEN);
		res[NATURAL] = pNatural;
		for (let slot = 4; slot < DIST_LEN; slot += 1) {
			res[slot] = (1 - pNatural) * nonNatural[slot];
		}
		return res;
	}

	/** Chance the hole card makes a dealer natural, before any peek. */
	private dealerBlackjackProb(upcard: Rank, totCards: number): number {
		const holeRank = blackjackHoleRank(upcard);
		if (holeRank === null || totCards < CARD_UNITS) return 0;
		return this.comp[RANK_INDEX[holeRank]] / totCards;
	}

	private standEv(
		playerTotal: number,
		upcardIndex: number,
		totCards: number,
		key: number
	): number {
		return this.standTable(upcardIndex, totCards, key)[playerTotal];
	}

	/** Chance the dealer finishes on exactly `playerTotal`, i.e. a stood hand pushes. */
	private standPush(
		playerTotal: number,
		upcardIndex: number,
		totCards: number,
		key: number
	): number {
		return this.standTable(upcardIndex, totCards, key)[PUSH_OFFSET + playerTotal];
	}

	private hitEv(
		total: number,
		soft: boolean,
		upcardIndex: number,
		totCards: number,
		key: number
	): number {
		const comp = this.comp;
		const subTotCards = totCards - CARD_UNITS;
		let evHit = 0.0;
		for (let index = 0; index < RANKS.length; index += 1) {
			const n = comp[index];
			if (n < CARD_UNITS) continue;
			const p = n / totCards;
			const packed = addPacked(total, soft, index);
			comp[index] = n - CARD_UNITS;
			evHit +=
				p
				* this.bestEv(
					packed >> 1,
					(packed & 1) === 1,
					upcardIndex,
					subTotCards,
					key + KEY_MULT[index]
				);
			comp[index] = n;
		}
		return evHit;
	}

	private bestEv(
		total: number,
		soft: boolean,
		upcardIndex: number,
		totCards: number,
		key: number
	): number {
		if (total > 21) return -1.0;

		const memo =
			this.memoPlayer[(total * 2 + (soft ? 1 : 0)) * RANKS.length + upcardIndex];
		const cached = memo.get(key);
		if (cached !== undefined) return cached;

		const evStand = this.standEv(total, upcardIndex, totCards, key);
		if (total >= 21) {
			memo.set(key, evStand);
			return evStand;
		}

		const evHit =
			totCards >= CARD_UNITS ? this.hitEv(total, soft, upcardIndex, totCards, key) : 0.0;

		const best = Math.max(evStand, evHit);
		memo.set(key, best);
		return best;
	}

	/**
	 * Chance a hand played out the way `bestEv` plays it ends in a push.
	 *
	 * It shadows `bestEv` rather than being folded into it: the EV recursion is
	 * the engine's hot path and runs for every cell, while this is only ever
	 * entered from the handful of top-level hands whose action breakdown is
	 * displayed. Which branch `bestEv` took is read back off its own memo --
	 * a hand only stands where standing is at least as good, so a best EV
	 * strictly above the stand EV is one that hit.
	 */
	private bestPush(
		total: number,
		soft: boolean,
		upcardIndex: number,
		totCards: number,
		key: number
	): number {
		// A busted hand is a loss, never a push.
		if (total > 21) return 0;

		const memo = this.memoPush[(total * 2 + (soft ? 1 : 0)) * RANKS.length + upcardIndex];
		const cached = memo.get(key);
		if (cached !== undefined) return cached;

		const evStand = this.standEv(total, upcardIndex, totCards, key);
		const best = this.bestEv(total, soft, upcardIndex, totCards, key);
		const push =
			best > evStand ?
				this.hitPush(total, soft, upcardIndex, totCards, key)
			:	this.standPush(total, upcardIndex, totCards, key);

		memo.set(key, push);
		return push;
	}

	/** `hitEv`'s push counterpart: take one card, then play on optimally. */
	private hitPush(
		total: number,
		soft: boolean,
		upcardIndex: number,
		totCards: number,
		key: number
	): number {
		const comp = this.comp;
		const subTotCards = totCards - CARD_UNITS;
		let push = 0.0;
		for (let index = 0; index < RANKS.length; index += 1) {
			const n = comp[index];
			if (n < CARD_UNITS) continue;
			const p = n / totCards;
			const packed = addPacked(total, soft, index);
			comp[index] = n - CARD_UNITS;
			push +=
				p
				* this.bestPush(
					packed >> 1,
					(packed & 1) === 1,
					upcardIndex,
					subTotCards,
					key + KEY_MULT[index]
				);
			comp[index] = n;
		}
		return push;
	}

	/** EV of taking exactly one more card, then being forced to stand, at double the bet. */
	private doubleEv(
		total: number,
		soft: boolean,
		upcardIndex: number,
		totCards: number,
		key: number
	): number {
		if (totCards < CARD_UNITS) return this.standEv(total, upcardIndex, totCards, key) * 2;

		const comp = this.comp;
		const subTotCards = totCards - CARD_UNITS;
		let ev = 0.0;
		for (let index = 0; index < RANKS.length; index += 1) {
			const n = comp[index];
			if (n < CARD_UNITS) continue;
			const p = n / totCards;
			const newTotal = addPacked(total, soft, index) >> 1;
			if (newTotal > 21) {
				ev += p * -2;
				continue;
			}
			comp[index] = n - CARD_UNITS;
			ev +=
				p * 2 * this.standEv(newTotal, upcardIndex, subTotCards, key + KEY_MULT[index]);
			comp[index] = n;
		}
		return ev;
	}

	/** `doubleEv`'s push counterpart: the one card drawn has to land on the dealer's total. */
	private doublePush(
		total: number,
		soft: boolean,
		upcardIndex: number,
		totCards: number,
		key: number
	): number {
		if (totCards < CARD_UNITS) return this.standPush(total, upcardIndex, totCards, key);

		const comp = this.comp;
		const subTotCards = totCards - CARD_UNITS;
		let push = 0.0;
		for (let index = 0; index < RANKS.length; index += 1) {
			const n = comp[index];
			if (n < CARD_UNITS) continue;
			const newTotal = addPacked(total, soft, index) >> 1;
			// A busted double is a loss outright, so it contributes no push.
			if (newTotal > 21) continue;
			comp[index] = n - CARD_UNITS;
			push +=
				(n / totCards)
				* this.standPush(newTotal, upcardIndex, subTotCards, key + KEY_MULT[index]);
			comp[index] = n;
		}
		return push;
	}

	/** Probability that a single hit card busts the player's current total. */
	private playerBustOnHitProb(total: number, soft: boolean, totCards: number): number {
		if (totCards < CARD_UNITS) return 0;

		const comp = this.comp;
		let bustP = 0.0;
		for (let index = 0; index < RANKS.length; index += 1) {
			const n = comp[index];
			if (n < CARD_UNITS) continue;
			if (addPacked(total, soft, index) >> 1 > 21) bustP += n / totCards;
		}
		return bustP;
	}

	/**
	 * What giving the hand up is worth, or null at a table that doesn't offer
	 * it. The value comes back in the *same frame* as the play EVs it is about
	 * to be compared against and displayed beside, so a caller can treat it as
	 * one more candidate action.
	 *
	 * - **Late surrender, dealer peeks.** The peek has already happened, so
	 *   both sides live in the same no-dealer-blackjack world and the hand is
	 *   simply worth half the wager back.
	 * - **Early surrender, dealer peeks.** Here surrender genuinely does dodge
	 *   the natural -- which is exactly what makes it worth taking against a
	 *   ten or an ace -- so its true value is -0.5 in the *pre-peek* world.
	 *   Every other cell at a peeking table is reported conditional on no
	 *   dealer natural, so -0.5 is rebased into that frame as
	 *   `(-0.5 + pBJ) / (1 - pBJ)`. That rebasing is monotonic, so the action
	 *   chosen is identical to comparing both sides pre-peek, and the number
	 *   displayed no longer sits in a different frame from its neighbours.
	 * - **No peek.** The dealer takes no hole card at all, so a surrender is
	 *   settled and the stake is off the table before the dealer draws their
	 *   second card. A natural that arrives later has nothing left to collect,
	 *   which makes every no-hole-card surrender an early one worth a flat
	 *   -0.5 -- and cells at a no-peek table are already unconditional, so
	 *   that is directly comparable to its neighbours. (The "all bets lost"
	 *   convention still applies to doubles and splits, whose stakes *are*
	 *   still live when the dealer draws.) A no-peek table therefore has no
	 *   late surrender to offer; the UI does not present the combination, and
	 *   the engine treats it as the early one it necessarily is.
	 * - **ES10.** Surrender against a ten only, taken before any check, so it
	 *   is priced as the early one wherever it is offered and is `null`
	 *   against every other upcard.
	 */
	private surrenderEv(upcard: Rank, totCards: number): number | null {
		if (this.surrender === 'none') return null;
		// 'es10' is offered against a ten and nothing else -- not late against
		// the rest of the row, simply absent there.
		if (this.surrender === 'es10' && upcard !== 'T') return null;
		// No hole card to be late to: half the stake, in the unconditional
		// frame every other no-peek cell is already reported in.
		if (!this.peek) return SURRENDER_EV;
		// Late surrender behind a peek: the check has happened, so both sides
		// live in the same no-dealer-blackjack world and half the stake is
		// half the stake.
		if (this.surrender === 'late') return SURRENDER_EV;

		const pBlackjack = this.dealerBlackjackProb(upcard, totCards);
		// A shoe that can only make a natural leaves no conditional world to
		// rebase into; the pre-peek value is all there is.
		if (pBlackjack >= 1) return SURRENDER_EV;
		return (SURRENDER_EV + pBlackjack) / (1 - pBlackjack);
	}

	/**
	 * One action's price, in the form the drill-down dialog reads. Each of
	 * these pairs the EV the grid already compares against with the settlement
	 * odds behind it, so a cell's headline number and its breakdown can never
	 * disagree about what an action is worth.
	 */
	private standAction(
		total: number,
		upcardIndex: number,
		totCards: number,
		key: number
	): ActionAnalysis {
		const ev = this.standEv(total, upcardIndex, totCards, key);
		const push = this.standPush(total, upcardIndex, totCards, key);
		return {
			action: 'S',
			evPercent: ev * 100,
			outcome: outcomePercent(outcomeFromEv(ev, push)),
		};
	}

	private hitAction(
		total: number,
		soft: boolean,
		upcardIndex: number,
		totCards: number,
		key: number
	): ActionAnalysis {
		const ev = this.hitEv(total, soft, upcardIndex, totCards, key);
		const push = this.hitPush(total, soft, upcardIndex, totCards, key);
		return {
			action: 'H',
			evPercent: ev * 100,
			outcome: outcomePercent(outcomeFromEv(ev, push)),
		};
	}

	private doubleAction(
		total: number,
		soft: boolean,
		upcardIndex: number,
		totCards: number,
		key: number
	): ActionAnalysis {
		const ev = this.doubleEv(total, soft, upcardIndex, totCards, key);
		const push = this.doublePush(total, soft, upcardIndex, totCards, key);
		return {
			action: 'D',
			evPercent: ev * 100,
			// Two units are riding on the hand, so its EV is twice its margin.
			outcome: outcomePercent(outcomeFromEv(ev, push, 2)),
		};
	}

	/** The surrender entry, or null at a table (or against an upcard) that doesn't offer it. */
	private surrenderAction(upcard: Rank, totCards: number): ActionAnalysis | null {
		const ev = this.surrenderEv(upcard, totCards);
		if (ev === null) return null;
		return { action: 'R', evPercent: ev * 100, outcome: null };
	}

	/** Half-card units left once the dealer's upcard is off the shoe. */
	private totCardsAfterUpcard(): number {
		let sum = 0;
		for (let index = 0; index < RANKS.length; index += 1) sum += this.comp[index];
		return sum - CARD_UNITS;
	}

	/** Optimal action (incl. doubling and surrender), EV, and bust odds for each total vs. upcard. */
	analyzeGrid(
		comp0: Composition,
		totals: readonly number[],
		upcards: readonly Rank[],
		soft = false
	): Map<string, CellAnalysis> {
		this.setRoot(comp0);
		const comp = this.comp;
		const out = new Map<string, CellAnalysis>();
		const totCards = this.totCardsAfterUpcard();

		for (const upcard of upcards) {
			const upcardIndex = RANK_INDEX[upcard];
			comp[upcardIndex] -= CARD_UNITS;
			const key = KEY_MULT[upcardIndex];
			const dealerBustPercent = this.standTable(upcardIndex, totCards, key)[0] * 100;

			for (const total of totals) {
				// A made 21 (e.g. soft A,T) is always stood on -- hitting it is not a
				// real decision, so there is no optimal-play comparison to make.
				if (total >= 21) {
					const stand = this.standAction(total, upcardIndex, totCards, key);
					out.set(gridKey(total, upcard), {
						evPercent: stand.evPercent,
						optimalAction: 'S',
						playerBustOnHitPercent: 0,
						dealerBustPercent,
						actions: [stand],
					});
					continue;
				}

				const actions: ActionAnalysis[] = [
					this.standAction(total, upcardIndex, totCards, key),
					this.doubleAction(total, soft, upcardIndex, totCards, key),
					this.hitAction(total, soft, upcardIndex, totCards, key),
				];
				const surrender = this.surrenderAction(upcard, totCards);
				if (surrender !== null) actions.push(surrender);
				const best = bestAction(actions);

				out.set(gridKey(total, upcard), {
					evPercent: best.evPercent,
					optimalAction: best.action,
					playerBustOnHitPercent: this.playerBustOnHitProb(total, soft, totCards) * 100,
					dealerBustPercent,
					actions,
				});
			}

			comp[upcardIndex] += CARD_UNITS;
		}
		return out;
	}

	/**
	 * EV of splitting a pair: two hands at one unit each, each starting from a
	 * single card of `rank` plus a mandatory second card, then played
	 * optimally. Doubling is offered only when the table allows it after a
	 * split; split aces follow the common one-card-per-hand, must-stand rule
	 * unless `hitSplitAces` lets them be drawn to like any other hand.
	 *
	 * `splitLimit` is a budget belonging to the *round*, not to either hand:
	 * it caps how many hands this one starting hand may end up as in total.
	 * The two hands the first split creates therefore share it, and a hand
	 * that splits again shares its own allowance between its two children in
	 * turn -- as evenly as an integer allows, since sibling independence
	 * (below) leaves no way to know which of them will actually need the
	 * slots. An allowance of one hand is a hand that may not split.
	 *
	 * Both hands draw against the same shoe composition: the second hand's
	 * draws are not conditioned on the first hand's actual draws, extending
	 * simplification #1 (own cards not removed) to sibling split hands.
	 *
	 * That independence is what makes the resplit ladder cheap. A hand with a
	 * larger allowance is worth the same draw-by-draw play EVs as one with
	 * none -- the only difference is that a paired-up draw may instead be
	 * traded for two hands that divide the allowance. So the play EVs are
	 * computed once and the ladder is climbed over allowances alone, rather
	 * than re-entering the whole draw enumeration (and its stand/hit/double
	 * recursions) per level.
	 */
	private splitAnalysis(
		rankIndex: number,
		upcardIndex: number,
		totCards: number,
		key: number
	): { ev: number; outcome: Outcome } {
		const isAce = rankIndex === ACE_INDEX;
		const startTotal = RANK_VALUE[rankIndex];
		if (totCards < CARD_UNITS) {
			const ev = this.standEv(startTotal, upcardIndex, totCards, key);
			const push = this.standPush(startTotal, upcardIndex, totCards, key);
			return { ev: 2 * ev, outcome: outcomeFromEv(ev, push) };
		}

		const comp = this.comp;
		const subTotCards = totCards - CARD_UNITS;
		const drawProbs: number[] = [];
		const drawPlayEvs: number[] = [];
		const drawOutcomes: Outcome[] = [];
		const drawPairsUp: boolean[] = [];
		for (let index = 0; index < RANKS.length; index += 1) {
			const n = comp[index];
			if (n < CARD_UNITS) continue;
			const packed = addPacked(startTotal, isAce, index);
			const newTotal = packed >> 1;
			const newSoft = (packed & 1) === 1;
			const drawKey = key + KEY_MULT[index];
			comp[index] = n - CARD_UNITS;

			// Written as a running maximum rather than one `Math.max` so the
			// settlement odds of the branch actually taken can be picked up
			// alongside its EV -- and so the push probability behind a branch
			// that loses the comparison is never computed at all.
			let playEv = this.standEv(newTotal, upcardIndex, subTotCards, drawKey);
			let playOutcome = outcomeFromEv(
				playEv,
				this.standPush(newTotal, upcardIndex, subTotCards, drawKey)
			);
			// A split ace takes exactly one card and must stand on it, unless
			// the table lets it be drawn to like any other hand.
			const oneCardOnly = isAce && !this.hitSplitAces;
			if (!oneCardOnly) {
				const evHit = this.hitEv(newTotal, newSoft, upcardIndex, subTotCards, drawKey);
				if (evHit > playEv) {
					playEv = evHit;
					playOutcome = outcomeFromEv(
						evHit,
						this.hitPush(newTotal, newSoft, upcardIndex, subTotCards, drawKey)
					);
				}
				if (this.das) {
					const evDouble = this.doubleEv(
						newTotal,
						newSoft,
						upcardIndex,
						subTotCards,
						drawKey
					);
					if (evDouble > playEv) {
						playEv = evDouble;
						playOutcome = outcomeFromEv(
							evDouble,
							this.doublePush(newTotal, newSoft, upcardIndex, subTotCards, drawKey),
							2
						);
					}
				}
			}

			comp[index] = n;
			drawProbs.push(n / totCards);
			drawPlayEvs.push(playEv);
			drawOutcomes.push(playOutcome);
			drawPairsUp.push(index === rankIndex);
		}

		let noResplitEv = 0;
		let noResplitOutcome = ZERO_OUTCOME;
		for (let draw = 0; draw < drawProbs.length; draw += 1) {
			noResplitEv += drawProbs[draw] * drawPlayEvs[draw];
			noResplitOutcome = addOutcome(
				noResplitOutcome,
				scaleOutcome(drawOutcomes[draw], drawProbs[draw])
			);
		}
		const noResplit = { ev: noResplitEv, outcome: noResplitOutcome };
		const canResplit = !isAce || this.resplitAces;
		const byAllowance = new Map<number, { ev: number; outcome: Outcome }>();

		/**
		 * One post-split hand that may occupy at most `hands` hand slots: its EV,
		 * and the odds of how a single hand ends up settling.
		 *
		 * The two are not scaled alike. EV accumulates across every hand the slot
		 * turns into, because that is where the money is; the settlement odds are
		 * averaged over them instead, because the question they answer is what
		 * becomes of one of the hands in front of the player.
		 */
		const handAnalysis = (hands: number): { ev: number; outcome: Outcome } => {
			if (hands < 2 || !canResplit) return noResplit;
			const cached = byAllowance.get(hands);
			if (cached !== undefined) return cached;

			// Splitting again trades this one hand for two, which divide this
			// hand's own allowance between them.
			const first = handAnalysis(Math.ceil(hands / 2));
			const second = handAnalysis(Math.floor(hands / 2));
			const evResplit = first.ev + second.ev;
			const outcomeResplit = scaleOutcome(addOutcome(first.outcome, second.outcome), 0.5);

			let ev = 0;
			let outcome = ZERO_OUTCOME;
			for (let draw = 0; draw < drawProbs.length; draw += 1) {
				const resplits = drawPairsUp[draw] && evResplit > drawPlayEvs[draw];
				ev += drawProbs[draw] * (resplits ? evResplit : drawPlayEvs[draw]);
				outcome = addOutcome(
					outcome,
					scaleOutcome(resplits ? outcomeResplit : drawOutcomes[draw], drawProbs[draw])
				);
			}

			const analysis = { ev, outcome };
			byAllowance.set(hands, analysis);
			return analysis;
		};

		const first = handAnalysis(Math.ceil(this.splitLimit / 2));
		const second = handAnalysis(Math.floor(this.splitLimit / 2));
		return {
			ev: first.ev + second.ev,
			outcome: scaleOutcome(addOutcome(first.outcome, second.outcome), 0.5),
		};
	}

	/** Optimal action (incl. splitting) and EV/bust odds for each pair vs. upcard. */
	analyzeSplitGrid(
		comp0: Composition,
		pairRanks: readonly Rank[],
		upcards: readonly Rank[]
	): Map<string, CellAnalysis> {
		this.setRoot(comp0);
		const comp = this.comp;
		const out = new Map<string, CellAnalysis>();
		const totCards = this.totCardsAfterUpcard();

		for (const upcard of upcards) {
			const upcardIndex = RANK_INDEX[upcard];
			comp[upcardIndex] -= CARD_UNITS;
			const key = KEY_MULT[upcardIndex];
			const dealerBustPercent = this.standTable(upcardIndex, totCards, key)[0] * 100;

			for (const rank of pairRanks) {
				const [total, soft] = pairTotal(rank);
				const actions: ActionAnalysis[] = [
					this.standAction(total, upcardIndex, totCards, key),
					this.doubleAction(total, soft, upcardIndex, totCards, key),
					this.hitAction(total, soft, upcardIndex, totCards, key),
				];
				// A split limit of one hand is a table that doesn't split at all.
				if (this.splitLimit >= 2) {
					const split = this.splitAnalysis(RANK_INDEX[rank], upcardIndex, totCards, key);
					actions.push({
						action: 'P',
						evPercent: split.ev * 100,
						outcome: outcomePercent(split.outcome),
					});
				}
				const surrender = this.surrenderAction(upcard, totCards);
				if (surrender !== null) actions.push(surrender);
				const best = bestAction(actions);

				out.set(splitGridKey(rank, upcard), {
					evPercent: best.evPercent,
					optimalAction: best.action,
					playerBustOnHitPercent: this.playerBustOnHitProb(total, soft, totCards) * 100,
					dealerBustPercent,
					actions,
				});
			}

			comp[upcardIndex] += CARD_UNITS;
		}
		return out;
	}
}

function gridKey(total: number, upcard: Rank): string {
	return `${total}-${upcard}`;
}

function splitGridKey(rank: Rank, upcard: Rank): string {
	return `${rank}-${upcard}`;
}

export function baseComposition(ruleSet: RuleSet): Composition {
	const comp = new Array(10).fill(0);
	for (const rank of ['2', '3', '4', '5', '6', '7', '8', '9'] as Rank[]) {
		comp[RANK_INDEX[rank]] = 4 * ruleSet.decks * 2;
	}
	comp[RANK_INDEX.T] = 16 * ruleSet.decks * 2;
	comp[RANK_INDEX.A] = 4 * ruleSet.decks * 2;
	return comp;
}

/**
 * Rounds a vector of fractional deltas to integers while preserving its sum
 * (largest-remainder method): floor every entry, then hand the leftover
 * units to the entries with the largest fractional parts.
 */
function roundPreservingSum(deltas: readonly number[]): number[] {
	const floors = deltas.map(Math.floor);
	const total = Math.round(deltas.reduce((sum, d) => sum + d, 0));
	let remaining = total - floors.reduce((sum, d) => sum + d, 0);

	const byRemainder = deltas
		.map((delta, index) => ({ index, remainder: delta - Math.floor(delta) }))
		.sort((a, b) => b.remainder - a.remainder);

	for (const { index } of byRemainder) {
		if (remaining <= 0) break;
		floors[index] += 1;
		remaining -= 1;
	}
	return floors;
}

/**
 * Adjusts a composition to represent a given running count under an
 * arbitrary counting system.
 *
 * The count value `N` is spread across every rank at once: each rank is
 * shifted in proportion to how many of it the shoe holds (`w_r`) and to how
 * far its tag sits from the frequency-weighted mean tag (`t̄`), i.e.
 * `d_r = -λ · w_r · (t_r - t̄)` in real cards, with `λ` picked so the
 * removals really do produce a running count of `N`. Subtracting `t̄` keeps
 * the shoe size fixed (`Σ d_r = 0`) and makes unbalanced systems read their
 * count relative to the system's own pivot.
 *
 * For the Ace-Five tags this reduces exactly to the original special case:
 * `N/2` fewer real fives and `N/2` more real aces, whatever the deck count.
 *
 * `count` need not be a whole number -- a fractional running count (or a true
 * count) is a perfectly meaningful input and is carried straight into `λ`.
 * Only the resulting per-rank deltas are rounded, in half-card units and with
 * `roundPreservingSum` (rank counts index a char-code memo key, so they must
 * stay whole); the residual is under half a half-card per rank.
 */
export function applyCountToComposition(
	comp: Composition,
	tags: TagValues,
	count: number
): Composition {
	const weights = comp.map((halfCards) => halfCards / 2);
	const totalCards = weights.reduce((sum, w) => sum + w, 0);
	const meanTag =
		weights.reduce((sum, w, index) => sum + w * tags[RANKS[index]], 0) / totalCards;

	// Σ w_r · t_r · (t_r - t̄) -- the frequency-weighted variance of the tags,
	// i.e. how much counting information the system carries per shoe.
	const spread = weights.reduce(
		(sum, w, index) => sum + w * tags[RANKS[index]] * (tags[RANKS[index]] - meanTag),
		0
	);
	if (Math.abs(spread) < 1e-9) {
		if (count === 0) return comp.slice();
		throw new Error('Tag values give the count no effect (all ranks weighted equally).');
	}

	const lambda = count / spread;
	const halfCardDeltas = weights.map(
		(w, index) => -2 * lambda * w * (tags[RANKS[index]] - meanTag)
	);

	const next = comp.slice();
	const rounded = roundPreservingSum(halfCardDeltas);
	for (let index = 0; index < next.length; index += 1) {
		next[index] += rounded[index];
		if (next[index] < 0) {
			throw new Error('Count too extreme for this shoe size (negative card count).');
		}
	}
	return next;
}

/** Pairs a base grid with a count-adjusted one into a hard/soft-totals table. */
function buildEvComparison(
	baseGrid: Map<string, CellAnalysis>,
	countGrid: Map<string, CellAnalysis>,
	totals: readonly number[],
	upcards: readonly Rank[]
): EvComparisonResult {
	const rows: EvComparisonRow[] = [];
	for (const upcard of upcards) {
		for (const total of totals) {
			const key = gridKey(total, upcard);
			const baseCell = baseGrid.get(key)!;
			const baseEvPercent = baseCell.evPercent;
			const analysis = countGrid.get(key)!;
			const countEvPercent = analysis.evPercent;
			rows.push({
				total,
				upcard,
				baseEvPercent,
				countEvPercent,
				deltaPercentPoints: countEvPercent - baseEvPercent,
				optimalAction: analysis.optimalAction,
				baseAction: baseCell.optimalAction,
				playerBustOnHitPercent: analysis.playerBustOnHitPercent,
				dealerBustPercent: analysis.dealerBustPercent,
				actions: analysis.actions,
			});
		}
	}

	return { totals, upcards, rows };
}

/**
 * Same, for the splits table. Each row's EV is the fully optimal action's EV
 * -- stand, hit, double, or split -- as in the hard/soft tables, and
 * `optimalAction` is drawn from the same comparison, so the displayed EV
 * always matches the recommended action.
 */
function buildSplitEvComparison(
	baseGrid: Map<string, CellAnalysis>,
	countGrid: Map<string, CellAnalysis>,
	pairRanks: readonly Rank[],
	upcards: readonly Rank[]
): SplitEvComparisonResult {
	const rows: SplitEvComparisonRow[] = [];
	for (const upcard of upcards) {
		for (const rank of pairRanks) {
			const key = splitGridKey(rank, upcard);
			const baseCell = baseGrid.get(key)!;
			const countCell = countGrid.get(key)!;
			rows.push({
				pairRank: rank,
				upcard,
				baseEvPercent: baseCell.evPercent,
				countEvPercent: countCell.evPercent,
				deltaPercentPoints: countCell.evPercent - baseCell.evPercent,
				optimalAction: countCell.optimalAction,
				baseAction: baseCell.optimalAction,
				playerBustOnHitPercent: countCell.playerBustOnHitPercent,
				dealerBustPercent: countCell.dealerBustPercent,
				actions: countCell.actions,
			});
		}
	}

	return { pairRanks, upcards, rows };
}

export function computeEvComparison(
	ruleSet: RuleSet,
	count: number,
	tags: TagValues = ACE_FIVE_TAGS,
	totals: readonly number[] = HARD_TOTALS,
	upcards: readonly Rank[] = RANKS,
	soft = false
): EvComparisonResult {
	const base = baseComposition(ruleSet);
	const modified = applyCountToComposition(base, tags, count);
	return buildEvComparison(
		new ShoeEv(ruleSet).analyzeGrid(base, totals, upcards, soft),
		new ShoeEv(ruleSet).analyzeGrid(modified, totals, upcards, soft),
		totals,
		upcards
	);
}

export function computeSplitEvComparison(
	ruleSet: RuleSet,
	count: number,
	tags: TagValues = ACE_FIVE_TAGS,
	pairRanks: readonly Rank[] = PAIR_RANKS,
	upcards: readonly Rank[] = RANKS
): SplitEvComparisonResult {
	const base = baseComposition(ruleSet);
	const modified = applyCountToComposition(base, tags, count);
	return buildSplitEvComparison(
		new ShoeEv(ruleSet).analyzeSplitGrid(base, pairRanks, upcards),
		new ShoeEv(ruleSet).analyzeSplitGrid(modified, pairRanks, upcards),
		pairRanks,
		upcards
	);
}

/**
 * Identifies a rule set for caching purposes: two rule sets sharing a key
 * produce identical grids from the same composition.
 *
 * It covers exactly the fields the engine reads -- everything the `ShoeEv`
 * constructor keeps, plus the deck count `baseComposition` needs -- so
 * `penetrationPercent` and `blackjackPayout`, which by design never reach the
 * EV maths (see `RuleSet`), don't needlessly invalidate a cached grid. Extend
 * it alongside the constructor if a rule ever starts reaching the maths.
 */
export function ruleSetKey(ruleSet: RuleSet): string {
	return [
		ruleSet.decks,
		ruleSet.dealerHitsSoft17 ? 1 : 0,
		ruleSet.dealerPeek ? 1 : 0,
		ruleSet.doubleAfterSplit ? 1 : 0,
		ruleSet.splitLimit,
		ruleSet.resplitAces ? 1 : 0,
		ruleSet.hitSplitAces ? 1 : 0,
		ruleSet.surrender,
	].join('|');
}

/**
 * Analyses one shoe composition across all three tables with a single engine.
 *
 * Dealer outcome distributions -- and, for split, the hit/stand/double sub-EVs
 * -- depend only on shoe composition and hand-in-progress state, not on which
 * table triggered the computation, so the memo caches populated by the first
 * grid are reused by the other two instead of being rebuilt from scratch.
 *
 * The result depends only on `ruleSet` and `comp`, never on the count that
 * produced `comp`, so a caller that recomputes as the count moves can hold the
 * unadjusted grids across calls (keyed by `ruleSetKey`) and pay for one
 * composition per change instead of two.
 */
export function computeEvGrids(ruleSet: RuleSet, comp: Composition): EvGrids {
	const engine = new ShoeEv(ruleSet);
	return {
		hard: engine.analyzeGrid(comp, HARD_TOTALS, RANKS, false),
		soft: engine.analyzeGrid(comp, SOFT_TOTALS, RANKS, true),
		split: engine.analyzeSplitGrid(comp, PAIR_RANKS, RANKS),
	};
}

export interface EvTables {
	hard: EvComparisonResult;
	soft: EvComparisonResult;
	split: SplitEvComparisonResult;
}

/** Reads a count-adjusted set of grids against the unadjusted ones. */
export function combineEvTables(baseGrids: EvGrids, countGrids: EvGrids): EvTables {
	return {
		hard: buildEvComparison(baseGrids.hard, countGrids.hard, HARD_TOTALS, RANKS),
		soft: buildEvComparison(baseGrids.soft, countGrids.soft, SOFT_TOTALS, RANKS),
		split: buildSplitEvComparison(baseGrids.split, countGrids.split, PAIR_RANKS, RANKS),
	};
}

/**
 * Computes all three tables (hard totals, soft totals, splits) from scratch.
 * This is the entry point for standalone and test use; `EvTable` reaches the
 * engine through the worker, which splits the same work into `computeEvGrids`
 * and `combineEvTables` so it can cache the base composition's grids.
 */
export function computeAllEvTables(
	ruleSet: RuleSet,
	count: number,
	tags: TagValues = ACE_FIVE_TAGS
): EvTables {
	const base = baseComposition(ruleSet);
	const modified = applyCountToComposition(base, tags, count);
	return combineEvTables(
		computeEvGrids(ruleSet, base),
		computeEvGrids(ruleSet, modified)
	);
}
