// Charger sensing through the Battery Status API. Chrome has it; Safari (including iPhone) does not.
// Treat "unsupported" as a normal, expected answer, not an error.

interface BatteryManagerLike extends EventTarget {
  charging: boolean;
  level: number;
}
type NavigatorWithBattery = Navigator & { getBattery?: () => Promise<BatteryManagerLike> };

export function batterySupported(): boolean {
  return typeof navigator !== 'undefined' && typeof (navigator as NavigatorWithBattery).getBattery === 'function';
}

export interface ChargerWatch {
  /** State at the moment the watch started. */
  charging: boolean;
  level: number;
  stop(): void;
}

/**
 * Start watching the charger. Returns null when the API is missing. `onChange` fires on
 * every plug or unplug with the new charging state.
 */
export async function watchCharger(onChange: (charging: boolean, level: number) => void): Promise<ChargerWatch | null> {
  if (!batterySupported()) return null;
  const battery = await (navigator as NavigatorWithBattery).getBattery!();
  const handler = () => onChange(battery.charging, battery.level);
  battery.addEventListener('chargingchange', handler);
  return {
    charging: battery.charging,
    level: battery.level,
    stop: () => battery.removeEventListener('chargingchange', handler),
  };
}
