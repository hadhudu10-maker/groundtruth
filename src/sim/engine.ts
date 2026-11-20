// The Hollow: a seeded, hour-by-hour simulation of power, air, water, food and lung sickness
// across the levels. Level 1 is the top. Deeper levels are more crowded, have worse air, older
// recyclers and worse clinic access, and the Directorate cuts their power first when it runs short.
//
// Cascades: power out -> scrubbers stop (air falls) and recyclers slow and wear faster ->
// bad air and bad water raise sickness -> sick crews let recyclers wear faster still.
//
// Determinism: all randomness comes from pure-rand streams seeded by `seed` (see rng.ts).
// The same seed plus the same sequence of step/trigger/resolve calls gives the same run.
import type { LevelId, PipeNodeId, ProofValues, Resource } from '../world';
import { makeStreams } from './rng';
import { buildPipeMap, recyclerLayout, recyclerNode, sourceLevelOf, tapNode } from './pipes';
import type {
  ActiveFailure,
  FailureSpec,
  PipeMap,
  RecyclerState,
  SimCityState,
  SimEvent,
  SimLevelState,
  SimObservation,
  SimOptions,
  ZoneState,
} from './types';

// ---------------------------------------------------------------- tuning

export const HOUR = 3600;
const DAY_HOURS = 24;

/** Supply ratio at or above this is full power. */
export const POWER_ON_RATIO = 0.97;
/** Below this the breaker trips and the level is dark. Between the two it flickers. */
export const POWER_OUT_RATIO = 0.6;
/** Average draw per resident, kW. */
const KW_PER_PERSON = 1;
/** Generators are sized just under the evening peak, so evenings are short and the deep levels pay. */
const CAPACITY_OF_PEAK = 0.985;
const PEAK_FACTOR = 1.08;

/** Recycler health below this sends bad water. Below SUSPECT_HEALTH the water is suspect. */
export const CONTAMINATION_HEALTH = 0.35;
export const SUSPECT_HEALTH = 0.5;
const WATER_LITRES_NOMINAL = 55;
const FOOD_KCAL_AVERAGE = 2100;

/** Lung sickness: mean illness length one week. */
const RECOVERY_PER_HOUR = 1 / (24 * 7);
const SELF_REPORT_P = 0.45;
/** Share of clinic-confirmed cases the Directorate admits to. */
const DIRECTORATE_ADMITS = 0.7;

const dayFactor = (hourOfDay: number) => 0.92 + 0.16 * Math.cos((2 * Math.PI * (hourOfDay - 19)) / 24);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round1 = (x: number) => Math.round(x * 10) / 10;

// ---------------------------------------------------------------- internal state

const S_SUSCEPTIBLE = 0;
const S_SICK = 1;
const S_RECOVERED = 2;
const F_SELF = 1;
const F_CLINIC = 2;

interface Zone {
  power: ZoneState['power'];
  flickers: number;
  outSince?: number;
  /** How jumpy this zone's wiring is. */
  sensitivity: number;
}

interface Level {
  id: LevelId;
  depth: number; // 0 top .. 1 deepest
  population: number;
  firstResident: number;
  zones: Zone[];
  power: ZoneState['power'];
  supplyRatio: number;
  feeder: number;
  air: number;
  powerWindow: number[]; // hours delivered, last 24 hours
  waterWindow: number[]; // litres per person per day, last 24 hours
  food: number;
  powerHoursTotal: number;
  water: SimLevelState['water'];
  // sickness, indexed by local resident number
  status: Uint8Array;
  reported: Uint8Array;
  active: number[];
  recoveredCount: number;
  sickEver: number;
  official: number;
}

interface Recycler {
  id: PipeNodeId;
  level: LevelId;
  feeds: LevelId[];
  health: number;
  contaminatedSince?: number;
}

interface PendingReport {
  hour: number;
  level: LevelId;
  local: number;
  source: 'self' | 'clinic';
}

// ---------------------------------------------------------------- public API

