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
 */
export type Surrender = 'early' | 'late' | 'none';

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
	/** Dealer checks for blackjack against a ten or ace upcard. */
	dealerPeek: boolean;
}

/** Shoe composition in half-card units, indexed by RANK_INDEX. */
export type Composition = readonly number[];

/** A counting system's point value ("tag") for each rank. */
export type TagValues = Record<Rank, number>;

/** Fields an EV table cell (and its popover) needs, shared by every table's row shape. */
export interface EvCellData {
	baseEvPercent: number;
	countEvPercent: number;
	deltaPercentPoints: number;
	optimalAction: PlayerAction;
	playerBustOnHitPercent: number;
	dealerBustPercent: number;
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
export const SURRENDERS: readonly Surrender[] = ['early', 'late', 'none'];
export const DEFAULT_RULE_SET: RuleSet = {
	decks: 4,
	dealerHitsSoft17: false,
	penetrationPercent: 75,
	blackjackPayout: '3:2',
	surrender: 'late',
	splitLimit: 4,
	doubleAfterSplit: true,
	resplitAces: false,
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

type DealerDist = Record<string, number>;

const RANK_INDEX: Record<Rank, number> = Object.fromEntries(
	RANKS.map((rank, index) => [rank, index])
) as Record<Rank, number>;

const RANK_VALUE: Record<Rank, number> = {
	'2': 2,
	'3': 3,
	'4': 4,
	'5': 5,
	'6': 6,
	'7': 7,
	'8': 8,
	'9': 9,
	T: 10,
	A: 11,
};

/**
 * Half-card units mean one *card* is two units, so drawing a card subtracts
 * 2. `applyCountToComposition` can leave a rank on an odd number of units, so
 * every draw loop guards on `n >= CARD_UNITS` rather than `n > 0`: the
 * leftover half-unit is not a card anyone can be dealt.
 */
const CARD_UNITS = 2;

function removeCard(comp: Composition, rank: Rank): Composition {
	const next = comp.slice();
	next[RANK_INDEX[rank]] -= CARD_UNITS;
	return next;
}

/**
 * Adds one card to a (total, soft) hand state, demoting aces from 11 to 1
 * only as far as is needed to stay at or under 21.
 *
 * `soft` means "exactly one ace in this hand is currently counted as 11" --
 * two aces can never both be 11 (22 busts), so a single flag is enough. A
 * soft hand that draws an ace therefore holds *two* demotable aces for the
 * duration of this call: the new one is demoted first, and only if the hand
 * is still over 21 does the original follow it down. That second ace is what
 * the hand keeps: soft 12 + T is hard 12, but A,A stays soft 12, and A,7,A
 * stays soft 19.
 */
function addValue(total: number, soft: boolean, rank: Rank): [number, boolean] {
	let newTotal = total + RANK_VALUE[rank];
	let acesAsEleven = (soft ? 1 : 0) + (rank === 'A' ? 1 : 0);
	while (newTotal > 21 && acesAsEleven > 0) {
		newTotal -= 10;
		acesAsEleven -= 1;
	}
	return [newTotal, acesAsEleven > 0];
}

/** Fast, collision-free memo key: one char per rank count plus total/soft/upcard. */
function compKey(comp: Composition): string {
	return String.fromCharCode(...comp);
}

interface CellAnalysis {
	evPercent: number;
	optimalAction: PlayerAction;
	playerBustOnHitPercent: number;
	dealerBustPercent: number;
}

interface SplitCellAnalysis {
	evPercent: number;
	optimalAction: PlayerAction;
	playerBustOnHitPercent: number;
	dealerBustPercent: number;
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

class ShoeEv {
	private readonly h17: boolean;
	private readonly peek: boolean;
	private readonly das: boolean;
	private readonly splitLimit: number;
	private readonly resplitAces: boolean;
	private readonly surrender: Surrender;
	private readonly memoDealer = new Map<string, DealerDist>();
	private readonly memoDealerUpcard = new Map<string, DealerDist>();
	private readonly memoPlayer = new Map<string, number>();

	constructor(ruleSet: RuleSet) {
		this.h17 = ruleSet.dealerHitsSoft17;
		this.peek = ruleSet.dealerPeek;
		this.das = ruleSet.doubleAfterSplit;
		this.splitLimit = ruleSet.splitLimit;
		this.resplitAces = ruleSet.resplitAces;
		this.surrender = ruleSet.surrender;
	}

	/**
	 * `totCards` is the caller-supplied count of half-card units remaining in
	 * `comp`, i.e. it always equals `sum(comp)`. Every recursive step below
	 * removes exactly one card (`CARD_UNITS` units), so the count can be
	 * decremented arithmetically as it's threaded down instead of re-summed
	 * from `comp` (an O(rank count) scan) at every node.
	 */
	private dealerDist(
		comp: Composition,
		total: number,
		soft: boolean,
		totCards: number
	): DealerDist {
		const key = compKey(comp) + String.fromCharCode(total, soft ? 1 : 0);
		const cached = this.memoDealer.get(key);
		if (cached) return cached;

		if (total > 21) {
			const res = { bust: 1.0 };
			this.memoDealer.set(key, res);
			return res;
		}

		const stands = total >= 18 || (total === 17 && (!soft || !this.h17));
		if (stands) {
			const res = { [total]: 1.0 };
			this.memoDealer.set(key, res);
			return res;
		}

		const res: DealerDist = {};
		if (totCards < CARD_UNITS) {
			res[total] = 1.0;
			this.memoDealer.set(key, res);
			return res;
		}

		for (const rank of RANKS) {
			const n = comp[RANK_INDEX[rank]];
			if (n < CARD_UNITS) continue;
			const p = n / totCards;
			const newComp = removeCard(comp, rank);
			const [newTotal, newSoft] = addValue(total, soft, rank);
			const sub = this.dealerDist(newComp, newTotal, newSoft, totCards - CARD_UNITS);
			for (const k in sub) {
				res[k] = (res[k] ?? 0) + p * sub[k];
			}
		}

		this.memoDealer.set(key, res);
		return res;
	}

	/**
	 * The dealer's final-hand distribution from an upcard alone.
	 *
	 * At a peeking table the dealer has already checked a ten or ace upcard
	 * for a natural, so any hand that is still being played is one where the
	 * hole card did *not* make blackjack -- the distribution is conditioned
	 * on that by enumerating the hole card explicitly, skipping the rank that
	 * would have ended the hand, and renormalising over what is left.
	 *
	 * Without the peek the dealer's natural is still live, but it is tracked
	 * as its own `natural` outcome rather than folded into an ordinary dealer
	 * 21: a genuine two-card blackjack beats even a player hand that lands on
	 * a *made* 21 by drawing (e.g. a split ace pulling a ten), the standard
	 * rule that a natural is never merely tied by a hand built from more than
	 * two cards. `standEv` charges every `natural` outcome as a loss
	 * unconditionally, which is safe because these tables never depict a
	 * player two-card natural to begin with (simplification #2).
	 */
	private dealerUpcardDist(
		comp: Composition,
		upcard: Rank,
		totCards: number
	): DealerDist {
		const startTotal = upcard === 'A' ? 11 : RANK_VALUE[upcard];
		const startSoft = upcard === 'A';
		const holeRank = blackjackHoleRank(upcard);
		if (holeRank === null) {
			return this.dealerDist(comp, startTotal, startSoft, totCards);
		}

		const key = compKey(comp) + upcard;
		const cached = this.memoDealerUpcard.get(key);
		if (cached) return cached;

		const naturalCards = comp[RANK_INDEX[holeRank]];
		const nonNaturalCards = totCards - naturalCards;
		// A shoe holding nothing but the blackjack-completing rank leaves no
		// hand to condition on: the hole card is guaranteed to be it.
		if (nonNaturalCards < CARD_UNITS) {
			const res: DealerDist = this.peek ? { 21: 1.0 } : { natural: 1.0 };
			this.memoDealerUpcard.set(key, res);
			return res;
		}

		const nonNatural: DealerDist = {};
		for (const rank of RANKS) {
			if (rank === holeRank) continue;
			const n = comp[RANK_INDEX[rank]];
			if (n < CARD_UNITS) continue;
			const p = n / nonNaturalCards;
			const [newTotal, newSoft] = addValue(startTotal, startSoft, rank);
			const sub = this.dealerDist(
				removeCard(comp, rank),
				newTotal,
				newSoft,
				totCards - CARD_UNITS
			);
			for (const k in sub) {
				nonNatural[k] = (nonNatural[k] ?? 0) + p * sub[k];
			}
		}

		let res: DealerDist;
		if (this.peek) {
			// The dealer has already checked and confirmed no natural -- the
			// hand being played only exists in this natural-free world.
			res = nonNatural;
		} else {
			const pNatural = naturalCards / totCards;
			res = { natural: pNatural };
			for (const k in nonNatural) {
				res[k] = (res[k] ?? 0) + (1 - pNatural) * nonNatural[k];
			}
		}

		this.memoDealerUpcard.set(key, res);
		return res;
	}

	/** Chance the hole card makes a dealer natural, before any peek. */
	private dealerBlackjackProb(comp: Composition, upcard: Rank, totCards: number): number {
		const holeRank = blackjackHoleRank(upcard);
		if (holeRank === null || totCards < CARD_UNITS) return 0;
		return comp[RANK_INDEX[holeRank]] / totCards;
	}

	private standEv(
		comp: Composition,
		playerTotal: number,
		upcard: Rank,
		totCards: number
	): number {
		const dist = this.dealerUpcardDist(comp, upcard, totCards);
		let ev = 0.0;
		for (const key in dist) {
			const p = dist[key];
			if (key === 'bust') {
				ev += p;
			} else if (key === 'natural') {
				// A genuine two-card dealer blackjack beats any hand these tables
				// can show (simplification #2 keeps player naturals out of scope),
				// even one that also lands on 21 by drawing.
				ev -= p;
			} else {
				const outcome = Number(key);
				if (outcome < playerTotal) ev += p;
				else if (outcome > playerTotal) ev -= p;
			}
		}
		return ev;
	}

	private hitEv(
		comp: Composition,
		total: number,
		soft: boolean,
		upcard: Rank,
		totCards: number
	): number {
		let evHit = 0.0;
		for (const rank of RANKS) {
			const n = comp[RANK_INDEX[rank]];
			if (n < CARD_UNITS) continue;
			const p = n / totCards;
			const newComp = removeCard(comp, rank);
			const [newTotal, newSoft] = addValue(total, soft, rank);
			evHit += p * this.bestEv(newComp, newTotal, newSoft, upcard, totCards - CARD_UNITS);
		}
		return evHit;
	}

	private bestEv(
		comp: Composition,
		total: number,
		soft: boolean,
		upcard: Rank,
		totCards: number
	): number {
		if (total > 21) return -1.0;

		const key = compKey(comp) + String.fromCharCode(total, soft ? 1 : 0) + upcard;
		const cached = this.memoPlayer.get(key);
		if (cached !== undefined) return cached;

		const evStand = this.standEv(comp, total, upcard, totCards);
		if (total >= 21) {
			this.memoPlayer.set(key, evStand);
			return evStand;
		}

		const evHit =
			totCards >= CARD_UNITS ? this.hitEv(comp, total, soft, upcard, totCards) : 0.0;

		const best = Math.max(evStand, evHit);
		this.memoPlayer.set(key, best);
		return best;
	}

	/** EV of taking exactly one more card, then being forced to stand, at double the bet. */
	private doubleEv(
		comp: Composition,
		total: number,
		soft: boolean,
		upcard: Rank,
		totCards: number
	): number {
		if (totCards < CARD_UNITS) return this.standEv(comp, total, upcard, totCards) * 2;

		let ev = 0.0;
		for (const rank of RANKS) {
			const n = comp[RANK_INDEX[rank]];
			if (n < CARD_UNITS) continue;
			const p = n / totCards;
			const [newTotal] = addValue(total, soft, rank);
			if (newTotal > 21) {
				ev += p * -2;
				continue;
			}
			const newComp = removeCard(comp, rank);
			ev += p * 2 * this.standEv(newComp, newTotal, upcard, totCards - CARD_UNITS);
		}
		return ev;
	}

	/** Probability that a single hit card busts the player's current total. */
	private playerBustOnHitProb(
		comp: Composition,
		total: number,
		soft: boolean,
		totCards: number
	): number {
		if (totCards < CARD_UNITS) return 0;

		let bustP = 0.0;
		for (const rank of RANKS) {
			const n = comp[RANK_INDEX[rank]];
			if (n < CARD_UNITS) continue;
			const [newTotal] = addValue(total, soft, rank);
			if (newTotal > 21) bustP += n / totCards;
		}
		return bustP;
	}

	private dealerBustProb(comp: Composition, upcard: Rank, totCards: number): number {
		return this.dealerUpcardDist(comp, upcard, totCards)['bust'] ?? 0;
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
	 * - **No peek** (either surrender setting -- with no hole-card check there
	 *   is no earlier moment to surrender at, so both behave as the late one).
	 *   The player cannot buy their way out of a dealer natural: it is still
	 *   live, and under the "all bets lost" convention it takes the whole
	 *   wager. The hand is worth `-pBJ + (1 - pBJ) * -0.5`, not a flat -0.5,
	 *   and every neighbouring cell is likewise unconditional.
	 * - **Early surrender, dealer peeks.** Here surrender genuinely does dodge
	 *   the natural -- which is exactly what makes it worth taking against a
	 *   ten or an ace -- so its true value is -0.5 in the *pre-peek* world.
	 *   Every other cell at a peeking table is reported conditional on no
	 *   dealer natural, so -0.5 is rebased into that frame as
	 *   `(-0.5 + pBJ) / (1 - pBJ)`. That rebasing is monotonic, so the action
	 *   chosen is identical to comparing both sides pre-peek, and the number
	 *   displayed no longer sits in a different frame from its neighbours.
	 */
	private surrenderEv(comp: Composition, upcard: Rank, totCards: number): number | null {
		if (this.surrender === 'none') return null;
		if (this.peek && this.surrender === 'late') return SURRENDER_EV;

		const pBlackjack = this.dealerBlackjackProb(comp, upcard, totCards);
		if (!this.peek) return -pBlackjack + (1 - pBlackjack) * SURRENDER_EV;
		// A shoe that can only make a natural leaves no conditional world to
		// rebase into; the pre-peek value is all there is.
		if (pBlackjack >= 1) return SURRENDER_EV;
		return (SURRENDER_EV + pBlackjack) / (1 - pBlackjack);
	}

	/** Optimal action (incl. doubling and surrender), EV, and bust odds for each total vs. upcard. */
	analyzeGrid(
		comp0: Composition,
		totals: readonly number[],
		upcards: readonly Rank[],
		soft = false
	): Map<string, CellAnalysis> {
		const out = new Map<string, CellAnalysis>();
		const totCardsAfterUpcard = comp0.reduce((sum, n) => sum + n, 0) - CARD_UNITS;
		for (const upcard of upcards) {
			const compUpcard = removeCard(comp0, upcard);
			const dealerBustPercent =
				this.dealerBustProb(compUpcard, upcard, totCardsAfterUpcard) * 100;
			for (const total of totals) {
				// A made 21 (e.g. soft A,T) is always stood on -- hitting it is not a
				// real decision, so there is no optimal-play comparison to make.
				if (total >= 21) {
					const evStand = this.standEv(compUpcard, total, upcard, totCardsAfterUpcard);
					out.set(gridKey(total, upcard), {
						evPercent: evStand * 100,
						optimalAction: 'S',
						playerBustOnHitPercent: 0,
						dealerBustPercent,
					});
					continue;
				}

				const evStand = this.standEv(compUpcard, total, upcard, totCardsAfterUpcard);
				const evHit = this.hitEv(compUpcard, total, soft, upcard, totCardsAfterUpcard);
				const evDouble = this.doubleEv(
					compUpcard,
					total,
					soft,
					upcard,
					totCardsAfterUpcard
				);

				let optimalAction: PlayerAction = 'S';
				let best = evStand;
				if (evDouble > best) {
					best = evDouble;
					optimalAction = 'D';
				}
				if (evHit > best) {
					best = evHit;
					optimalAction = 'H';
				}
				const evSurrender = this.surrenderEv(compUpcard, upcard, totCardsAfterUpcard);
				if (evSurrender !== null && evSurrender > best) {
					best = evSurrender;
					optimalAction = 'R';
				}

				out.set(gridKey(total, upcard), {
					evPercent: best * 100,
					optimalAction,
					playerBustOnHitPercent:
						this.playerBustOnHitProb(compUpcard, total, soft, totCardsAfterUpcard) * 100,
					dealerBustPercent,
				});
			}
		}
		return out;
	}

	/**
	 * EV of splitting a pair: two hands at one unit each, each starting from a
	 * single card of `rank` plus a mandatory second card, then played
	 * optimally. Doubling is offered only when the table allows it after a
	 * split; split aces otherwise follow the common one-card-per-hand,
	 * must-stand rule.
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
	private splitEv(comp: Composition, rank: Rank, upcard: Rank, totCards: number): number {
		const isAce = rank === 'A';
		const startTotal = RANK_VALUE[rank];
		if (totCards < CARD_UNITS) {
			return 2 * this.standEv(comp, startTotal, upcard, totCards);
		}

		const draws: { p: number; playEv: number; pairsUp: boolean }[] = [];
		for (const drawRank of RANKS) {
			const n = comp[RANK_INDEX[drawRank]];
			if (n < CARD_UNITS) continue;
			const newComp = removeCard(comp, drawRank);
			const newTotCards = totCards - CARD_UNITS;
			const [newTotal, newSoft] = addValue(startTotal, isAce, drawRank);

			const evStand = this.standEv(newComp, newTotal, upcard, newTotCards);
			// A split ace takes exactly one card and must stand on it.
			const playEv =
				isAce ? evStand : (
					Math.max(
						evStand,
						this.hitEv(newComp, newTotal, newSoft, upcard, newTotCards),
						this.das ?
							this.doubleEv(newComp, newTotal, newSoft, upcard, newTotCards)
						:	-Infinity
					)
				);
			draws.push({ p: n / totCards, playEv, pairsUp: drawRank === rank });
		}

		const noResplit = draws.reduce((sum, draw) => sum + draw.p * draw.playEv, 0);
		const canResplit = !isAce || this.resplitAces;
		const byAllowance = new Map<number, number>();

		/** EV of one post-split hand that may occupy at most `hands` hand slots. */
		const handEv = (hands: number): number => {
			if (hands < 2 || !canResplit) return noResplit;
			const cached = byAllowance.get(hands);
			if (cached !== undefined) return cached;

			// Splitting again trades this one hand for two, which divide this
			// hand's own allowance between them.
			const evResplit = handEv(Math.ceil(hands / 2)) + handEv(Math.floor(hands / 2));
			const ev = draws.reduce(
				(sum, draw) =>
					sum + draw.p * (draw.pairsUp ? Math.max(draw.playEv, evResplit) : draw.playEv),
				0
			);
			byAllowance.set(hands, ev);
			return ev;
		};

		return (
			handEv(Math.ceil(this.splitLimit / 2)) + handEv(Math.floor(this.splitLimit / 2))
		);
	}

	/** Optimal action (incl. splitting) and EV/bust odds for each pair vs. upcard. */
	analyzeSplitGrid(
		comp0: Composition,
		pairRanks: readonly Rank[],
		upcards: readonly Rank[]
	): Map<string, SplitCellAnalysis> {
		const out = new Map<string, SplitCellAnalysis>();
		const totCardsAfterUpcard = comp0.reduce((sum, n) => sum + n, 0) - CARD_UNITS;
		for (const upcard of upcards) {
			const compUpcard = removeCard(comp0, upcard);
			const dealerBustPercent =
				this.dealerBustProb(compUpcard, upcard, totCardsAfterUpcard) * 100;
			for (const rank of pairRanks) {
				const [total, soft] = pairTotal(rank);
				const evStand = this.standEv(compUpcard, total, upcard, totCardsAfterUpcard);
				const evHit = this.hitEv(compUpcard, total, soft, upcard, totCardsAfterUpcard);
				const evDouble = this.doubleEv(
					compUpcard,
					total,
					soft,
					upcard,
					totCardsAfterUpcard
				);
				// A split limit of one hand is a table that doesn't split at all.
				const evSplit =
					this.splitLimit >= 2 ?
						this.splitEv(compUpcard, rank, upcard, totCardsAfterUpcard)
					:	-Infinity;

				let optimalAction: PlayerAction = 'S';
				let best = evStand;
				if (evDouble > best) {
					best = evDouble;
					optimalAction = 'D';
				}
				if (evHit > best) {
					best = evHit;
					optimalAction = 'H';
				}
				if (evSplit > best) {
					best = evSplit;
					optimalAction = 'P';
				}
				const evSurrender = this.surrenderEv(compUpcard, upcard, totCardsAfterUpcard);
				if (evSurrender !== null && evSurrender > best) {
					best = evSurrender;
					optimalAction = 'R';
				}

				out.set(splitGridKey(rank, upcard), {
					evPercent: best * 100,
					optimalAction,
					playerBustOnHitPercent:
						this.playerBustOnHitProb(compUpcard, total, soft, totCardsAfterUpcard) * 100,
					dealerBustPercent,
				});
			}
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
 * Deltas are computed in half-card units and rounded to integers with
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

/**
 * Builds one hard/soft-totals comparison table from a pair of engines the
 * caller already has (one warmed on `base`, one on `modified`). Sharing
 * engines across tables lets their memo caches carry over instead of
 * recomputing identical dealer/player recursion states from scratch --
 * see `computeAllEvTables`.
 */
function buildEvComparison(
	baseEngine: ShoeEv,
	countEngine: ShoeEv,
	base: Composition,
	modified: Composition,
	totals: readonly number[],
	upcards: readonly Rank[],
	soft: boolean
): EvComparisonResult {
	const baseAnalysisGrid = baseEngine.analyzeGrid(base, totals, upcards, soft);
	const analysisGrid = countEngine.analyzeGrid(modified, totals, upcards, soft);

	const rows: EvComparisonRow[] = [];
	for (const upcard of upcards) {
		for (const total of totals) {
			const key = gridKey(total, upcard);
			const baseEvPercent = baseAnalysisGrid.get(key)!.evPercent;
			const analysis = analysisGrid.get(key)!;
			const countEvPercent = analysis.evPercent;
			rows.push({
				total,
				upcard,
				baseEvPercent,
				countEvPercent,
				deltaPercentPoints: countEvPercent - baseEvPercent,
				optimalAction: analysis.optimalAction,
				playerBustOnHitPercent: analysis.playerBustOnHitPercent,
				dealerBustPercent: analysis.dealerBustPercent,
			});
		}
	}

	return { totals, upcards, rows };
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
	const modified = applyCountToComposition(base, tags, Math.round(count));
	return buildEvComparison(
		new ShoeEv(ruleSet),
		new ShoeEv(ruleSet),
		base,
		modified,
		totals,
		upcards,
		soft
	);
}

/**
 * Each row's EV here is the fully optimal action's EV -- stand, hit,
 * double, or split -- same as `computeEvComparison`'s hard/soft tables.
 * `optimalAction` is drawn from the same comparison, so the displayed EV
 * always matches the recommended action.
 */
/** Same sharing idea as `buildEvComparison`, for the splits table. */
function buildSplitEvComparison(
	baseEngine: ShoeEv,
	countEngine: ShoeEv,
	base: Composition,
	modified: Composition,
	pairRanks: readonly Rank[],
	upcards: readonly Rank[]
): SplitEvComparisonResult {
	const baseAnalysis = baseEngine.analyzeSplitGrid(base, pairRanks, upcards);
	const countAnalysis = countEngine.analyzeSplitGrid(modified, pairRanks, upcards);

	const rows: SplitEvComparisonRow[] = [];
	for (const upcard of upcards) {
		for (const rank of pairRanks) {
			const key = splitGridKey(rank, upcard);
			const baseCell = baseAnalysis.get(key)!;
			const countCell = countAnalysis.get(key)!;
			rows.push({
				pairRank: rank,
				upcard,
				baseEvPercent: baseCell.evPercent,
				countEvPercent: countCell.evPercent,
				deltaPercentPoints: countCell.evPercent - baseCell.evPercent,
				optimalAction: countCell.optimalAction,
				playerBustOnHitPercent: countCell.playerBustOnHitPercent,
				dealerBustPercent: countCell.dealerBustPercent,
			});
		}
	}

	return { pairRanks, upcards, rows };
}

export function computeSplitEvComparison(
	ruleSet: RuleSet,
	count: number,
	tags: TagValues = ACE_FIVE_TAGS,
	pairRanks: readonly Rank[] = PAIR_RANKS,
	upcards: readonly Rank[] = RANKS
): SplitEvComparisonResult {
	const base = baseComposition(ruleSet);
	const modified = applyCountToComposition(base, tags, Math.round(count));
	return buildSplitEvComparison(
		new ShoeEv(ruleSet),
		new ShoeEv(ruleSet),
		base,
		modified,
		pairRanks,
		upcards
	);
}

/**
 * Computes all three tables (hard totals, soft totals, splits) sharing one
 * engine for `base` and one for `modified` across all of them. Dealer
 * outcome distributions -- and, for split, the hit/stand/double sub-EVs --
 * depend only on shoe composition and hand-in-progress state, not on which
 * table triggered the computation, so the memo caches populated by the
 * first table are reused by the other two instead of being rebuilt from
 * scratch. This is the entry point `EvTable` should use; the single-table
 * `computeEvComparison`/`computeSplitEvComparison` functions above remain
 * for standalone/test use and always compute with fresh, unshared engines.
 */
export function computeAllEvTables(
	ruleSet: RuleSet,
	count: number,
	tags: TagValues = ACE_FIVE_TAGS
): {
	hard: EvComparisonResult;
	soft: EvComparisonResult;
	split: SplitEvComparisonResult;
} {
	const base = baseComposition(ruleSet);
	const modified = applyCountToComposition(base, tags, Math.round(count));
	const baseEngine = new ShoeEv(ruleSet);
	const countEngine = new ShoeEv(ruleSet);

	const hard = buildEvComparison(
		baseEngine,
		countEngine,
		base,
		modified,
		HARD_TOTALS,
		RANKS,
		false
	);
	const soft = buildEvComparison(
		baseEngine,
		countEngine,
		base,
		modified,
		SOFT_TOTALS,
		RANKS,
		true
	);
	const split = buildSplitEvComparison(
		baseEngine,
		countEngine,
		base,
		modified,
		PAIR_RANKS,
		RANKS
	);

	return { hard, soft, split };
}
