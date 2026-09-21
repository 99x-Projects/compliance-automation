// Publisher behaviour, offline: fitness functions F3 (publisher side) and F4, plus delivery,
// fallback and configuration handling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../lib/publisher/run.mjs';
import { buildIssueComment, parseIssueComment } from '../lib/publisher/deliver.mjs';
import { normaliseRepository, finalizeReport, MAX_REPORT_MD } from '../lib/publisher/finalize.mjs';
import { loadSamples } from '../lib/contracts.mjs';
import { CATALOGS } from '../lib/contract-data.mjs';

const sample = (name) => structuredClone(loadSamples('reports').find((s) => s.file === name).data);
const ALL_CATALOGS = Object.values(CATALOGS);
const PUBLISH_ENV = {
  AIHUB_PUBLISH: '1',
  AIHUB_URL: 'https://ai-hub-api.example.test',
  AIHUB_NODE_ID: 'nd_9lcgvLaCAP',
  AIHUB_ACTIVITY_ID: 'na_NfPIrObtec',
  'AIHUB-API-KEY': 'ah_tm_testkey1234567890',
  EXECUTION_ID: 'exec-test-1',
};

function harness({ report, env = {}, responses = [], argv = [] }) {
  const files = new Map();
  if (report) files.set('compliance-report.json', JSON.stringify(report));
  const calls = [];
  const logs = [];
  const queue = [...responses];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    const next = queue.shift() ?? { status: 201, body: '{}' };
    if (next.throws) throw new Error(next.throws);
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      text: async () => next.body ?? '',
      json: async () => JSON.parse(next.body ?? '{}'),
    };
  };
  const deps = {
    readText: async (p) => {
      if (!files.has(p)) throw new Error(`ENOENT ${p}`);
      return files.get(p);
    },
    writeText: async (p, t) => files.set(p, t),
    gitInfo: async () => ({ remote: 'https://github.com/99x-Internal/AI-Hub.git', commit: 'e59aaa7', ref: 'development' }),
    fetchImpl,
    sleep: async () => {},
    now: () => new Date('2026-09-21T12:00:00Z'),
    log: (m) => logs.push(m),
    pluginVersion: 'operation@0.1.0',
    catalogs: ALL_CATALOGS,
  };
  return { go: () => run({ argv, env, deps }), files, calls, logs };
}

const events = (h) => JSON.parse(h.files.get('aihub-event.json'));

test('provenance comes from the environment and git, never from the skill (F3)', async () => {
  const report = sample('iso-9001-2015--8.1--ai-hub.json');
  report.executionId = 'pending';
  report.pluginVersion = 'made-up';
  report.baseline = { ref: 'whatever', commit: 'deadbee' };
  report.repository = 'someone/else';
  const h = harness({ report, env: { EXECUTION_ID: 'exec-42' } });
  assert.equal(await h.go(), 0);
  const [e] = events(h);
  assert.equal(e.correlationId, 'exec-42');
  assert.equal(e.eventId, 'iso-9001-2015:8.1:99x-internal/ai-hub:exec-42');
  assert.deepEqual(
    [e.dimensions.repository, e.dimensions.commit, e.dimensions.baselineRef, e.dimensions.pluginVersion],
    ['99x-internal/ai-hub', 'e59aaa7', 'development', 'operation@0.1.0'],
  );
  assert.equal(h.calls.length, 0, 'publishing is off by default');
});

test('a local run without EXECUTION_ID gets a stable local id', async () => {
  const h = harness({ report: sample('iso-9001-2015--8.1--the-agent.json') });
  assert.equal(await h.go(), 0);
  assert.equal(events(h)[0].correlationId, 'local-20260921T120000Z-ai-hub');
});

test('a multi-control run becomes one event per control with shared correlationId (F3)', async () => {
  const h = harness({ report: sample('iso-27001-2022--multi--synthetic.json'), env: { EXECUTION_ID: 'exec-multi' } });
  assert.equal(await h.go(), 0);
  const out = events(h);
  assert.deepEqual(out.map((e) => e.dimensions.control), ['A.5.15', 'A.8.13']);
  assert.ok(out.every((e) => e.correlationId === 'exec-multi'));
  assert.ok(out[0].dimensions.tokens !== undefined && out[1].dimensions.tokens === undefined);
});

