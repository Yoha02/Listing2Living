import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntakeDialog, RoomEvidencePanel, sameListing } from '../src/PropertyEvidence';
import type { IntakeReport, RoomAssessment, SceneSpec } from '../shared/types';
import fixture from '../shared/brannan.json';

const noop = () => {};
const url = 'https://www.zillow.com/homedetails/200-Brannan-St/69817820_zpid/';
const report: IntakeReport = {
  id: 'brannan',
  url,
  title: 'Brannan',
  status: 'ready',
  summary: 'Sources are available.',
  checks: [],
  sources: [],
  roomHints: [],
  createdAt: '2026-10-25T20:00:00Z',
};
const renderIntake = (value: string, intake = report, pending = false) =>
  renderToStaticMarkup(
    createElement(IntakeDialog, {
      url: value,
      onUrl: noop,
      intake,
      pending,
      checking: pending,
      onCheck: noop,
      onBuild: noop,
      onClose: noop,
    }),
  );

test('listing identity accepts the same Zillow property with a different slug, but not a different property', () => {
  assert.equal(
    sameListing(url, 'https://zillow.com/homedetails/another-slug/69817820_zpid/?utm_source=demo'),
    true,
  );
  assert.equal(sameListing(url, 'https://www.zillow.com/homedetails/15168051_zpid/'), false);
});

test('a ready report cannot authorize another listing or bypass an in-progress check', () => {
  const ready = renderIntake(url);
  assert.match(ready, /<button class="primary-button">Build from these sources/);
  const mismatch = renderIntake('https://www.zillow.com/homedetails/15168051_zpid/');
  assert.match(mismatch, /<button class="primary-button" disabled="">Build from these sources/);
  assert.doesNotMatch(mismatch, /Sources are available/);
  assert.match(
    renderIntake(url, report, true),
    /<button class="primary-button" disabled="">Build from these sources/,
  );
  assert.match(
    renderIntake(url, { ...report, status: 'needs-input' }),
    /<button class="primary-button" disabled="">Build from these sources/,
  );
});

const scene = structuredClone(fixture) as SceneSpec;
scene.revision = 8;
scene.rooms = [
  {
    id: 'living',
    name: 'Living room',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
    floorZ: 0,
    ceilingHeight: 2.8,
  },
  {
    id: 'bedroom',
    name: 'Upstairs bedroom',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
    floorZ: 2.85,
    ceilingHeight: 2.65,
  },
];
scene.sources = [
  {
    id: 'bedroom-photo',
    label: 'Bedroom evidence photo',
    url: '/bedroom.jpg',
    kind: 'photo',
    roomIds: ['bedroom'],
  },
];
scene.notes = [];
const assessment: RoomAssessment = {
  roomId: 'living',
  roomName: 'Living room',
  revision: 8,
  status: 'ready-for-human-review',
  sourceIds: [],
  scores: { layout: 90, objects: 90, materials: 90 },
  summary: 'Room review.',
  recommendations: [],
};
const renderEvidence = (current: SceneSpec, reviews: RoomAssessment[]) =>
  renderToStaticMarkup(
    createElement(RoomEvidencePanel, {
      scene: current,
      reviews,
      floorZ: 0,
      pending: false,
      canReview: true,
      onSource: noop,
      onRefresh: noop,
      onReview: noop,
      onRepair: noop,
    }),
  );

test('a room without a matched photo never appears verified, even if its assessment says ready', () => {
  const html = renderEvidence(scene, [assessment]);
  assert.match(html, /Photo evidence missing/);
  assert.doesNotMatch(html, /Ready for your judgement/);
  assert.doesNotMatch(html, /room-score-row/);
  assert.doesNotMatch(html, /Bedroom evidence photo/);
});

test('room reviews expose stale revisions and do not enable finish repair for stale scores', () => {
  const current = structuredClone(scene);
  current.sources.push({
    id: 'living-photo',
    label: 'Living evidence',
    kind: 'photo',
    url: '/living.jpg',
    roomIds: ['living'],
  });
  const html = renderEvidence(current, [
    { ...assessment, revision: 7, scores: { ...assessment.scores, materials: 40 } },
  ]);
  assert.match(html, /Review needs updating/);
  assert.match(html, /Revision 7 review/);
  assert.match(html, /class="room-refine-button" disabled=""/);
});
