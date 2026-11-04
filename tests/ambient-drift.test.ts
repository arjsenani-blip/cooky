import { describe, expect, it } from 'vitest';
import { driftTransform } from '../src/editor/ambient-drift';

describe('driftTransform', () => {
  it('hits the lb-mesh-drift keyframes', () => {
    expect(driftTransform(0)).toBe('translate(0.000%, 0.000%) rotate(0.000deg) scale(1.0000)');
    expect(driftTransform(0.33 * 32_000)).toBe('translate(6.000%, -4.000%) rotate(8.000deg) scale(1.0800)');
    expect(driftTransform(0.66 * 32_000)).toBe('translate(-5.000%, 5.000%) rotate(-6.000deg) scale(1.0400)');
    expect(driftTransform(31_999.999)).toMatch(/^translate\(3\.000%, 6\.000%\) rotate\(10\.000deg\)/);
  });
  it('plays back in reverse on alternate cycles', () => {
    expect(driftTransform(32_000 + 5_000)).toBe(driftTransform(32_000 - 5_000));
    expect(driftTransform(64_000)).toBe(driftTransform(0));
  });
  it('eases in and out within a segment', () => {
    const tx = (ms: number) => Number(/translate\(([-\d.]+)%/.exec(driftTransform(ms))![1]);
    // Halfway through the first segment ease-in-out is at exactly half.
    expect(tx(0.165 * 32_000)).toBeCloseTo(3, 2);
    // Early in the segment it lags a linear ramp.
    expect(tx(0.033 * 32_000)).toBeLessThan(0.6);
  });
});
