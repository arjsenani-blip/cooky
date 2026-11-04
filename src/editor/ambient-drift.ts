/**
 * Drives the drifting colour field behind the window (lucas-theme.css,
 * `.lb-ambient` / `.pmd-home-screen` ::before).
 *
 * The field used to be a CSS animation, which Chromium composites at the
 * display's refresh rate (up to 120 Hz) for as long as the window is on
 * screen — focused or not. The layer is window-sized with soft-light grain
 * blended on top, so the GPU process re-blended the whole window ~120×/s
 * for a drift that moves well under a pixel per frame. That was Cooky's
 * main battery drain.
 *
 * Same motion, cheaper: we compute the identical keyframes (32 s,
 * ease-in-out per segment, alternating) ourselves, write them at ~30 fps
 * into `--lb-drift` on the hosts, and hold still while the window is
 * blurred or hidden. At ~30 fps the slow drift's steps are sub-pixel on a
 * soft blur, so it reads exactly as before.
 */

const PERIOD_MS = 32_000;
const FRAME_MS = 33;

type Pose = [tx: number, ty: number, rot: number, scale: number];
// Mirrors @keyframes lb-mesh-drift in lucas-theme.css.
const STOPS: [at: number, pose: Pose][] = [
  [0, [0, 0, 0, 1]],
  [0.33, [6, -4, 8, 1.08]],
  [0.66, [-5, 5, -6, 1.04]],
  [1, [3, 6, 10, 1.12]],
];

/** CSS `ease-in-out` = cubic-bezier(0.42, 0, 0.58, 1). */
function easeInOut(x: number): number {
  const x1 = 0.42, x2 = 0.58;
  const bx = (t: number) => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
  let lo = 0, hi = 1, t = x;
  for (let i = 0; i < 20; i++) {
    t = (lo + hi) / 2;
    if (bx(t) < x) lo = t; else hi = t;
  }
  return 3 * (1 - t) * t * t + t * t * t; // y1 = 0, y2 = 1
}

/** Transform at time `ms`, matching `32s ease-in-out infinite alternate`. */
export function driftTransform(ms: number): string {
  const cycle = Math.floor(ms / PERIOD_MS);
  let p = (ms % PERIOD_MS) / PERIOD_MS;
  if (cycle % 2 === 1) p = 1 - p;
  let i = 0;
  while (i < STOPS.length - 2 && p > STOPS[i + 1]![0]) i++;
  const [a, pa] = STOPS[i]!;
  const [b, pb] = STOPS[i + 1]!;
  const k = easeInOut((p - a) / (b - a));
  const v = pa.map((x: number, j: number) => x + (pb[j]! - x) * k);
  const f = (n: number, d: number) => (Math.abs(n) < 0.5 * 10 ** -d ? 0 : n).toFixed(d);
  return `translate(${f(v[0]!, 3)}%, ${f(v[1]!, 3)}%) rotate(${f(v[2]!, 3)}deg) scale(${f(v[3]!, 4)})`;
}

function motionReduced(): boolean {
  const pref = document.documentElement.getAttribute('data-motion');
  if (pref === 'reduce') return true;
  if (pref === 'normal') return false;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function setupAmbientDrift(): void {
  const hosts = [
    document.getElementsByClassName('lb-ambient'),
    document.getElementsByClassName('pmd-home-screen'),
  ];
  const start = performance.now();
  // Time the field has been paused, so it resumes where it stopped.
  let pausedFor = 0;
  let pausedAt: number | null = null;
  let timer: number | null = null;

  const active = () => document.visibilityState === 'visible' && document.hasFocus() && !motionReduced();

  const paint = () => {
    const t = driftTransform(performance.now() - start - pausedFor);
    for (const list of hosts) {
      for (let i = 0; i < list.length; i++) (list[i] as HTMLElement).style.setProperty('--lb-drift', t);
    }
  };

  const tick = () => {
    timer = null;
    if (!active()) return pause();
    paint();
    timer = window.setTimeout(tick, FRAME_MS);
  };

  function pause(): void {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (pausedAt === null) pausedAt = performance.now();
    document.documentElement.classList.add('lb-window-idle');
  }

  const resume = () => {
    if (!active() || timer !== null) return;
    if (pausedAt !== null) { pausedFor += performance.now() - pausedAt; pausedAt = null; }
    document.documentElement.classList.remove('lb-window-idle');
    tick();
  };

  window.addEventListener('focus', resume);
  window.addEventListener('blur', pause);
  document.addEventListener('visibilitychange', () => (document.visibilityState === 'visible' ? resume() : pause()));
  window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', resume);
  new MutationObserver(resume).observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });

  paint();
  resume();
}
