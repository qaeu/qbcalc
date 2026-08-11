/**
 * Runs the exact-enumeration EV computation off the main thread so the page
 * stays interactive (and the calling table can show a loading state) while
 * a calculation is in flight. See `evWorkerProtocol.ts` for the message
 * shapes shared with `EvTable`.
 */

import { computeEvWorkerResponse, type EvWorkerRequest } from './evWorkerProtocol';

self.onmessage = (event: MessageEvent<EvWorkerRequest>) => {
	self.postMessage(computeEvWorkerResponse(event.data));
};
