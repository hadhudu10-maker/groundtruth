// Turns the simulation's raw power observations into what the canary reads: a PowerBody (the
// contract's power note body) plus the time it was seen. In the real app the body comes out of a
// verified signed note and the time is the note's `time`; here the sim hands us the same fields.
import type { PowerBody } from '../world';
import type { SimObservation } from '../sim';

/** A power note as the canary sees it. `time` is seconds on the simulated clock, same as a note's `time`. */
export interface PowerReading {
  time: number;
  body: PowerBody;
}

type PowerObservation = Extract<SimObservation, { type: 'power' }>;

export function isPowerObservation(o: SimObservation): o is PowerObservation {
  return o.type === 'power';
}

/** One to one: `SimObservation` of type 'power' carries exactly the fields of `PowerBody`. */
export function readingFromObservation(o: PowerObservation): PowerReading {
  return { time: o.time, body: { kind: 'power', level: o.level, zone: o.zone, event: o.event, durationS: o.durationS } };
}

/** Every power observation in a list, in the order given. Other observation types are skipped. */
export function powerReadings(observations: readonly SimObservation[]): PowerReading[] {
  const out: PowerReading[] = [];
  for (const o of observations) if (isPowerObservation(o)) out.push(readingFromObservation(o));
  return out;
}
