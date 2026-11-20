// Types the simulation adds on top of the frozen contract in src/world.
// Every Sim* state type is the contract type plus extra fields, so a SimCityState is a CityState.
import type { CityState, LevelId, LevelState, PipeNodeId } from '../world';
import type { PowerEvent, WaterResult } from '../world';

// ---------------------------------------------------------------- options

export interface SimOptions {
  seed: number;
  /** How many levels. Level 1 is the top, the last is the deepest. Default 12. */
  levels?: number;
  /** Zones per level. Each zone has one plugged-in device cluster and one tap. Default 4. */
  zonesPerLevel?: number;
  /** Simulated clock at the start, seconds. Default 6 * 3600 (06:00 on day 0). */
  startTime?: number;
  /** Random feeder faults, recycler wear-outs and the like. Default true. Turn off for a scripted demo. */
  hazards?: boolean;
}

// ---------------------------------------------------------------- failures

/** The things the UI (or a scenario script) can make go wrong. */
export type FailureSpec =
  /** A level's feeder degrades over `rampHours`, then the level goes dark. Default: the deepest level, 4 hours. */
  | { kind: 'level-power-loss'; level?: LevelId; rampHours?: number }
  /** The Directorate's generators lose `fraction` (0..1) of their output. Deep levels are cut first. */
  | { kind: 'generation-drop'; fraction: number }
  /** The Directorate shuts the network down. */
  | { kind: 'network-down' }
  /** A recycler breaks and starts sending bad water down its line. Give a recycler node or the level it sits on. */
  | { kind: 'recycler-failure'; recycler?: PipeNodeId; level?: LevelId }
  /** Seed `cases` new lung-sickness cases on a level. */
  | { kind: 'outbreak'; level: LevelId; cases: number }
  /** Food deliveries fall by `fraction` (0..1). */
  | { kind: 'food-shortage'; fraction: number };

export type FailureKind = FailureSpec['kind'];

export interface ActiveFailure {
  id: number;
  spec: FailureSpec;
  /** Sim time it started, seconds. */
  since: number;
  /** True if the hazard model caused it rather than a trigger. */
  natural: boolean;
  /** Sim time a natural failure is fixed by crews, seconds. Triggered failures last until resolved. */
  until?: number;
}

// ---------------------------------------------------------------- pipe map

export type PipeNodeKind = 'recycler' | 'junction' | 'tap';
export interface PipeNode {
  id: PipeNodeId;
  kind: PipeNodeKind;
  level: LevelId;
  /** Only taps have a zone. */
  zone?: number;
}
/** Water flows from `from` to `to`. */
export interface PipeEdge {
  from: PipeNodeId;
  to: PipeNodeId;
}
export interface PipeMap {
  nodes: PipeNode[];
  edges: PipeEdge[];
}

// ---------------------------------------------------------------- state

export interface RecyclerState {
  id: PipeNodeId;
  level: LevelId;
  /** Levels this recycler feeds. */
  feeds: LevelId[];
  /** 0 (broken) to 1 (new). Below CONTAMINATION_HEALTH the water it sends is bad. */
  health: number;
  contaminated: boolean;
  /** Sim time the water first went bad in this episode, seconds. */
  contaminatedSince?: number;
}

export interface ZoneState {
  zone: number;
  /** One tap per zone. */
  tap: PipeNodeId;
  power: 'on' | 'flicker' | 'out';
  /** Flickers this zone saw in the last hour. */
  flickersLastHour: number;
  /** Sim time this zone lost power, seconds, while it is out. */
  outSince?: number;
}

export interface SimLevelState extends LevelState {
  zones: ZoneState[];
  /** Share of this level's demand the Directorate actually delivered this hour, 0..1. */
  supplyRatio: number;
  /** Feeder health, 1 normal, 0 cut. */
  feeder: number;
  /** The recycler whose line this level drinks from. */
  recycler: PipeNodeId;
  /** Hours of power delivered since the run started. */
  powerHoursTotal: number;
  /** Lung sickness cases ever on this level (actual), and recoveries. */
  sickEver: number;
  recovered: number;
}

export interface SimCityState extends CityState {
  levels: SimLevelState[];
  /** Whole hours since the run started. */
  hour: number;
  /** Hour of the day, 0..23. */
  hourOfDay: number;
  grid: {
    /** Generator output this hour, in kW. */
    capacity: number;
    /** What the whole Hollow asked for this hour, in kW. */
    demand: number;
  };
  recyclers: RecyclerState[];
  failures: ActiveFailure[];
}

// ---------------------------------------------------------------- observations

/**
 * Raw things residents and devices notice, before anyone signs them. Other modules turn these into
 * signed notes (power -> canary, water -> ledger pipe tracing, sick -> ledger outbreak estimate).
 * `resident` is an index into the Hollow's population (see residentIdentity).
 */
export type SimObservation =
  | { type: 'power'; time: number; level: LevelId; zone: number; event: PowerEvent; durationS: number }
  | { type: 'water'; time: number; level: LevelId; tap: PipeNodeId; result: WaterResult; resident: number }
  | { type: 'sick'; time: number; level: LevelId; source: 'self' | 'clinic'; resident: number };

/** A thing that happened in the city, for a timeline or captions. */
export interface SimEvent {
  time: number;
  level?: LevelId;
  what:
    | 'level-out'
    | 'level-restored'
    | 'water-bad'
    | 'water-clean'
    | 'network-down'
    | 'network-up'
    | 'failure-start'
    | 'failure-end';
  detail?: string;
}