test('secrets never leave the run: env values and known token formats are redacted (F4)', async () => {
  const report = sample('iso-9001-2015--8.1--ai-hub.json');
  report.controls[0].obligations[0].gap = 'Found ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123 in a script';
  report.controls[0].summary = `Connection string: ${'Server=db;Password=Sup3rS3cret!'}`;
  report.controls[0].reportMd += '\n-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----\n';
  const env = {
    ...PUBLISH_ENV,
    DB_CONNECTION: 'Server=db;Password=Sup3rS3cret!',
    AIHUB_FALLBACK_ISSUE: 'o/r#1',
    GITHUB_TOKEN: 'ghp_realtoken0123456789abcdefghij',
  };
  // Hub rejects the POST, so the events also travel through the fallback comment.
  const h = harness({ report, env, responses: [{ status: 400, body: 'bad' }, { status: 201, body: '{"html_url":"https://github.com/o/r/issues/1#issuecomment-9"}' }] });
  assert.equal(await h.go(), 0);
  assert.equal(h.calls.length, 2);

  const written = h.files.get('aihub-event.json');
  const posted = h.calls.map((c) => c.init.body ?? '').join('\n');
  const logged = h.logs.join('\n');
  for (const secret of ['ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123', 'Sup3rS3cret!', 'BEGIN RSA PRIVATE KEY', 'ah_tm_testkey1234567890', 'ghp_realtoken']) {
    assert.ok(!written.includes(secret), `event file contains ${secret}`);
    assert.ok(!posted.includes(secret), `a request body contains ${secret}`);
    assert.ok(!logged.includes(secret), `logs contain ${secret}`);
  }
  assert.match(written, /\[REDACTED\]/);
  assert.match(logged, /removed \d+ secret-looking value/);
});

test('reportMd over 200 KB is truncated with a marker, not rejected', () => {
  const report = sample('iso-9001-2015--8.1--the-agent.json');
  report.controls[0].reportMd = 'x'.repeat(MAX_REPORT_MD + 5000);
  const { report: out, notes } = finalizeReport(report, { git: {}, now: new Date(), pluginVersion: 'p' });
  assert.equal(out.controls[0].reportMd.length, MAX_REPORT_MD);
  assert.match(out.controls[0].reportMd, /truncated to 200 KB/);
  assert.equal(notes.length, 1);
});

test('an invalid report exits 2 with the contract errors, and nothing is sent', async () => {
  const report = sample('iso-9001-2015--8.1--ai-hub.json');
  report.controls[0].control = '8.9';
  const h = harness({ report, env: PUBLISH_ENV });
  assert.equal(await h.go(), 2);
  assert.match(h.logs.join('\n'), /not in the iso-9001-2015 catalogue/);
  assert.equal(h.calls.length, 0);
  assert.equal(h.files.has('aihub-event.json'), false);
});

test('all contract problems are reported in one pass, with the allowed values', async () => {
  const report = sample('iso-9001-2015--8.1--ai-hub.json');
  report.controls[0].obligations[1].verdict = 'partial';
  report.controls[0].actions[0].closes = ['5'];
  report.controls[0].obligations[3].evidence[0].sourceId = 'repo';
  const h = harness({ report });
  assert.equal(await h.go(), 2);
  const out = h.logs.join('\n');
  assert.match(out, /verdict must be equal to one of the allowed values: "Conform", "Partial", "Gap", "N\/A"/);
  assert.match(out, /closes\/0 must be integer/);
  assert.match(out, /cites source 'repo'/, 'semantic errors must not wait for a second run');
  assert.doesNotMatch(out, /closes obligation 5, which does not exist/);
});

test('a missing report exits 2', async () => {
  const h = harness({});
  assert.equal(await h.go(), 2);
  assert.match(h.logs.join('\n'), /could not read compliance-report.json/);
});

test('delivery POSTs the events with the API-key header', async () => {
  const h = harness({ report: sample('iso-9001-2015--8.1--ai-hub.json'), env: PUBLISH_ENV });
  assert.equal(await h.go(), 0);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, 'https://ai-hub-api.example.test/metrics/nodes/nd_9lcgvLaCAP/node-activities/na_NfPIrObtec/events');
  assert.equal(h.calls[0].init.headers['X-Api-Key'], 'ah_tm_testkey1234567890');
  assert.ok(!h.calls[0].url.includes('whs_'), 'never the secret-in-URL route');
});

