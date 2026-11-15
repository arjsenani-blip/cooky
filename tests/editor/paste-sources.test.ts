// @vitest-environment jsdom
/**
 * End-to-end paste from each real-world source, through ProseMirror's
 * own clipboard pipeline (a dispatched `paste` event → parseFromClipboard
 * → transformPastedText/HTML → handlePaste → default insertion), with
 * realistic clipboard fixtures:
 *
 *  - Google Docs: `<b id="docs-internal-guid-…">` + inline-styled spans.
 *  - Word (desktop): the full document shell, head `<style>` with
 *    `/* … *\/` comments, `<!--StartFragment-->`, `<o:p>`, MsoNormal
 *    paragraphs, Verbatim classes, mso-highlight, the `<em>` Emphasis box.
 *  - PDF viewers: text/plain only (Chrome / Preview), or pdf.js text-layer
 *    HTML.
 *  - Cleavo itself: our own clipboard serialization, raw and wrapped the
 *    way macOS / Windows hand it back.
 *  - The right-click menu Paste and the desktop fast-paste bridge's rich
 *    insert.
 */
import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { type Node as PMNode } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { buildPastePlugin, pasteClipboardFlavors } from '../../src/editor/paste-plugin.js';
import { commentClipboardPlugin } from '../../src/editor/comment-clipboard.js';
import { namedStyleNormalizerPlugin } from '../../src/editor/named-style-normalizer-plugin.js';
import { buildExternalRichInsertTransaction } from '../../src/editor/external-insert.js';

// ─── fixtures ────────────────────────────────────────────────────────────────

const WORD_HEAD = `<html xmlns:v="urn:schemas-microsoft-com:vml"
xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:w="urn:schemas-microsoft-com:office:word"
xmlns:m="http://schemas.microsoft.com/office/2004/12/omml"
xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta http-equiv=Content-Type content="text/html; charset=utf-8">
<meta name=ProgId content=Word.Document>
<meta name=Generator content="Microsoft Word 15">
<meta name=Originator content="Microsoft Word 15">
<link rel=File-List href="file:////Users/x/Library/Group%20Containers/UBF8T346G9.Office/TemporaryItems/msohtmlclip/clip_filelist.xml">
<!--[if gte mso 9]><xml>
 <o:OfficeDocumentSettings>
  <o:AllowPNG/>
 </o:OfficeDocumentSettings>
</xml><![endif]-->
<style>
<!--
 /* Font Definitions */
 @font-face
	{font-family:"Cambria Math";
	panose-1:2 4 5 3 5 4 6 3 2 4;}
 /* Style Definitions */
 span.Underlined1
	{mso-style-name:"Style Underline\\,Underline";
	mso-style-priority:1;
	font-weight:normal;
	text-decoration:underline;
	text-underline:single;}
 p.MsoNormal, li.MsoNormal, div.MsoNormal
	{mso-style-unhide:no;
	margin:0in;
	font-size:11.0pt;
	font-family:"Calibri",sans-serif;}
h4
	{mso-style-name:"Heading 4\\,Tag\\,Big card\\,body\\,small text";
	margin:0in;
	font-size:13.0pt;
	font-weight:bold;}
span.Style13ptBold
	{mso-style-name:"Style 13 pt Bold\\,Cite";
	font-size:13.0pt;
	font-weight:bold;}
em
	{mso-style-name:"Emphasis\\,Minimized\\,minimized";
	font-weight:bold;
	font-style:normal;
	text-decoration:underline;
	border:solid windowtext 1.0pt;
	mso-border-alt:solid windowtext .5pt;
	padding:0in;}
@page WordSection1
	{size:8.5in 11.0in;}
div.WordSection1
	{page:WordSection1;}
-->
</style>
</head>
<body lang=EN-US style='tab-interval:.5in;word-wrap:break-word'>
<!--StartFragment-->`;
const WORD_TAIL = `<!--EndFragment-->
</body>
</html>`;
const word = (body: string): string => WORD_HEAD + body + WORD_TAIL;