export interface Sim {
  readonly seed: number;
  readonly levelCount: number;
  readonly zonesPerLevel: number;
  readonly pipeMap: PipeMap;
  /** Total residents. Resident indices run 0..population-1, top level first. */
  readonly population: number;
  /** The current state. The same object until the next step, trigger or resolve, so it is safe for React. */
  getState(): SimCityState;
  /** Called after every change. Returns an unsubscribe function. Fits React's useSyncExternalStore. */
  subscribe(listener: () => void): () => void;
  /** Advance `hours` whole hours (default 1). Returns the observations made during those hours. */
  step(hours?: number): SimObservation[];
  /** Make something go wrong. Returns the failure ID to pass to `resolve`. */
  trigger(spec: FailureSpec): number;
  /** Fix a failure: restore the feeder, the generators, the network, the recycler or the food. */
  resolve(id: number): void;
  /** Every observation so far, or those at or after `since` (seconds). */
  observations(since?: number): readonly SimObservation[];
  /** City events so far (blackouts, bad water, network), for timelines and captions. */
  events(): readonly SimEvent[];
  /** The two incomplete sick lists for problem 9: active cases that self-reported, and that a clinic tallied. */
  sickLists(level?: LevelId): { self: number[]; clinic: number[] };
  /** Which level a resident lives on. */
  levelOfResident(resident: number): LevelId;
  /** Proof numbers this run can already measure. Missing keys are not measured yet. */
  proof(): ProofValues;
}

