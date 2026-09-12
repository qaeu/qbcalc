import { HI_LO_TAGS } from '#utils/settings/countingSystems';
import { DEFAULT_RULE_SET, type RuleSet } from '#utils/ev/rules';
import { computeEvWorkerResponse, type TrainGrids } from '#utils/evWorkerProtocol';

/**
 * Two decks, late surrender and a peek: the same maths as six, a fraction of the
 * enumeration, and every kind of play a drill can ask about.
 */
export const RULE_SET: RuleSet = {
	...DEFAULT_RULE_SET,
	decks: 2,
	surrender: 'late',
	dealerPeek: true,
};

export const TAGS = HI_LO_TAGS;

/** The grids a drill would be handed, at `counts`, off the worker's own handler. */
export function trainGrids(counts: readonly number[], ruleSet = RULE_SET): TrainGrids {
	const response = computeEvWorkerResponse({
		requestId: 1,
		scope: 'train',
		ruleSet,
		trueCount: 0,
		trueCounts: counts,
		tags: TAGS,
	});
	if (response.status !== 'success' || response.scope !== 'train') {
		throw new Error('expected a train-scope result');
	}
	return response.result;
}