/** A whole Verbatim card. `Underlined1` is a renamed underline style —
 *  only its mso-style-name (right after a CSS comment) identifies it. */
const WORD_CARD = word(`
<h4>Warming causes extinction<o:p></o:p></h4>

<p class=MsoNormal><span class=Style13ptBold>Smith 23</span> — Jane Smith,
Professor<o:p></o:p></p>

<p class=MsoNormal><span style='font-size:8.0pt'>Feedback loops </span><span
class=Underlined1><span style='background:yellow;mso-highlight:yellow'>accelerate</span></span><span
class=Underlined1> warming</span> and <em><span style='background:aqua;mso-highlight:aqua'>nothing
stops them</span></em><span style='font-size:8.0pt'> at all<o:p></o:p></span></p>
`);

/** A few lines from the middle of a card body — no tag, no cite. */
const WORD_BODY_ONLY = word(`
<p class=MsoNormal><span style='font-size:8.0pt'>Feedback loops </span><span
class=Underlined1><span style='background:yellow;mso-highlight:yellow'>accelerate</span></span><span
class=Underlined1> warming</span> and <em>nothing stops them</em><o:p></o:p></p>

<p class=MsoNormal><span class=Underlined1>Second</span> para<o:p></o:p></p>
`);

/** A phrase from inside one paragraph. */
const WORD_PHRASE = word(`<p class=MsoNormal><span class=Underlined1><span
style='background:yellow;mso-highlight:yellow'>accelerate</span></span><span
class=Underlined1> warming</span><o:p></o:p></p>`);

const GD_RUN =
  'font-family:Arial,sans-serif;color:#000000;font-style:normal;font-variant:normal;vertical-align:baseline;white-space:pre;white-space:pre-wrap;';
const gspan = (text: string, extra = ''): string =>
  `<span style="font-size:11pt;${GD_RUN}background-color:transparent;font-weight:400;text-decoration:none;${extra}">${text}</span>`;
const gdocs = (inner: string): string =>
  `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-0f1e2d3c-7fff-aaaa-bbbb-123456789abc">${inner}</b>`;
const GD_P = '<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;">';

const GDOCS_BODY = gdocs(
  `${GD_P}${gspan('one ')}${gspan('two', 'background-color:#ffff00;text-decoration:underline;-webkit-text-decoration-skip:none;text-decoration-skip-ink:none;')}</p><br>` +
    `${GD_P}${gspan('three', 'font-weight:700;text-decoration:underline;')}</p>`,
);
const GDOCS_PHRASE = gdocs(`${gspan('one ')}${gspan('two', 'background-color:#ffff00;text-decoration:underline;')}`);
const GDOCS_WINDOWS =
  `<html><body>\r\n<!--StartFragment-->` +
  gdocs(`${GD_P}${gspan('one two', 'background-color:#ffff00;text-decoration:underline;')}</p>`) +
  `<!--EndFragment-->\r\n</body>\r\n</html>`;

const PDF_CHROME =
  'The eﬀects of climate change are signiﬁcant and the evidence is con\u0002\r\n' +
  'clusive across every major dataset we have examined in this study of\r\n' +
  'global temperature records.\r\n\r\nA new paragraph begins here.';
const PDF_PREVIEW = [
  'The evidence shows that climate feedback loops are accelerating at a',
  'rate that scientists did not predict even a decade ago. Arctic permafrost',
  'releases methane, which in turn warms the atmosphere further, a cycle that',
  'is self-reinforcing and difficult to re-',
  'verse once begun.',
  'Second paragraph starts here and continues for a while so that it is long',
  'enough to wrap across multiple lines in the original document layout.',
].join('\n');
const PDFJS_HTML =
  `<meta charset='utf-8'><span style="left: 72px; top: 100px; font-size: 16px; font-family: sans-serif; transform: scaleX(0.98);" role="presentation" dir="ltr">The evidence shows that climate feedback</span>` +
  `<br role="presentation"><span style="left: 72px; top: 120px; font-size: 16px; font-family: sans-serif;" role="presentation" dir="ltr">loops are accelerating</span>`;

