/**
 * When to fire an autosave, tuned to be light on battery.
 *
 * Saves only follow edits (no polling), wait for a pause in typing, and
 * still land at least every `maxWait` during a long uninterrupted burst
 * so a crash never costs more than that. A `.docx` write rebuilds the
 * whole Word file on the main thread, so it waits a little longer than
 * `.cmir`. On battery (not charging) every wait doubles: half the writes,
 * same safety net, since the journal still snapshots edits for recovery.
 */

export type AutosaveFormat = 'cmir' | 'docx';

const IDLE_MS: Record<AutosaveFormat, number> = { cmir: 3000, docx: 4000 };
const MAX_WAIT_MS: Record<AutosaveFormat, number> = { cmir: 20000, docx: 30000 };

/** Milliseconds from `now` until the autosave should fire, given when
 *  the first unsaved edit of this round landed. Never negative. */
export function autosaveDelay(
  format: AutosaveFormat,
  now: number,
  firstPendingAt: number,
  onBattery: boolean,
): number {
  const k = onBattery ? 2 : 1;
  const idle = IDLE_MS[format] * k;
  const maxLeft = MAX_WAIT_MS[format] * k - (now - firstPendingAt);
  return Math.max(0, Math.min(idle, maxLeft));
}

let onBattery = false;

/** True while the machine is running on battery (not charging). Starts
 *  false and follows the Battery Status API where the runtime has it. */
export function isOnBattery(): boolean {
  return onBattery;
}

type BatteryLike = EventTarget & { charging: boolean };

/** Start following the charging state. Event-driven, no polling. */
export function watchBattery(): void {
  const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
  if (typeof nav.getBattery !== 'function') return;
  void nav
    .getBattery()
    .then((b) => {
      onBattery = !b.charging;
      b.addEventListener('chargingchange', () => {
        onBattery = !b.charging;
      });
    })
    .catch(() => {});
}
