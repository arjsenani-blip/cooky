/**
 * Plain-text paste cleanup for text copied out of PDF viewers (Chrome's
 * built-in viewer, macOS Preview, Acrobat, pdf.js).
 *
 * PDF viewers put the page's VISUAL lines on the clipboard: every line
 * of a paragraph ends in a hard newline, words broken across a line end
 * keep their hyphen ("re-\nverse"), and the text carries extraction
 * artifacts — typographic ligature code points (U+FB00–FB06, "ﬁ"),
 * Chrome's U+0002 stand-in for a line-end hyphen, soft hyphens. Pasted
 * as-is, every visual line becomes its own paragraph.
 *
 * Two layers, deliberately separate:
 *
 *  1. `cleanPdfArtifacts` — always safe on ANY plain text: ligature code
 *     points are presentation forms (never authored content), U+0002 is
 *     a control character, and a soft hyphen immediately before a line
 *     break is by definition a discretionary break. Runs on every plain
 *     paste.
 *
 *  2. `reflowWrappedLines` — joins soft-wrapped lines back into
 *     paragraphs. Only applied when the text as a whole LOOKS like
 *     wrapped prose (`looksLikeWrappedProse`): long-ish lines, mostly
 *     ending mid-sentence, no code-style indentation. Code, lists,
 *     addresses, poetry and one-sentence-per-line text fail the gate and
 *     paste untouched. Within reflowed text, paragraph breaks are kept
 *     conservatively — blank lines, a short line ending a sentence,
 *     a short line followed by a capitalized line (headings), and
 *     bullet/number markers all stay hard breaks.
 */

const LIGATURES: Record<string, string> = {
  'ﬀ': 'ff',
  'ﬁ': 'fi',
  'ﬂ': 'fl',
  'ﬃ': 'ffi',
  'ﬄ': 'ffl',
  'ﬅ': 'ft',
  'ﬆ': 'st',
};
const LIGATURE_RE = /[ﬀ-ﬆ]/g;