// ─── harness ─────────────────────────────────────────────────────────────────

function plugins() {
  return [
    commentClipboardPlugin(),
    namedStyleNormalizerPlugin,
    buildPastePlugin({
      condenseOnPaste: () => false,
      paragraphIntegrity: () => false,
      usePilcrows: () => false,
      headingMode: () => 'respect',
      smartPasteConversion: () => true,
    }),
  ];
}

function mount(doc: PMNode): EditorView {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new EditorView(el, { state: EditorState.create({ doc, plugins: plugins() }) });
}

/** One card "Existing tag / existing body", caret placed per `at`. */
function makeView(at: 'body-end' | 'body-mid' | 'tag-mid' | 'empty-doc'): EditorView {
  if (at === 'empty-doc') {
    const v = mount(schema.nodes['doc']!.create(null, [schema.nodes['paragraph']!.create()]));
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 1)));
    return v;
  }
  const v = mount(
    schema.nodes['doc']!.create(null, [
      schema.nodes['card']!.createChecked(null, [
        schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text('Existing tag')),
        schema.nodes['card_body']!.create(null, schema.text('existing body')),
      ]),
    ]),
  );
  const end = v.state.doc.content.size - 2;
  const pos = at === 'body-end' ? end : at === 'body-mid' ? end - 4 : 6; // tag-mid: "Exis|ting tag"
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, pos)));
  return v;
}

/** Dispatch a real `paste` DOM event, so PM's own clipboard parsing runs. */
function paste(view: EditorView, flavors: Record<string, string>): void {
  const ev = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', {
    value: { files: [], types: Object.keys(flavors), getData: (t: string) => flavors[t] ?? '' },
  });
  view.dom.dispatchEvent(ev);
}

/** `type: text` per textblock, document order. */
function blocks(doc: PMNode): string[] {
  const out: string[] = [];
  doc.descendants((n) => {
    if (n.isTextblock) {
      out.push(`${n.type.name}: ${n.textContent}`);
      return false;
    }
    return true;
  });
  return out;
}

/** Sorted mark names (highlight with its color) on the text node holding `sub`. */
function marksAt(doc: PMNode, sub: string): string[] {
  let found: string[] | null = null;
  doc.descendants((n) => {
    if (found) return false;
    if (n.isText && n.text!.includes(sub)) {
      found = n.marks
        .map((m) => (m.type.name === 'highlight' ? `highlight:${m.attrs['color']}` : m.type.name))
        .sort();
    }
    return !found;
  });
  if (!found) throw new Error(`no text node containing ${JSON.stringify(sub)}`);
  return found;
}

// ─── Google Docs ─────────────────────────────────────────────────────────────

