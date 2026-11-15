/**
 * PDF plain-text paste cleanup (pdf-text-reflow.ts): artifact repair is
 * always on; soft-wrap rejoining only when the text looks like
 * hard-wrapped prose, and paragraph breaks are kept conservatively.
 */
import { describe, expect, it } from 'vitest';
import {
  cleanPdfArtifacts,
  isPdfTextLayerHtml,
  looksLikeWrappedProse,
  normalizePdfPlainText,
} from '../../src/editor/pdf-text-reflow.js';
import { normalizeClipboardTextForPaste } from '../../src/editor/paste-plugin.js';

/** Chrome's PDF viewer: CRLF line ends, U+0002 for a line-end hyphen,
 *  ligature code points from the font's glyph mapping. */
const CHROME_PDF =
  'The eﬀects of climate change are signiﬁcant and the evidence is con\u0002\r\n' +
  'clusive across every major dataset we have examined in this study of\r\n' +
  'global temperature records.\r\n' +
  '\r\n' +
  'A new paragraph begins here.';

/** macOS Preview / Acrobat: LF line ends, a real hyphen at the break,
 *  no blank line between paragraphs (the short last line ends it). */
const PREVIEW_PDF = [
  'The evidence shows that climate feedback loops are accelerating at a',
  'rate that scientists did not predict even a decade ago. Arctic permafrost',
  'releases methane, which in turn warms the atmosphere further, a cycle that',
  'is self-reinforcing and difficult to re-',
  'verse once begun.',
  'Second paragraph starts here and continues for a while so that it is long',
  'enough to wrap across multiple lines in the original document layout.',
].join('\n');

describe('cleanPdfArtifacts (always-safe layer)', () => {
  it('expands ligatures and joins U+0002 / soft-hyphen line breaks', () => {
    expect(cleanPdfArtifacts('eﬀect ﬁne ﬂow oﬃce baﬄe')).toBe('effect fine flow office baffle');
    expect(cleanPdfArtifacts('con\u0002\r\nclusive')).toBe('conclusive');
    expect(cleanPdfArtifacts('con­\nclusive')).toBe('conclusive');
    expect(cleanPdfArtifacts('self\u0002reinforcing')).toBe('self-reinforcing');
  });

  it('normalizes CRLF / CR to LF and otherwise leaves text alone', () => {
    expect(cleanPdfArtifacts('a\r\nb\rc')).toBe('a\nb\nc');
    expect(cleanPdfArtifacts('plain text, nothing to do')).toBe('plain text, nothing to do');
  });
});

describe('normalizePdfPlainText — reflow of wrapped prose', () => {
  it('Chrome PDF viewer copy: one paragraph per real paragraph, words rejoined', () => {
    expect(normalizePdfPlainText(CHROME_PDF)).toBe(
      'The effects of climate change are significant and the evidence is conclusive ' +
        'across every major dataset we have examined in this study of global temperature records.\n' +
        'A new paragraph begins here.',
    );
  });

  it('Preview copy: end-of-line hyphenation removed; a short sentence-final line ends the paragraph', () => {
    const out = normalizePdfPlainText(PREVIEW_PDF).split('\n');
    expect(out).toHaveLength(2);
    expect(out[0]).toContain('accelerating at a rate that');
    expect(out[0]).toContain('difficult to reverse once begun.');
    expect(out[1]).toMatch(/^Second paragraph .* document layout\.$/);
  });

  it('a hyphen before a capitalized line is a real compound: kept, no space', () => {
    const t =
      'The treaty reshaped the post-war relationship between the Anglo-\n' +
      'American alliance and the rest of the continental European powers.';
    expect(normalizePdfPlainText(t)).toContain('Anglo-American alliance');
  });

  it('a short heading line followed by a capitalized line stays its own paragraph', () => {
    const t = [
      'Introduction',
      'Nuclear deterrence has been the cornerstone of great power stability for',
      'more than seven decades, and its erosion would carry enormous risks.',
    ].join('\n');
    expect(normalizePdfPlainText(t).split('\n')).toEqual([
      'Introduction',
      'Nuclear deterrence has been the cornerstone of great power stability for more than seven decades, and its erosion would carry enormous risks.',
    ]);
  });

  it('bulleted / numbered items keep their own lines', () => {
    const t = [
      'The report identifies three mechanisms through which warming escalates',
      'conflict risk across the region and beyond:',
      '1. Resource scarcity that drives competition over arable land and water',
      '2. Migration pressure that strains the institutions of receiving states',
    ].join('\n');
    const out = normalizePdfPlainText(t).split('\n');
    expect(out).toHaveLength(3);
    expect(out[1]).toMatch(/^1\. /);
    expect(out[2]).toMatch(/^2\. /);
  });
});

describe('looksLikeWrappedProse — the gate keeps ordinary plain text untouched', () => {
  const untouched = (t: string): void => {
    expect(looksLikeWrappedProse(t)).toBe(false);
    expect(normalizePdfPlainText(t)).toBe(t);
  };
  it('code', () => untouched('function f() {\n  return 1;\n}\nconst x = f();'));
  it('a short list', () => untouched('apples\nbananas\ncherries'));
  it('an address', () => untouched('Jane Smith\n123 Main Street\nSpringfield, IL 62701'));
  it('one sentence per line', () =>
    untouched(
      'Warming is real and it is accelerating faster than predicted.\n' +
        'The impacts will be felt first in the most vulnerable regions.\n' +
        'Policy action is needed now, before the tipping points arrive.',
    ));
  it('a single line', () => untouched('Just one line of text without breaks'));
  it('blank-line separated paragraphs that are already whole', () =>
    untouched('First paragraph is complete.\n\nSecond paragraph is complete too.'));
});

describe('normalizeClipboardTextForPaste (F2 plain paste) applies the PDF repair', () => {
  it('reflows in a body context', () => {
    expect(normalizeClipboardTextForPaste(CHROME_PDF, 'card_body').split('\n')).toHaveLength(2);
  });
  it('a soft hyphen at a line end joins the word (not stripped into a split)', () => {
    expect(normalizeClipboardTextForPaste('con­\nclusive', 'card_body')).toBe('conclusive');
  });
  it('single-line parents still collapse to one line', () => {
    expect(normalizeClipboardTextForPaste(CHROME_PDF, 'tag')).not.toContain('\n');
  });
});

describe('isPdfTextLayerHtml', () => {
  it('recognizes pdf.js text-layer copies', () => {
    expect(
      isPdfTextLayerHtml(
        `<span style="left: 72px; top: 100px; font-size: 16px;" role="presentation" dir="ltr">a</span><br role="presentation"><span style="left: 72px; top: 120px;" role="presentation" dir="ltr">b</span>`,
      ),
    ).toBe(true);
  });
  it('ignores ordinary HTML', () => {
    expect(isPdfTextLayerHtml('<p>Hello <b>world</b></p><br>')).toBe(false);
    expect(isPdfTextLayerHtml('')).toBe(false);
  });
});
