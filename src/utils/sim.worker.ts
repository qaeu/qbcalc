/**
 * Runs a simulated session off the main thread. A run is minutes long at the top
 * of the range the form offers, so it gets a worker of its own rather than a
 * place in the EV worker's queue -- see `simWorkerProtocol.ts` for the messages
 * and the chunked loop behind them.
 */

import { handleSimWorkerMessage, type SimWorkerMessage } from './simWorkerProtocol';

self.onmessage = (event: MessageEvent<SimWorkerMessage>) => {
	handleSimWorkerMessage(event.data, (response) => self.postMessage(response));
};