describe('paste from Google Docs', () => {
  it('body paragraphs keep highlight, underline and bold+underline emphasis', () => {
    const v = makeView('body-end');
    paste(v, { 'text/html': GDOCS_BODY, 'text/plain': 'one two\n\nthree' });
    expect(blocks(v.state.doc)).toEqual([
      'tag: Existing tag',
      'card_body: existing body',
      'card_body: one two',
      'card_body: three',
    ]);
    expect(marksAt(v.state.doc, 'two')).toEqual(['highlight:yellow', 'underline_mark']);
    expect(marksAt(v.state.doc, 'three')).toEqual(['emphasis_mark']);
  });

  it('a phrase pastes inline mid-sentence with its marks', () => {
    const v = makeView('body-mid');
    paste(v, { 'text/html': GDOCS_PHRASE, 'text/plain': 'one two' });
    expect(blocks(v.state.doc)).toEqual(['tag: Existing tag', 'card_body: existing one twobody']);
    expect(marksAt(v.state.doc, 'two')).toEqual(['highlight:yellow', 'underline_mark']);
  });

  it('a one-paragraph copy pasted into a tag extends the tag (was: split the card)', () => {
    const v = makeView('tag-mid');
    paste(v, { 'text/html': GDOCS_WINDOWS, 'text/plain': 'one two' });
    expect(blocks(v.state.doc)).toEqual(['tag: Exisone twoting tag', 'card_body: existing body']);
    expect(v.state.doc.childCount).toBe(1);
  });

  it('the Windows CF_HTML wrapper (StartFragment comments) converts the same', () => {
    const v = makeView('body-end');
    paste(v, { 'text/html': GDOCS_WINDOWS, 'text/plain': 'one two' });
    expect(blocks(v.state.doc)).toEqual(['tag: Existing tag', 'card_body: existing bodyone two']);
    expect(marksAt(v.state.doc, 'one two')).toEqual(['highlight:yellow', 'underline_mark']);
  });
});

// ─── Microsoft Word ──────────────────────────────────────────────────────────

describe('paste from Microsoft Word (desktop clipboard shell)', () => {
  it('a whole card keeps structure, cite, renamed underline, highlights, sizes and the Emphasis box', () => {
    const v = makeView('empty-doc');
    paste(v, { 'text/html': WORD_CARD, 'text/plain': 'Warming causes extinction…' });
    const b = blocks(v.state.doc);
    expect(b).toContain('tag: Warming causes extinction');
    expect(b).toContain('cite_paragraph: Smith 23 — Jane Smith, Professor');
    expect(marksAt(v.state.doc, 'Smith 23')).toEqual(['cite_mark']);
    expect(marksAt(v.state.doc, 'accelerate')).toEqual(['highlight:yellow', 'underline_mark']);
    expect(marksAt(v.state.doc, ' warming')).toEqual(['underline_mark']);
    expect(marksAt(v.state.doc, 'Feedback loops')).toEqual(['font_size']);
    // The Emphasis style's own bold/underline are rendering, not marks.
    expect(marksAt(v.state.doc, 'nothing stops them')).toEqual(['emphasis_mark', 'highlight:cyan']);
  });

  it('body text with no tag or cite still keeps its formatting (was: all stripped)', () => {
    const v = makeView('body-end');
    paste(v, { 'text/html': WORD_BODY_ONLY, 'text/plain': 'Feedback loops accelerate warming…' });
    expect(blocks(v.state.doc)).toEqual([
      'tag: Existing tag',
      'card_body: existing body',
      'card_body: Feedback loops accelerate warming and nothing stops them',
      'card_body: Second para',
    ]);
    expect(marksAt(v.state.doc, 'accelerate')).toEqual(['highlight:yellow', 'underline_mark']);
    expect(marksAt(v.state.doc, 'nothing stops them')).toEqual(['emphasis_mark']);
    expect(marksAt(v.state.doc, 'Second')).toEqual(['underline_mark']);
  });

  it('a phrase pastes inline with its marks and no stray edge spaces', () => {
    const v = makeView('body-mid');
    paste(v, { 'text/html': WORD_PHRASE, 'text/plain': 'accelerate warming' });
    expect(blocks(v.state.doc)).toEqual(['tag: Existing tag', 'card_body: existing accelerate warmingbody']);
    expect(marksAt(v.state.doc, 'accelerate')).toEqual(['highlight:yellow', 'underline_mark']);
  });
});

// ─── PDF ─────────────────────────────────────────────────────────────────────