test('5xx and network errors are retried; success on the third attempt', async () => {
  const h = harness({
    report: sample('iso-9001-2015--8.1--ai-hub.json'), env: PUBLISH_ENV,
    responses: [{ status: 503 }, { throws: 'ECONNRESET' }, { status: 201 }],
  });
  assert.equal(await h.go(), 0);
  assert.equal(h.calls.length, 3);
  assert.match(h.logs.join('\n'), /delivered to AI Hub \(201\) after 3 attempt/);
});

test('a 4xx is not retried; results are preserved in the fallback issue comment', async () => {
  const env = { ...PUBLISH_ENV, AIHUB_FALLBACK_ISSUE: 'org/product#12', 'GITHUB-TOKEN': 'ghp_x0123456789abcdefghijklmnop' };
  const h = harness({
    report: sample('iso-9001-2015--8.1--ai-hub.json'), env,
    responses: [{ status: 401, body: 'invalid key' }, { status: 201, body: '{"html_url":"https://github.com/org/product/issues/12#issuecomment-7"}' }],
  });
  assert.equal(await h.go(), 0);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].url, 'https://api.github.com/repos/org/product/issues/12/comments');
  const body = JSON.parse(h.calls[1].init.body).body;
  assert.deepEqual(parseIssueComment(body), events(h));
});

test('if the fallback fails too, the run exits 4', async () => {
  const h = harness({ report: sample('iso-9001-2015--8.1--ai-hub.json'), env: PUBLISH_ENV, responses: [{ status: 400 }] });
  assert.equal(await h.go(), 4);
});

test('--from-issue re-sends the events from a fallback comment', async () => {
  const saved = JSON.parse(JSON.stringify((await (async () => {
    const h = harness({ report: sample('iso-9001-2015--8.1--the-agent.json') });
    await h.go();
    return events(h);
  })())));
  const comment = buildIssueComment(saved, 'test');
  const h = harness({
    env: { ...PUBLISH_ENV, GITHUB_TOKEN: 'ghp_x0123456789abcdefghijklmnop' },
    argv: ['--from-issue', 'https://github.com/org/product/issues/12#issuecomment-7'],
    responses: [{ status: 200, body: JSON.stringify({ body: comment }) }, { status: 201 }],
  });
  assert.equal(await h.go(), 0);
  assert.equal(h.calls[0].url, 'https://api.github.com/repos/org/product/issues/comments/7');
  assert.deepEqual(JSON.parse(h.calls[1].init.body), saved);
});

test('an oversize fallback comment drops reportMd but keeps every result', () => {
  const report = sample('iso-9001-2015--8.1--ai-hub.json');
  const big = [{ correlationId: 'x', reportMd: 'y'.repeat(70000), obligations: report.controls[0].obligations }];
  const body = buildIssueComment(big, 'too big');
  assert.ok(body.length <= 65536);
  const parsed = parseIssueComment(body);
  assert.equal(parsed[0].obligations.length, 11);
  assert.match(parsed[0].reportMd, /omitted/);
});

test('--check: publishing off is fine; bad config exits 3; an unreachable Hub only warns', async () => {
  assert.equal(await harness({ argv: ['--check'] }).go(), 0);
  assert.equal(await harness({ argv: ['--check'], env: { AIHUB_PUBLISH: '1', AIHUB_URL: 'http://evil.test' } }).go(), 3);
  const h = harness({ argv: ['--check'], env: PUBLISH_ENV, responses: [{ throws: 'ENOTFOUND' }] });
  assert.equal(await h.go(), 0);
  assert.match(h.logs.join('\n'), /did not answer/);
});

test('repository names are normalised from any remote form', () => {
  assert.equal(normaliseRepository('https://github.com/99x-Internal/AI-Hub.git'), '99x-internal/ai-hub');
  assert.equal(normaliseRepository('git@github.com:xianix-team/the-agent.git'), 'xianix-team/the-agent');
  assert.equal(normaliseRepository('https://dev.azure.com/Org/Proj/_git/Repo'), 'org/repo');
  assert.equal(normaliseRepository('https://user@dev.azure.com/Org/Proj/_git/Repo'), 'org/repo');
});
