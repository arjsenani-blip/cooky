/**
 * Case mode: tag → argument role, contention grouping, missing-piece
 * detection, and the AI verdict parser. Plus Evidence Search's card
 * extraction from a parsed caselist file.
 */

import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';
import {
  analyzeHeuristic,
  applyVerdict,
  classifyTag,
  parseVerdict,
  readCase,
} from '../../src/editor/case-mode/analyze.js';
import { extractCards, insertableCard, scoreCard, terms } from '../../src/editor/evidence/caselist.js';

const block = (t: string) => schema.nodes['block']!.create({ id: newHeadingId() }, schema.text(t));
const pocket = (t: string) => schema.nodes['pocket']!.create({ id: newHeadingId() }, schema.text(t));
const hat = (t: string) => schema.nodes['hat']!.create({ id: newHeadingId() }, schema.text(t));
const para = (t: string) => schema.nodes['paragraph']!.create(null, schema.text(t));
const card = (tag: string, body = 'text', cite?: string) =>
  schema.nodes['card']!.createChecked(null, [
    schema.nodes['tag']!.create({ id: newHeadingId() }, tag ? schema.text(tag) : null),
    ...(cite ? [schema.nodes['cite_paragraph']!.create(null, schema.text(cite, [schema.marks['cite_mark']!.create()]))] : []),
    schema.nodes['card_body']!.create(null, schema.text(body)),
  ]);
const doc = (...c: PMNode[]) => schema.nodes['doc']!.createChecked(null, c);

describe('classifyTag', () => {
  it('reads explicit labels', () => {
    expect(classifyTag('UQ: tariffs high', 2, 3)).toBe('uniqueness');
    expect(classifyTag('Link – affirming raises prices', 0, 3)).toBe('link');
    expect(classifyTag('IL: prices crush demand', 0, 3)).toBe('internal-link');
    expect(classifyTag('Impact: recession', 0, 3)).toBe('impact');
  });
  it('reads cues', () => {
    expect(classifyTag('Tariffs are rising now', 0, 3)).toBe('uniqueness');
    expect(classifyTag('Affirming causes a trade war', 1, 3)).toBe('link');
    expect(classifyTag('Lack of coverage kills 45,000 people a year', 2, 3)).toBe('impact');
  });
});

describe('telling arguments from formatting', () => {
  it('skips a fill-in round title and takes the contention from "1. Escalation"', () => {
    const d = doc(
      pocket('Round __ of ___ Acton Boxborough SV(Pro __) vs ____(Con ___)'),
      para('1. Escalation'),
      card('Nuclear risks are rising now'),
      card('Affirming escalates tensions with China'),
    );
    const cs = readCase(d);
    expect(cs.map((c) => c.title)).toEqual(['Escalation']);
    expect(cs[0]!.cards).toHaveLength(2);
    const gaps = analyzeHeuristic(d).contentions[0]!.gaps;
    expect(gaps.every((g) => !g.suggestion.includes('Round'))).toBe(true);
  });

  it('flags nothing while a contention\'s only card has no tag', () => {
    const d = doc(pocket('Round __ of ___ X vs ___'), para('1. Escalation'), card('', 'body', 'SIPRI 26'));
    const a = analyzeHeuristic(d);
    expect(a.contentions[0]!.title).toBe('Escalation');
    expect(a.contentions[0]!.gaps).toEqual([]);
  });

  it('reads role headings as labels for their cards, not as contentions', () => {
    const d = doc(
      hat('Contention 1: Economy'),
      block('Uniqueness'),
      card('Tariffs stay put'),
      block('Link'),
      card('Exports suffer'),
      block('Impact'),
      card('Jobs vanish'),
    );
    const cs = readCase(d);
    expect(cs.map((c) => c.title)).toEqual(['Contention 1: Economy']);
    expect(cs[0]!.cards.map((k) => k.role)).toEqual(['uniqueness', 'link', 'impact']);
    expect(analyzeHeuristic(d).contentions[0]!.gaps).toEqual([]);
  });

  it('keeps sub-headings inside their "Contention N"', () => {
    const d = doc(
      pocket('Pro case'),
      hat('Contention 1: Escalation'),
      card('Tensions with China are rising now'),
      block('Taiwan flashpoint'),
      card('Affirming triggers a blockade'),
      hat('Contention 2: Economy'),
      card('Lack of trade kills 10,000 jobs'),
    );
    expect(readCase(d).map((c) => [c.title, c.cards.length])).toEqual([
      ['Contention 1: Escalation', 2],
      ['Contention 2: Economy', 1],
    ]);
  });
});

describe('case analysis', () => {
  const d = doc(
    block('Contention 1: Economy'),
    card('Tariffs are rising now'),
    card('Affirming causes a trade war'),
    block('Contention 2: Health'),
    card('Uninsured rates are at a record high now'),
    card('Lack of coverage kills 45,000 people a year'),
  );

  it('groups cards under their contention', () => {
    const cs = readCase(d);
    expect(cs.map((c) => c.title)).toEqual(['Contention 1: Economy', 'Contention 2: Health']);
    expect(cs.map((c) => c.cards.map((k) => k.role))).toEqual([
      ['uniqueness', 'link'],
      ['uniqueness', 'impact'],
    ]);
  });

  it('flags the missing piece where it belongs', () => {
    const a = analyzeHeuristic(d);
    const [c1, c2] = a.contentions;
    expect(c1!.gaps.map((g) => g.role)).toEqual(['impact']);
    expect(c1!.gaps[0]!.at).toBe(c1!.cards[1]!.end);
    expect(c2!.gaps.map((g) => g.role)).toEqual(['link']);
    // Between the uniqueness card and the impact card.
    expect(c2!.gaps[0]!.at).toBe(c2!.cards[0]!.end);
  });

  it('parses and applies an AI verdict', () => {
    const v = parseVerdict(
      '[[ROLES]]\n1 | uniqueness\n2 | link\n3 | uniqueness\n4 | impact\n[[GAPS]]\n1 | impact | 2 | Evidence that a trade war causes a recession\n[[END]]',
      4,
    );
    const a = applyVerdict(readCase(d), v);
    expect(a.refined).toBe(true);
    expect(a.contentions[0]!.gaps).toEqual([
      { role: 'impact', at: a.contentions[0]!.cards[1]!.end, suggestion: 'Evidence that a trade war causes a recession' },
    ]);
    expect(a.contentions[1]!.gaps).toEqual([]);
  });
});

describe('evidence cards', () => {
  it('extracts cards with their section and cite', () => {
    const d = doc(block('Tariffs DA'), card('Tariffs raise prices', 'Consumer prices rose 3%.', 'Smith 24'));
    const cards = extractCards(d, 'hspf25/School/Team/file.docx');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ tag: 'Tariffs raise prices', cite: 'Smith 24', section: 'Tariffs DA', body: 'Consumer prices rose 3%.' });
    const fresh = insertableCard(cards[0]!);
    expect(fresh.firstChild!.attrs['id']).not.toBe(cards[0]!.node.firstChild!.attrs['id']);
    expect(fresh.textContent).toBe(cards[0]!.node.textContent);
  });

  it('scores tag hits above body hits', () => {
    const d = doc(card('Tariffs raise prices', 'unrelated'), card('Unrelated', 'tariffs raise prices'));
    const [a, b] = extractCards(d, 'f.docx');
    const w = terms('tariffs raise prices');
    expect(scoreCard(a!, w)).toBeGreaterThan(scoreCard(b!, w));
  });
});