describe('paste from PDF viewers', () => {
  it('Chrome viewer text: lines rejoined, U+0002 hyphenation and ligatures repaired', () => {
    const v = makeView('body-end');
    paste(v, { 'text/plain': PDF_CHROME });
    expect(blocks(v.state.doc)).toEqual([
      'tag: Existing tag',
      'card_body: existing body',
      'card_body: The effects of climate change are significant and the evidence is conclusive across every major dataset we have examined in this study of global temperature records.',
      'card_body: A new paragraph begins here.',
    ]);
  });

  it('Preview / Acrobat text: one paragraph per real paragraph, "re-\\nverse" joined', () => {
    const v = makeView('empty-doc');
    paste(v, { 'text/plain': PDF_PREVIEW });
    const b = blocks(v.state.doc);
    expect(b).toHaveLength(2);
    expect(b[0]).toContain('difficult to reverse once begun.');
    expect(b[1]).toMatch(/^paragraph: Second paragraph .* layout\.$/);
  });

  it('pdf.js text-layer HTML: words at line ends no longer fuse', () => {
    const v = makeView('body-end');
    paste(v, {
      'text/html': PDFJS_HTML,
      'text/plain': 'The evidence shows that climate feedback\nloops are accelerating',
    });
    expect(blocks(v.state.doc)).toEqual([
      'tag: Existing tag',
      'card_body: existing bodyThe evidence shows that climate feedback loops are accelerating',
    ]);
  });

  it('ordinary multi-line plain text (a list) still pastes line by line', () => {
    const v = makeView('empty-doc');
    paste(v, { 'text/plain': 'apples\nbananas\ncherries' });
    expect(blocks(v.state.doc)).toEqual(['paragraph: apples', 'paragraph: bananas', 'paragraph: cherries']);
  });
});

// ─── Cleavo ↔ Cleavo ─────────────────────────────────────────────────────────

const mk = (n: string, a?: Record<string, unknown>) => schema.marks[n]!.create(a);
function sourceView(): EditorView {
  return mount(
    schema.nodes['doc']!.create(null, [
      schema.nodes['pocket']!.create({ id: newHeadingId() }, schema.text('AFF')),
      schema.nodes['card']!.createChecked(null, [
        schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text('Warming bad')),
        schema.nodes['cite_paragraph']!.create(null, [schema.text('Smith 23', [mk('cite_mark')]), schema.text(' — prof')]),
        schema.nodes['card_body']!.create(null, [
          schema.text('small ', [mk('font_size', { halfPoints: 16 })]),
          schema.text('lit', [mk('underline_mark'), mk('highlight', { color: 'yellow' })]),
          schema.text(' and '),
          schema.text('boxed', [mk('emphasis_mark'), mk('highlight', { color: 'cyan' })]),
          schema.text(' end'),
        ]),
      ]),
    ]),
  );
}
function textPos(v: EditorView, s: string): number {
  let r = -1;
  v.state.doc.descendants((n, p) => {
    if (r < 0 && n.isText && n.text!.includes(s)) r = p + n.text!.indexOf(s);
  });
  return r;
}
function copy(v: EditorView, from: number, to: number): { html: string; text: string } {
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, from, to)));
  const { dom, text } = v.serializeForClipboard(v.state.selection.content());
  return { html: dom.innerHTML, text };
}
const WRAPS: Record<string, (h: string) => string> = {
  raw: (h) => h,
  mac: (h) => `<meta charset='utf-8'>${h}`,
  windows: (h) => `<html>\r\n<body>\r\n<!--StartFragment-->${h}<!--EndFragment-->\r\n</body>\r\n</html>`,
};