/** Hyphen-like characters a PDF may end a broken line with. */
const LINE_END_HYPHEN_RE = /[A-Za-zÀ-ɏ][-‐‑]$/;
const SENTENCE_END_RE = /[.!?…]["'”’)\]]*$/;
/** Bullets and enumerators that start a new list item. */
const LIST_MARKER_RE = /^(?:[•●▪◦‣∙·*]|[-–—]\s|\(?\d{1,3}[.)]\s|\(?[ivxIVX]{1,4}\)\s|\([a-z]\)\s)/;
const STARTS_LOWER_RE = /^[a-zß-ÿ]/;
const STARTS_UPPER_RE = /^["'“‘(]?[A-ZÀ-Þ]/;

/** Always-safe PDF artifact cleanup (see module doc, layer 1). */
export function cleanPdfArtifacts(text: string): string {
  return (
    text
      .replace(/\r\n?/g, '\n')
      .replace(LIGATURE_RE, (ch) => LIGATURES[ch] ?? ch)
      // Chrome's PDF viewer writes U+0002 where the page had a line-end
      // hyphen: a discretionary break — join the word halves.
      .replace(/\u0002[ \t]*\n[ \t]*/g, '')
      // Soft hyphen at a line end: same thing, spelled properly.
      .replace(/­[ \t]*\n[ \t]*/g, '')
      // Any other U+0002 stands for a visible hyphen glyph.
      .replace(/\u0002/g, '-')
  );
}

/**
 * Does this text look like prose that a PDF viewer hard-wrapped at its
 * visual line ends? Conservative: false unless most line boundaries
 * fall mid-sentence and the lines are prose-length.
 */
export function looksLikeWrappedProse(text: string): boolean {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const nonBlank = lines.filter((l) => l.trim() !== '');
  if (nonBlank.length < 2) return false;
  // Code / preformatted text: tabs or deep indentation on several lines.
  const indented = nonBlank.filter((l) => /^(\t| {2,})/.test(l)).length;
  if (indented > Math.max(1, nonBlank.length * 0.2)) return false;
  // Count line boundaries inside paragraphs (blank lines excluded).
  let boundaries = 0;
  let soft = 0;
  let longLines = 0;
  let wrappedLines = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    const a = lines[i]!.trim();
    const b = lines[i + 1]!.trim();
    if (!a || !b) continue;
    wrappedLines++;
    if (a.length >= 30) longLines++;
    // A boundary before a list item is structural either way — it says
    // nothing about whether the text is wrapped.
    if (LIST_MARKER_RE.test(b)) continue;
    boundaries++;
    if (!SENTENCE_END_RE.test(a) || STARTS_LOWER_RE.test(b)) soft++;
  }
  if (boundaries === 0) return false;
  // Prose-length lines: at least half the wrapped lines are long. Rules
  // out short lists, addresses, poetry, single-word-per-line text.
  if (longLines < wrappedLines * 0.5) return false;
  // Most boundaries fall mid-sentence.
  return soft >= boundaries * 0.5;
}

/** Join one block of consecutive non-blank lines into paragraphs. */
function reflowBlock(lines: string[]): string[] {
  const trimmed = lines.map((l) => l.replace(/[ \t]+$/g, '').replace(/^[ \t]+/, ''));
  const maxLen = Math.max(...trimmed.map((l) => l.length));
  const paras: string[] = [];
  let cur = trimmed[0]!;
  let curLast = trimmed[0]!;
  for (let i = 1; i < trimmed.length; i++) {
    const prev = curLast;
    const next = trimmed[i]!;
    const shortPrev = prev.length < maxLen * 0.85;
    const hardBreak =
      LIST_MARKER_RE.test(next) ||
      (SENTENCE_END_RE.test(prev) && shortPrev && !STARTS_LOWER_RE.test(next)) ||
      // A short line with no trailing connector, followed by a
      // capitalized line: a heading, a byline, a paragraph's last line.
      (prev.length < maxLen * 0.6 && !/[,;:\-–—]$/.test(prev) && STARTS_UPPER_RE.test(next));
    if (hardBreak) {
      paras.push(cur);
      cur = next;
    } else if (LINE_END_HYPHEN_RE.test(prev) && STARTS_LOWER_RE.test(next)) {
      // "re-" + "verse" → "reverse": the end-of-line hyphenation.
      cur = cur.slice(0, -1) + next;
    } else if (/[-‐‑—–/]$/.test(prev)) {
      // A hyphen before a capital/digit ("Anglo-" + "American") or a
      // dash/slash: keep the character, no space.
      cur += next;
    } else {
      cur += ' ' + next;
    }
    curLast = next;
  }
  paras.push(cur);
  return paras;
}

/**
 * Join soft-wrapped lines into paragraphs. Blank lines separate
 * paragraphs; output paragraphs are separated by a single '\n'.
 */
export function reflowWrappedLines(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const paras: string[] = [];
  let block: string[] = [];
  const flush = (): void => {
    if (block.length) paras.push(...reflowBlock(block));
    block = [];
  };
  for (const line of lines) {
    if (line.trim() === '') flush();
    else block.push(line);
  }
  flush();
  // Keep a trailing newline if the source had one (a line-selection
  // copy) so paste placement doesn't change.
  return paras.join('\n') + (/\n\s*$/.test(text) && paras.length ? '\n' : '');
}

/**
 * The plain-text paste entry point: artifact cleanup always, reflow only
 * when the text looks like hard-wrapped prose.
 */
export function normalizePdfPlainText(text: string): string {
  const cleaned = cleanPdfArtifacts(text);
  return looksLikeWrappedProse(cleaned) ? reflowWrappedLines(cleaned) : cleaned;
}

/**
 * pdf.js text-layer HTML (what a copy from a pdf.js-rendered page — the
 * Firefox viewer, many web PDF embeds — can put on the clipboard): one
 * absolutely-positioned `<span role="presentation">` per visual line,
 * separated by `<br role="presentation">`. Parsed as HTML the line
 * breaks vanish and the last word of each line fuses with the first of
 * the next ("feedbackloops"). Callers route such clipboards through the
 * plain-text path instead.
 */
export function isPdfTextLayerHtml(html: string | null | undefined): boolean {
  if (!html) return false;
  if (/<br[^>]*role=["']?presentation/i.test(html)) return true;
  const spans = html.match(/<span[^>]*role=["']?presentation[^>]*>/gi) ?? [];
  return spans.length >= 2 && spans.filter((s) => /\b(left|top)\s*:/i.test(s)).length >= 2;
}
