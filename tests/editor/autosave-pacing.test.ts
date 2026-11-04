// @vitest-environment jsdom
/**
 * Autosave pacing (pause length, max wait, battery) and the on-by-default
 * per-file preference.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { autosaveDelay } from '../../src/editor/autosave-pacing.js';
import { isAutosaveOnForPath, setAutosaveForPath } from '../../src/editor/autosave-prefs-store.js';

describe('autosaveDelay', () => {
  it('waits for a pause after the last keystroke', () => {
    expect(autosaveDelay('cmir', 1000, 1000, false)).toBe(3000);
    expect(autosaveDelay('docx', 1000, 1000, false)).toBe(4000);
  });

  it('still saves during a long typing burst', () => {
    // Typing since t=0 without a pause: the docx round is due at 30s.
    expect(autosaveDelay('docx', 28000, 0, false)).toBe(2000);
    expect(autosaveDelay('docx', 31000, 0, false)).toBe(0);
  });

  it('waits twice as long on battery', () => {
    expect(autosaveDelay('docx', 0, 0, true)).toBe(8000);
    expect(autosaveDelay('docx', 58000, 0, true)).toBe(2000);
  });
});

describe('autosave preference', () => {
  beforeEach(() => localStorage.clear());

  it('is on for any saved file until turned off', () => {
    expect(isAutosaveOnForPath('/Users/me/Documents/Cooky/aff.docx')).toBe(true);
    setAutosaveForPath('/Users/me/Documents/Cooky/aff.docx', false);
    expect(isAutosaveOnForPath('/Users/me/Documents/Cooky/aff.docx')).toBe(false);
    setAutosaveForPath('/Users/me/Documents/Cooky/aff.docx', true);
    expect(isAutosaveOnForPath('/Users/me/Documents/Cooky/aff.docx')).toBe(true);
  });

  it('is off for an unsaved doc', () => {
    expect(isAutosaveOnForPath(null)).toBe(false);
  });
});