export function createSim(options: SimOptions): Sim {
  const seed = options.seed | 0;
  const levelCount = options.levels ?? 12;
  const zonesPerLevel = options.zonesPerLevel ?? 4;
  const hazards = options.hazards ?? true;
  if (!Number.isInteger(levelCount) || levelCount < 2 || levelCount > 255) throw new Error('levels must be 2..255');
  if (!Number.isInteger(zonesPerLevel) || zonesPerLevel < 1 || zonesPerLevel > 49) throw new Error('zonesPerLevel must be 1..49');

  const rng = makeStreams(seed);
  let time = options.startTime ?? 6 * HOUR;
  let hour = 0;

  // ---- failures
  const failures = new Map<number, ActiveFailure>();
  let nextFailureId = 1;

  // ---- outputs
  const log: SimObservation[] = [];
  const cityEvents: SimEvent[] = [];
  const pending: PendingReport[] = [];
  const listeners = new Set<() => void>();
  let snapshot: SimCityState;

  // ---- build the city
  const levels: Level[] = [];
  let firstResident = 0;
  for (let id = 1; id <= levelCount; id++) {
    const depth = (id - 1) / (levelCount - 1);
    // Deeper is more crowded. The step (70) beats the noise (+-25), so demand always grows with depth.
    const population = 900 + 70 * (id - 1) + rng.setup.int(-25, 25);
    const zones: Zone[] = [];
    for (let z = 0; z < zonesPerLevel; z++) zones.push({ power: 'on', flickers: 0, sensitivity: rng.setup.range(0.7, 1.3) });
    levels.push({
      id,
      depth,
      population,
      firstResident,
      zones,
      power: 'on',
      supplyRatio: 1,
      feeder: 1,
      air: airBase(depth),
      powerWindow: [],
      waterWindow: [],
      food: 0,
      powerHoursTotal: 0,
      water: 'ok',
      status: new Uint8Array(population),
      reported: new Uint8Array(population),
      active: [],
      recoveredCount: 0,
      sickEver: 0,
      official: 0,
    });
    firstResident += population;
  }
  const population = firstResident;
  const baseDemand = levels.reduce((s, l) => s + l.population * KW_PER_PERSON, 0);
  const baseCapacity = CAPACITY_OF_PEAK * PEAK_FACTOR * baseDemand;
  let genWalk = 1;

  const recyclers: Recycler[] = recyclerLayout(levelCount).map(({ level, feeds }) => {
    const depth = (level - 1) / (levelCount - 1);
    return { id: recyclerNode(level), level, feeds, health: rng.setup.range(0.9 - 0.2 * depth, 1) };
  });
  const recyclerById = new Map(recyclers.map((r) => [r.id, r]));
  const recyclerOfLevel = (id: LevelId) => recyclerById.get(recyclerNode(sourceLevelOf(id)))!;
  const pipeMap = buildPipeMap(levelCount, zonesPerLevel);

  // Lung sickness is already in the lower half when the run starts.
  for (const l of levels) {
    if (l.depth <= 0.5) continue;
    const n = Math.round(2 + 10 * l.depth);
    for (let i = 0; i < n; i++) infect(l, pickSusceptible(l));
  }


  // ---------------------------------------------------------------- helpers

  function airBase(depth: number) {
    return 0.96 - 0.26 * depth;
  }

  function levelById(id: LevelId): Level {
    const l = levels[id - 1];
    if (!l) throw new Error(`no level ${id}`);
    return l;
  }

  function pickSusceptible(l: Level): number {
    for (let tries = 0; tries < 40; tries++) {
      const i = rng.sick.int(0, l.population - 1);
      if (l.status[i] === S_SUSCEPTIBLE) return i;
    }
    const start = rng.sick.int(0, l.population - 1);
    for (let k = 0; k < l.population; k++) {
      const i = (start + k) % l.population;
      if (l.status[i] === S_SUSCEPTIBLE) return i;
    }
    return -1;
  }

  function infect(l: Level, local: number) {
    if (local < 0) return;
    l.status[local] = S_SICK;
    l.active.push(local);
    l.sickEver++;
    // Who will tell anyone. Two independent chances, so the two lists overlap by chance alone.
    if (rng.sick.chance(SELF_REPORT_P)) pending.push({ hour: hour + rng.sick.int(4, 30), level: l.id, local, source: 'self' });
    const clinicP = 0.7 - 0.35 * l.depth;
    if (rng.sick.chance(clinicP)) pending.push({ hour: hour + rng.sick.int(12, 60), level: l.id, local, source: 'clinic' });
  }

  function feederOf(l: Level): number {
    let f = 1;
    for (const fail of failures.values()) {
      if (fail.spec.kind !== 'level-power-loss') continue;
      if ((fail.spec.level ?? levelCount) !== l.id) continue;
      const ramp = Math.max(0, fail.spec.rampHours ?? 4);
      const elapsedH = (time - fail.since) / HOUR;
      f = Math.min(f, ramp === 0 ? 0 : clamp(1 - elapsedH / ramp, 0, 1));
    }
    return f;
  }

  function multiplier(kind: 'generation-drop' | 'food-shortage'): number {
    let m = 1;
    for (const fail of failures.values()) {
      if (fail.spec.kind === kind) m *= 1 - clamp(fail.spec.fraction, 0, 1);
    }
    return m;
  }

  function networkDown(): boolean {
    for (const f of failures.values()) if (f.spec.kind === 'network-down') return true;
    return false;
  }

  function brokenRecyclers(): Set<PipeNodeId> {
    const out = new Set<PipeNodeId>();
    for (const f of failures.values()) {
      if (f.spec.kind === 'recycler-failure') out.add(resolveRecycler(f.spec).id);
    }
    return out;
  }

  function resolveRecycler(spec: Extract<FailureSpec, { kind: 'recycler-failure' }>): Recycler {
    if (spec.recycler !== undefined) {
      const r = recyclerById.get(spec.recycler);
      if (!r) throw new Error(`no recycler ${spec.recycler}`);
      return r;
    }
    return recyclerOfLevel(spec.level ?? levelCount);
  }

  function pushWindow(w: number[], v: number) {
    w.push(v);
    if (w.length > DAY_HOURS) w.shift();
  }

  /** Observations made during the hour being simulated. Sorted by time, then appended to the log. */
  let hourLog: SimObservation[] = [];
  function emit(o: SimObservation) {
    hourLog.push(o);
  }

  // ---------------------------------------------------------------- one hour

  function simulateHour() {
    const hourOfDay = Math.floor(time / HOUR) % DAY_HOURS;
    hourLog = [];

    // 1. Crews fix natural failures; the hazard model may start new ones.
    for (const f of [...failures.values()]) {
      if (f.natural && f.until !== undefined && f.until <= time) endFailure(f);
    }
    if (hazards) rollHazards();

    // 2. Power. The Directorate serves levels top first; what is left trickles down.
    genWalk = clamp(1 + 0.95 * (genWalk - 1) + 0.006 * rng.power.normal(), 0.85, 1.08);
    const df = dayFactor(hourOfDay);
    const capacity = baseCapacity * genWalk * multiplier('generation-drop');
    let remaining = capacity;
    let totalDemand = 0;
    for (const l of levels) {
      const demand = l.population * KW_PER_PERSON * df;
      totalDemand += demand;
      l.feeder = feederOf(l);
      let give = Math.min(demand * l.feeder, remaining);
      let ratio = give / demand;
      if (ratio < POWER_OUT_RATIO) {
        // The breaker trips. What this level could not use flows on down.
        give = 0;
        ratio = Math.max(0, ratio);
      }
      remaining -= give;
      l.supplyRatio = ratio;
      const status: Level['power'] = ratio >= POWER_ON_RATIO ? 'on' : ratio >= POWER_OUT_RATIO ? 'flicker' : 'out';
      if (status === 'out' && l.power !== 'out') cityEvents.push({ time, level: l.id, what: 'level-out' });
      if (status !== 'out' && l.power === 'out') cityEvents.push({ time, level: l.id, what: 'level-restored' });
      l.power = status;
      const delivered = status === 'out' ? 0 : ratio;
      pushWindow(l.powerWindow, delivered);
      l.powerHoursTotal += delivered;
      powerNotes(l, status, ratio);
    }

    // 3. Air. Scrubbers need power.
    for (const l of levels) {
      const powerShare = l.power === 'out' ? 0 : l.power === 'flicker' ? l.supplyRatio : 1;
      const target = airBase(l.depth) * (0.25 + 0.75 * powerShare);
      l.air = clamp(l.air + (target - l.air) * 0.12, 0, 1);
    }

    // 4. Water. Recyclers wear (faster without power, faster with sick crews) and feed their line.
    const broken = brokenRecyclers();
    for (const r of recyclers) {
      const home = levelById(r.level);
      const depth = home.depth;
      const sickShare = home.active.length / home.population;
      const unpowered = home.power === 'out' ? 6 : home.power === 'flicker' ? 2 : 1;
      const wear = (0.0002 + 0.0012 * depth * depth) * (1 + 3 * sickShare) * unpowered;
      r.health = clamp(r.health - wear * rng.water.range(0.5, 1.5), 0, 1);
      if (broken.has(r.id)) r.health = Math.min(r.health, 0.1);
      const bad = r.health < CONTAMINATION_HEALTH;
      if (bad && r.contaminatedSince === undefined) r.contaminatedSince = time;
      if (!bad) r.contaminatedSince = undefined;
    }
    for (const l of levels) {
      const r = recyclerOfLevel(l.id);
      const home = levelById(r.level);
      // The recycler's own pumps run on its level's power; each level's booster pumps run on its own.
      const pump = home.power === 'out' ? 0.15 : home.power === 'flicker' ? home.supplyRatio : 1;
      const booster = l.power === 'out' ? 0.4 : 1;
      pushWindow(l.waterWindow, WATER_LITRES_NOMINAL * clamp(r.health / SUSPECT_HEALTH, 0.2, 1) * pump * booster);
      const water: Level['water'] = r.health < CONTAMINATION_HEALTH ? 'bad' : r.health < SUSPECT_HEALTH ? 'suspect' : 'ok';
      if (water === 'bad' && l.water !== 'bad') cityEvents.push({ time, level: l.id, what: 'water-bad', detail: `recycler ${r.id}` });
      if (water !== 'bad' && l.water === 'bad') cityEvents.push({ time, level: l.id, what: 'water-clean' });
      l.water = water;
      waterTests(l);
    }

    // 5. Food. The Directorate weights rations toward the upper levels.
    const foodSupply = FOOD_KCAL_AVERAGE * population * multiplier('food-shortage');
    const weightSum = levels.reduce((s, l) => s + l.population * (1 - 0.35 * l.depth), 0);
    for (const l of levels) l.food = Math.round((foodSupply * (1 - 0.35 * l.depth)) / weightSum);

    // 6. Lung sickness. Bad air spreads it, bad water adds cases, neighbours share a little.
    const sickNow = levels.map((l) => l.active.length);
    for (const l of levels) {
      const above = sickNow[l.id - 2] ?? 0;
      const below = sickNow[l.id] ?? 0;
      const infectious = l.active.length + 0.05 * (above + below);
      const beta = RECOVERY_PER_HOUR * (0.6 + 1.8 * (1 - l.air));
      const waterHit = l.water === 'bad' ? 0.0008 : l.water === 'suspect' ? 0.0001 : 0;
      const force = (beta * infectious) / l.population + waterHit + 0.00001;
      const susceptible = l.population - l.active.length - l.recoveredCount;
      const newCases = rng.sick.binomial(susceptible, 1 - Math.exp(-force));
      const recoveries = rng.sick.binomial(l.active.length, RECOVERY_PER_HOUR);
      for (let k = 0; k < recoveries && l.active.length > 0; k++) {
        const j = rng.sick.int(0, l.active.length - 1);
        const local = l.active[j]!;
        l.active[j] = l.active[l.active.length - 1]!;
        l.active.pop();
        l.status[local] = S_RECOVERED;
        l.reported[local] = 0;
        l.recoveredCount++;
      }
      for (let k = 0; k < newCases; k++) infect(l, pickSusceptible(l));
    }

    // 7. Reports come in (self reports by pass-it-on, clinic tallies), for cases still sick.
    for (let i = pending.length - 1; i >= 0; i--) {
      const p = pending[i]!;
      if (p.hour > hour) continue;
      pending.splice(i, 1);
      const l = levelById(p.level);
      if (l.status[p.local] !== S_SICK) continue;
      l.reported[p.local] |= p.source === 'self' ? F_SELF : F_CLINIC;
      emit({
        type: 'sick',
        time: time + rng.sick.int(0, HOUR - 1),
        level: l.id,
        source: p.source,
        resident: l.firstResident + p.local,
      });
    }

    // 8. The Directorate publishes once a day at 06:00, and not at all while the network is down.
    if (hourOfDay === 6 && !networkDown()) {
      for (const l of levels) {
        let clinicKnown = 0;
        for (const local of l.active) if (l.reported[local]! & F_CLINIC) clinicKnown++;
        l.official = Math.floor(clinicKnown * DIRECTORATE_ADMITS);
      }
    }

    // Flickers and reports land mid-hour; keep the log in time order. The sort is stable.
    hourLog.sort((a, b) => a.time - b.time);
    for (const o of hourLog) log.push(o);
  }

  function powerNotes(l: Level, status: Level['power'], ratio: number) {
    for (let z = 0; z < l.zones.length; z++) {
      const zone = l.zones[z]!;
      if (status === 'out') {
        if (zone.power !== 'out') {
          zone.outSince = time;
          emit({ type: 'power', time, level: l.id, zone: z, event: 'out', durationS: 0 });
        }
        // Then silence: a dark zone sends no heartbeat. That silence is a signal too.
        zone.power = 'out';
        zone.flickers = 0;
        continue;
      }
      if (zone.power === 'out') {
        const gone = time - (zone.outSince ?? time);
        emit({ type: 'power', time, level: l.id, zone: z, event: 'restored', durationS: Math.min(0xffff, gone) });
        zone.outSince = undefined;
      }
      emit({ type: 'power', time, level: l.id, zone: z, event: 'ok', durationS: 0 });
      // Flickers rise as the supply ratio falls: the early warning the canary module listens for.
      const strain = 1 - ratio;
      const mean = zone.sensitivity * (status === 'on' ? 0.02 + 20 * strain : 1 + 12 * strain);
      const n = rng.power.poisson(mean);
      for (let k = 0; k < n; k++) {
        const maxS = status === 'flicker' ? 120 : 20;
        emit({ type: 'power', time: time + rng.power.int(1, HOUR - 1), level: l.id, zone: z, event: 'flicker', durationS: rng.power.int(1, maxS) });
      }
      zone.flickers = n;
      zone.power = status;
    }
  }

  function waterTests(l: Level) {
    const p = 0.08 + (l.water === 'bad' ? 0.25 : l.water === 'suspect' ? 0.08 : 0);
    for (let z = 0; z < zonesPerLevel; z++) {
      if (!rng.water.chance(p)) continue;
      const u = rng.water.float();
      // Strip tests are imperfect: some false alarms, some misses.
      const result =
        l.water === 'bad'
          ? u < 0.85 ? 'bad' : u < 0.95 ? 'unsure' : 'ok'
          : l.water === 'suspect'
            ? u < 0.3 ? 'bad' : u < 0.6 ? 'unsure' : 'ok'
            : u < 0.03 ? 'bad' : u < 0.08 ? 'unsure' : 'ok';
      emit({
        type: 'water',
        time: time + rng.water.int(0, HOUR - 1),
        level: l.id,
        tap: tapNode(l.id, z),
        result,
        resident: l.firstResident + rng.water.int(0, l.population - 1),
      });
    }
  }

  function rollHazards() {
    for (const l of levels) {
      // Old feeders in the deep levels fail on their own, slowly at first (flickers), then fully.
      if (rng.hazard.chance(0.005 * l.depth ** 3)) {
        const already = [...failures.values()].some((f) => f.spec.kind === 'level-power-loss' && f.spec.level === l.id);
        if (!already) {
          const rampHours = rng.hazard.int(3, 10);
          startFailure({ kind: 'level-power-loss', level: l.id, rampHours }, true, rampHours + rng.hazard.int(6, 36));
        }
      }
    }
    for (const r of recyclers) {
      const depth = levelById(r.level).depth;
      if (rng.hazard.chance(0.001 * depth * depth)) {
        const already = [...failures.values()].some((f) => f.spec.kind === 'recycler-failure' && resolveRecycler(f.spec).id === r.id);
        if (!already) startFailure({ kind: 'recycler-failure', recycler: r.id }, true, rng.hazard.int(24, 72));
      }
    }
  }

  function startFailure(spec: FailureSpec, natural: boolean, lastsHours?: number): number {
    const id = nextFailureId++;
    if (spec.kind === 'outbreak') {
      const l = levelById(spec.level);
      for (let i = 0; i < Math.max(0, Math.floor(spec.cases)); i++) infect(l, pickSusceptible(l));
      cityEvents.push({ time, level: l.id, what: 'failure-start', detail: `outbreak +${spec.cases}` });
      return id; // instant: nothing to resolve
    }
    if (spec.kind === 'level-power-loss') levelById(spec.level ?? levelCount);
    if (spec.kind === 'recycler-failure') resolveRecycler(spec);
    const wasDown = networkDown();
    const f: ActiveFailure = { id, spec, since: time, natural };
    if (natural && lastsHours !== undefined) f.until = time + lastsHours * HOUR;
    failures.set(id, f);
    cityEvents.push({ time, level: levelOf(spec), what: 'failure-start', detail: spec.kind + (natural ? ' (natural)' : '') });
    if (!wasDown && networkDown()) cityEvents.push({ time, what: 'network-down' });
    return id;
  }

  function endFailure(f: ActiveFailure) {
    const wasDown = networkDown();
    failures.delete(f.id);
    if (f.spec.kind === 'recycler-failure') {
      const r = resolveRecycler(f.spec);
      r.health = 1; // crews fit new filters
      r.contaminatedSince = undefined;
    }
    cityEvents.push({ time, level: levelOf(f.spec), what: 'failure-end', detail: f.spec.kind });
    if (wasDown && !networkDown()) cityEvents.push({ time, what: 'network-up' });
  }

  function levelOf(spec: FailureSpec): LevelId | undefined {
    if (spec.kind === 'level-power-loss') return spec.level ?? levelCount;
    if (spec.kind === 'recycler-failure') return resolveRecycler(spec).level;
    if (spec.kind === 'outbreak') return spec.level;
    return undefined;
  }

  // ---------------------------------------------------------------- snapshots

  function buildSnapshot(): SimCityState {
    const out: SimLevelState[] = levels.map((l) => {
      const r = recyclerOfLevel(l.id);
      const received: Record<Resource, number> = {
        power: round1(sum(l.powerWindow) * (DAY_HOURS / l.powerWindow.length)),
        water: round1(sum(l.waterWindow) / l.waterWindow.length),
        food: l.food,
      };
      return {
        id: l.id,
        population: l.population,
        power: l.power,
        air: Math.round(l.air * 1000) / 1000,
        water: l.water,
        received,
        sick: { actual: l.active.length, official: l.official },
        zones: l.zones.map((z, i) => ({
          zone: i,
          tap: tapNode(l.id, i),
          power: z.power,
          flickersLastHour: z.flickers,
          ...(z.outSince !== undefined ? { outSince: z.outSince } : {}),
        })),
        supplyRatio: Math.round(l.supplyRatio * 1000) / 1000,
        feeder: Math.round(l.feeder * 1000) / 1000,
        recycler: r.id,
        powerHoursTotal: round1(l.powerHoursTotal),
        sickEver: l.sickEver,
        recovered: l.recoveredCount,
      };
    });
    const recyclerStates: RecyclerState[] = recyclers.map((r) => ({
      id: r.id,
      level: r.level,
      feeds: [...r.feeds],
      health: Math.round(r.health * 1000) / 1000,
      contaminated: r.health < CONTAMINATION_HEALTH,
      ...(r.contaminatedSince !== undefined ? { contaminatedSince: r.contaminatedSince } : {}),
    }));
    const hourOfDay = Math.floor(time / HOUR) % DAY_HOURS;
    return {
      seed,
      time,
      network: networkDown() ? 'down' : 'up',
      levels: out,
      hour,
      hourOfDay,
      grid: {
        capacity: Math.round(baseCapacity * genWalk * multiplier('generation-drop')),
        demand: Math.round(levels.reduce((s, l) => s + l.population * KW_PER_PERSON, 0) * dayFactor(hourOfDay)),
      },
      recyclers: recyclerStates,
      failures: [...failures.values()].map((f) => ({ ...f, spec: { ...f.spec } })),
    };
  }

  function changed() {
    snapshot = buildSnapshot();
    for (const fn of listeners) fn();
  }

  // ---------------------------------------------------------------- start

  simulateHour();
  snapshot = buildSnapshot();

  return {
    seed,
    levelCount,
    zonesPerLevel,
    pipeMap,
    population,
    getState: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    step(hours = 1) {
      if (!Number.isInteger(hours) || hours < 0) throw new Error('hours must be a whole number >= 0');
      const from = log.length;
      for (let i = 0; i < hours; i++) {
        time += HOUR;
        hour++;
        simulateHour();
      }
      if (hours > 0) changed();
      return log.slice(from);
    },
    trigger(spec) {
      const id = startFailure(spec, false);
      changed();
      return id;
    },
    resolve(id) {
      const f = failures.get(id);
      if (!f) return;
      endFailure(f);
      changed();
    },
    observations(since) {
      if (since === undefined) return log;
      return log.filter((o) => o.time >= since);
    },
    events: () => cityEvents,
    sickLists(levelId) {
      const self: number[] = [];
      const clinic: number[] = [];
      for (const l of levelId === undefined ? levels : [levelById(levelId)]) {
        for (const local of l.active) {
          const flags = l.reported[local]!;
          if (flags & F_SELF) self.push(l.firstResident + local);
          if (flags & F_CLINIC) clinic.push(l.firstResident + local);
        }
      }
      self.sort((a, b) => a - b);
      clinic.sort((a, b) => a - b);
      return { self, clinic };
    },
    levelOfResident(resident) {
      for (let i = levels.length - 1; i >= 0; i--) if (resident >= levels[i]!.firstResident) return levels[i]!.id;
      throw new Error(`no resident ${resident}`);
    },
    proof() {
      const out: ProofValues = {};
      const top = levels[0]!;
      const deepest = levels[levels.length - 1]!;
      // Problem 2: the deepest level's power hours as a share of the top level's, over the whole run.
      if (top.powerHoursTotal > 0) out.deepLevelPowerSharePct = round1((100 * deepest.powerHoursTotal) / top.powerHoursTotal);
      return out;
    },
  };
}

function sum(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}
