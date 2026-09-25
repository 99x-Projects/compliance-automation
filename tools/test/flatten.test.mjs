// Reference flattener and contract rules that are easier to prove in code than with sample files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatten, MAX_EVENT_BYTES } from '../lib/flatten.mjs';
import { detailFiles, sha256, storedDetails } from '../lib/detail-files.mjs';
import { createValidators, loadCatalogs, loadSamples, validateEvents, validateReport } from '../lib/contracts.mjs';

const validators = createValidators();
const catalogs = loadCatalogs().map((c) => c.data);
const report = (name) => structuredClone(loadSamples('reports').find((s) => s.file === name).data);

test('one event per control, all sharing the execution as correlationId (F3)', () => {
  const r = report('iso-27001-2022--multi--synthetic.json');
  const events = flatten(r);
  assert.equal(events.length, r.controls.length);
  assert.deepEqual(new Set(events.map((e) => e.correlationId)), new Set([r.executionId]));
  assert.deepEqual(events.map((e) => e.dimensions.control), ['A.5.15', 'A.8.13']);
  assert.ok(events.every((e) => e.dimensions.runAt === r.runAt));
});

test('usage is attached to the first event only, so usage rollups never double count', () => {
  const events = flatten(report('iso-27001-2022--multi--synthetic.json'));
  assert.equal(events[0].dimensions.tokens, '{{metrics.tokens.total}}');
  assert.equal(events[1].dimensions.tokens, undefined);
  assert.equal(events[1].dimensions.costUsd, undefined);
});

test('counts, P0 actions and source confidence come from the report, not from the skill', () => {
  const [ev] = flatten(report('iso-9001-2015--8.1--hub-service.json'));
  assert.deepEqual(
    [ev.dimensions.conform, ev.dimensions.partial, ev.dimensions.gap, ev.dimensions.na],
    [1, 8, 2, 0],
  );
  assert.equal(ev.dimensions.p0Actions, 3);
  assert.equal(ev.dimensions.sourcesMode, 'implicit-git-repo');
});

test('a non-8.1 standard flattens and validates with no code changes (F14, contract side)', () => {
  const r = report('iso-27001-2022--multi--synthetic.json');
  assert.deepEqual(validateReport(validators, r, catalogs), []);
  assert.deepEqual(validateEvents(validators, flatten(r), catalogs), []);
  assert.equal(flatten(r)[0].obligations[1].originalVerdict, 'Not implemented');
});

test('an obligation count other than 11 is valid', () => {
  const [a, b] = flatten(report('iso-27001-2022--multi--synthetic.json'));
  assert.equal(a.obligations.length, 3);
  assert.equal(b.obligations.length, 1);
});

test('report Markdown over 200 KB is rejected', () => {
  const r = report('iso-9001-2015--8.1--the-agent.json');
  r.controls[0].reportMd = 'x'.repeat(204801);
  assert.match(validateReport(validators, r, catalogs).join('\n'), /must NOT have more than 204800 characters/);
});

test('events are summaries: evidence, sections and the Markdown report stay out of AI Hub (F17)', () => {
  const r = report('iso-9001-2015--8.1--hub-service.json');
  const [ev] = flatten(r);
  assert.equal(ev.reportMd, undefined);
  assert.equal(ev.sections, undefined);
  assert.ok(ev.obligations.every((o) => o.evidence === undefined));
  assert.deepEqual(ev.obligations.map((o) => o.evidenceCount), r.controls[0].obligations.map((o) => o.evidence.length));
  for (const name of ['iso-9001-2015--8.1--hub-service.json', 'iso-9001-2015--8.1--the-agent.json']) {
    const bytes = Buffer.byteLength(JSON.stringify(flatten(report(name))[0]));
    assert.ok(bytes < MAX_EVENT_BYTES, `${name} event is ${bytes} bytes`);
  }
});

test('long gap lines and summaries are cut, not rejected; the full text is in the detailed report', () => {
  const r = report('iso-9001-2015--8.1--the-agent.json');
  r.controls[0].obligations[0].gap = 'g'.repeat(1500);
  r.controls[0].summary = 's'.repeat(3500);
  const [ev] = flatten(r);
  assert.equal(ev.obligations[0].gap.length, 300);
  assert.ok(ev.obligations[0].gap.endsWith('…'));
  assert.equal(ev.summary.length, 2000);
  assert.deepEqual(validateEvents(validators, [ev], catalogs), []);
});

test('without a stored detail the event says so, and still validates', () => {
  const [ev] = flatten(report('iso-9001-2015--8.1--hub-service.json'));
  assert.equal(ev.detail.status, 'disabled');
  assert.deepEqual(validateEvents(validators, [ev], catalogs), []);
});

test('a stored detail links each control to its own file by commit permalink and hash (F18)', () => {
  const r = report('iso-27001-2022--multi--synthetic.json');
  const commit = 'a'.repeat(40);
  const details = storedDetails(r, { repository: r.repository, branch: 'compliance-audits', commit });
  const events = flatten(r, { details });
  const files = detailFiles(r);
  events.forEach((ev, i) => {
    assert.equal(ev.detail.path, files.controls[i].path);
    assert.equal(ev.detail.url, `https://github.com/${r.repository}/blob/${commit}/${files.controls[i].path}`);
    assert.equal(ev.detail.sha256, sha256(files.controls[i].content));
  });
  assert.match(files.folder, /^audits\/iso-27001-2022\/20260920T093000Z--exec-sample-27001$/);
  assert.deepEqual(validateEvents(validators, events, catalogs), []);
});