describe('paste between Cleavo documents / windows', () => {
  for (const [wrapName, wrap] of Object.entries(WRAPS)) {
    it(`whole outline (pocket + card) round-trips (${wrapName} clipboard)`, () => {
      const s = sourceView();
      const { html, text } = copy(s, 1, s.state.doc.content.size - 1);
      const v = makeView('empty-doc');
      paste(v, { 'text/html': wrap(html), 'text/plain': text });
      expect(blocks(v.state.doc)).toEqual([
        'pocket: AFF',
        'tag: Warming bad',
        'cite_paragraph: Smith 23 — prof',
        'card_body: small lit and boxed end',
      ]);
      expect(marksAt(v.state.doc, 'boxed')).toEqual(['emphasis_mark', 'highlight:cyan']);
      expect(marksAt(v.state.doc, 'small')).toEqual(['font_size']);
    });

    it(`a mid-body selection pastes inline with its marks (${wrapName} clipboard)`, () => {
      const s = sourceView();
      const { html, text } = copy(s, textPos(s, 'lit'), textPos(s, ' end'));
      const v = makeView('body-mid');
      paste(v, { 'text/html': wrap(html), 'text/plain': text });
      expect(blocks(v.state.doc)).toEqual(['tag: Existing tag', 'card_body: existing lit and boxedbody']);
      expect(marksAt(v.state.doc, 'lit')).toEqual(['highlight:yellow', 'underline_mark']);
    });
  }

  it('a cite→body selection lands inside the cursor card', () => {
    const s = sourceView();
    const { html, text } = copy(s, textPos(s, 'Smith'), textPos(s, ' end'));
    const v = makeView('body-end');
    paste(v, { 'text/html': html, 'text/plain': text });
    expect(v.state.doc.childCount).toBe(1);
    expect(blocks(v.state.doc)).toEqual([
      'tag: Existing tag',
      'card_body: existing body',
      'cite_paragraph: Smith 23 — prof',
      'card_body: small lit and boxed',
    ]);
  });
});

// ─── right-click menu Paste ──────────────────────────────────────────────────

describe('menu Paste (clipboard read by the app, not a paste event)', () => {
  it('Word HTML gets smart conversion, like a keyboard paste (was: formatting dropped)', () => {
    const v = makeView('body-end');
    pasteClipboardFlavors(v, WORD_BODY_ONLY, 'Feedback loops accelerate warming…');
    expect(marksAt(v.state.doc, 'accelerate')).toEqual(['highlight:yellow', 'underline_mark']);
    expect(marksAt(v.state.doc, 'nothing stops them')).toEqual(['emphasis_mark']);
  });

  it('PDF text-only clipboards reflow', () => {
    const v = makeView('empty-doc');
    pasteClipboardFlavors(v, '', PDF_CHROME);
    expect(blocks(v.state.doc)).toHaveLength(2);
  });
});

// ─── desktop fast-paste bridge (rich /insert) ───────────────────────────────

describe('fast-paste bridge rich insert', () => {
  it('our own copy from cite→body inserts into the cursor card — no empty-tag card', () => {
    const s = sourceView();
    const { html } = copy(s, textPos(s, 'Smith'), textPos(s, ' end'));
    const v = makeView('body-end');
    const tr = buildExternalRichInsertTransaction(v.state, { html, newParagraph: true })!;
    v.dispatch(tr);
    expect(blocks(v.state.doc)).toEqual([
      'tag: Existing tag',
      'card_body: existing body',
      'cite_paragraph: Smith 23 — prof',
      'card_body: small lit and boxed',
    ]);
  });

  it('our own copy of a few words inserts inline when newParagraph is false', () => {
    const s = sourceView();
    const { html } = copy(s, textPos(s, 'lit'), textPos(s, 'lit') + 3);
    const v = makeView('body-end');
    v.dispatch(buildExternalRichInsertTransaction(v.state, { html, newParagraph: false })!);
    expect(blocks(v.state.doc)).toEqual(['tag: Existing tag', 'card_body: existing bodylit']);
    expect(marksAt(v.state.doc, 'lit')).toEqual(['highlight:yellow', 'underline_mark']);
  });

  it('Google Docs HTML forwarded by a sender is smart-converted', () => {
    const v = makeView('body-end');
    v.dispatch(buildExternalRichInsertTransaction(v.state, { html: GDOCS_BODY, newParagraph: true })!);
    expect(marksAt(v.state.doc, 'two')).toEqual(['highlight:yellow', 'underline_mark']);
    expect(marksAt(v.state.doc, 'three')).toEqual(['emphasis_mark']);
  });
});
