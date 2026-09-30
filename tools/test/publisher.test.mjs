// Publisher behaviour, offline: fitness functions F3 (publisher side) and F4, plus delivery,
// fallback and configuration handling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../lib/publisher/run.mjs';
import { buildIssueComment, buildIssueComments, parseIssueComment, DETAIL_MARKER } from '../lib/publisher/deliver.mjs';
import { sha256 } from '../lib/detail-files.mjs';
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

// An in-memory GitHub Git Data API: refs, commits and trees, enough to prove what gets committed.
// fail: { '<METHOD> <step>': status } makes one step answer with an error, `times` times.
function fakeGit({ branchExists = false, fail = {} } = {}) {
  const state = { refs: new Map(), commits: new Map(), trees: new Map(), requests: [], n: 0 };
  const sha = () => (state.n += 1).toString(16).padStart(40, '0');
  if (branchExists) {
    state.trees.set('t0', new Map([['audits/old/run/8.1.md', 'old\n']]));
    state.commits.set('c'.repeat(40), { tree: 't0', parents: [] });
    state.refs.set('compliance-audits', 'c'.repeat(40));
  }
  const failures = Object.fromEntries(Object.entries(fail).map(([k, v]) => [k, typeof v === 'number' ? { status: v, times: 1 } : v]));
  const failed = (key) => {
    const f = failures[key];
    if (!f || f.times <= 0) return null;
    f.times -= 1;
    return f.status;
  };
  const reply = (status, body = {}) => ({ status, body: JSON.stringify(body) });
  state.handle = (url, init) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    const path = url.replace(/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/git\//, '');
    state.requests.push({ method, path, body, auth: init.headers?.Authorization });
    let m;
    if (method === 'GET' && (m = /^ref\/heads\/(.+)$/.exec(path))) {
      const status = failed('GET ref');
      if (status) return reply(status);
      return state.refs.has(m[1]) ? reply(200, { object: { sha: state.refs.get(m[1]) } }) : reply(404);
    }
    if (method === 'GET' && (m = /^commits\/(\w+)$/.exec(path))) return reply(200, { tree: { sha: state.commits.get(m[1]).tree } });
    if (method === 'POST' && path === 'trees') {
      const status = failed('POST trees');
      if (status) return reply(status);
      const tree = new Map(body.base_tree ? state.trees.get(body.base_tree) : []);
      for (const e of body.tree) tree.set(e.path, e.content);
      const id = sha();
      state.trees.set(id, tree);
      return reply(201, { sha: id });
    }
    if (method === 'POST' && path === 'commits') {
      const id = sha();
      state.commits.set(id, { tree: body.tree, parents: body.parents, message: body.message });
      return reply(201, { sha: id });
    }
    if ((method === 'PATCH' && (m = /^refs\/heads\/(.+)$/.exec(path))) || (method === 'POST' && path === 'refs')) {
      const status = failed('move branch');
      if (status) return reply(status);
      const name = m ? m[1] : body.ref.replace('refs/heads/', '');
      const parent = state.commits.get(body.sha).parents[0];
      if (state.refs.get(name) !== parent && !(body.force)) return reply(422, { message: 'Update is not a fast forward' });
      state.refs.set(name, body.sha);
      return reply(m ? 200 : 201, { object: { sha: body.sha } });
    }
    return reply(500, { message: `fake git: no route for ${method} ${path}` });
  };
  state.fileAt = (branch, path) => state.trees.get(state.commits.get(state.refs.get(branch)).tree).get(path);
  return state;
}

// An in-memory AI Hub artifact store with the rules of the real one: the server hashes what it
// stores, the same key with the same content returns the first artifact, and the same key with
// different content is refused. fail: a list of statuses answered first, one per request.
function fakeHub({ fail = [], tamper = false } = {}) {
  const state = { artifacts: new Map(), requests: [], n: 0 };
  const failures = [...fail];
  const reply = (status, body = {}) => ({ status, body: JSON.stringify(body) });
  state.handle = (url, init) => {
    const body = JSON.parse(init.body);
    state.requests.push({ url, key: init.headers?.['X-Api-Key'], body });
    const failure = failures.shift();
    if (failure === 'network') return { throws: 'ECONNRESET' };
    if (failure) return reply(failure, { error: `fake hub: ${failure}` });
    if (Buffer.byteLength(body.content) > 512 * 1024) return reply(400, { error: 'content must be at most 512 KB.' });
    const hash = tamper ? 'f'.repeat(64) : sha256(body.content);
    const existing = state.artifacts.get(body.key);
    if (existing) {
      return existing.sha256 === hash
        ? reply(200, { artifactId: existing.artifactId, sha256: hash, byteSize: existing.byteSize, created: false })
        : reply(409, { error: 'An artifact with this key already exists with different content.' });
    }
    const artifact = { artifactId: `art_${String(state.n += 1).padStart(10, '0')}`, sha256: hash, byteSize: Buffer.byteLength(body.content), content: body.content };
    state.artifacts.set(body.key, artifact);
    return reply(201, { artifactId: artifact.artifactId, sha256: hash, byteSize: artifact.byteSize, created: true });
  };
  return state;
}

function harness({ report, env = {}, responses = [], argv = [], git = fakeGit(), hub = fakeHub(), files: seed = {} }) {
  const files = new Map(Object.entries(seed));
  if (report) files.set('compliance-report.json', JSON.stringify(report));
  const calls = [];
  const logs = [];
  const queue = [...responses];
  const fetchImpl = async (url, init = {}) => {
    // `calls` keeps what it always held — the events POST and GitHub issue comments — so the
    // delivery tests below read the same whichever store the detailed report went to.
    const routed = /\/git\//.test(url) ? git.handle(url, init) : /\/artifacts$/.test(url) ? hub.handle(url, init) : null;
    if (!routed) calls.push({ url, init });
    const next = routed ?? queue.shift() ?? { status: 201, body: '{}' };
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
  return { go: () => run({ argv, env, deps }), files, calls, logs, git, hub };
}

// Storing the detail in a repository is opt-in: these tests ask for it explicitly,
// because the default is off (the audited repository is usually the customer's).
const WITH_GITHUB = { ...PUBLISH_ENV, COMPLIANCE_DETAIL_STORE: 'github', GITHUB_TOKEN: 'ghp_x0123456789abcdefghijklmnop' };

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
    // Opt in to the repository store on purpose: this test must cover every path out of the run.
    COMPLIANCE_DETAIL_STORE: 'github',
    GITHUB_TOKEN: 'ghp_realtoken0123456789abcdefghij',
  };
  // The detailed report is committed, and Hub rejects the POST, so the events also travel
  // through the fallback comment: every path out of the run is checked.
  const h = harness({ report, env, responses: [{ status: 400, body: 'bad' }, { status: 201, body: '{"html_url":"https://github.com/o/r/issues/1#issuecomment-9"}' }] });
  assert.equal(await h.go(), 0);
  assert.equal(h.calls.length, 2);
  assert.ok(h.git.requests.some((r) => r.path === 'trees'), 'the detailed report was committed');

  const written = h.files.get('aihub-event.json');
  const posted = [...h.calls.map((c) => c.init.body ?? ''), ...h.git.requests.map((r) => JSON.stringify(r.body ?? ''))].join('\n');
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

test('events too large for one fallback comment are split into parts, each re-sendable', () => {
  const event = { correlationId: 'x', summary: 'y'.repeat(9000) };
  const many = Array.from({ length: 20 }, (_, i) => ({ ...event, eventId: `e${i}` }));
  const bodies = buildIssueComments(many, 'too big');
  assert.ok(bodies.length > 1);
  assert.ok(bodies.every((b) => b.length <= 65536));
  assert.match(bodies[0], /part 1 of \d+/);
  assert.deepEqual(bodies.flatMap(parseIssueComment).map((e) => e.eventId), many.map((e) => e.eventId));
  assert.equal(buildIssueComments(many.slice(0, 1), 'x').length, 1);
});

test('the detailed report is committed to a new compliance-audits branch before the summary is sent', async () => {
  const h = harness({ report: sample('iso-9001-2015--8.1--ai-hub.json'), env: WITH_GITHUB });
  assert.equal(await h.go(), 0);
  const [ev] = events(h);
  assert.equal(ev.detail.status, 'stored');
  assert.equal(ev.detail.repository, '99x-internal/ai-hub');
  assert.equal(ev.detail.branch, 'compliance-audits');
  assert.equal(ev.detail.url, `https://github.com/99x-internal/ai-hub/blob/${ev.detail.commit}/${ev.detail.path}`);
  assert.equal(ev.detail.path, 'audits/iso-9001-2015/20260921T110000Z--exec-test-1/8.1.md');

  const stored = h.git.fileAt('compliance-audits', ev.detail.path);
  assert.equal(sha256(stored), ev.detail.sha256, 'the hash in AI Hub matches the committed file');
  const json = JSON.parse(h.git.fileAt('compliance-audits', 'audits/iso-9001-2015/20260921T110000Z--exec-test-1/compliance-report.json'));
  assert.equal(json.executionId, 'exec-test-1', 'the full report is committed with provenance filled');
  assert.equal(json.controls[0].obligations[0].evidence.length, 3);

  const created = h.git.requests.find((r) => r.method === 'POST' && r.path === 'commits');
  assert.deepEqual(created.body.parents, [], 'a new branch shares no history with the code');
  assert.match(created.body.message, /8\.1 Gap/);
  assert.ok(h.git.requests.every((r) => r.auth === 'Bearer ghp_x0123456789abcdefghijklmnop'));
  assert.ok(h.git.requests.every((r) => r.method !== 'PATCH' || r.body.force === false), 'never force-pushes');
  assert.equal(h.calls.length, 1, 'then the summary goes to AI Hub');
  assert.equal(JSON.parse(h.calls[0].init.body)[0].detail.commit, ev.detail.commit);
});

test('an existing compliance-audits branch gets a new commit on top, keeping earlier audits', async () => {
  const git = fakeGit({ branchExists: true });
  const h = harness({ report: sample('iso-9001-2015--8.1--the-agent.json'), env: WITH_GITHUB, git });
  assert.equal(await h.go(), 0);
  const created = git.requests.find((r) => r.method === 'POST' && r.path === 'commits');
  assert.deepEqual(created.body.parents, ['c'.repeat(40)]);
  assert.equal(git.fileAt('compliance-audits', 'audits/old/run/8.1.md'), 'old\n');
});

test('when another run moves the branch first, the commit is retried on top of it', async () => {
  const git = fakeGit({ branchExists: true, fail: { 'move branch': 422 } });
  const h = harness({ report: sample('iso-9001-2015--8.1--the-agent.json'), env: WITH_GITHUB, git });
  assert.equal(await h.go(), 0);
  assert.equal(events(h)[0].detail.status, 'stored');
  assert.equal(git.requests.filter((r) => r.path === 'trees').length, 2);
});

test('COMPLIANCE_DETAIL_REPO and _BRANCH send the detail elsewhere', async () => {
  const env = { ...WITH_GITHUB, COMPLIANCE_DETAIL_REPO: 'Org/Audit-Records', COMPLIANCE_DETAIL_BRANCH: 'iso/audits' };
  const git = fakeGit();
  const h = harness({ report: sample('iso-9001-2015--8.1--ai-hub.json'), env, git });
  assert.equal(await h.go(), 0);
  const [ev] = events(h);
  assert.equal(ev.detail.repository, 'org/audit-records');
  assert.equal(ev.detail.branch, 'iso/audits');
  assert.match(ev.detail.url, /^https:\/\/github\.com\/org\/audit-records\/blob\//);
});

test('a failed commit is a warning: the report goes to the issue, and the summary still reaches AI Hub', async () => {
  const env = { ...WITH_GITHUB, AIHUB_FALLBACK_ISSUE: 'org/product#12' };
  const git = fakeGit({ fail: { 'POST trees': { status: 403, times: 9 } } });
  const h = harness({
    report: sample('iso-9001-2015--8.1--ai-hub.json'), env, git,
    responses: [{ status: 201, body: '{"html_url":"https://github.com/org/product/issues/12#issuecomment-5"}' }, { status: 201 }],
  });
  assert.equal(await h.go(), 0);
  const [ev] = events(h);
  assert.deepEqual(ev.detail, {
    status: 'issue-comment',
    url: 'https://github.com/org/product/issues/12#issuecomment-5',
    reason: 'commit to 99x-internal/ai-hub@compliance-audits failed: write tree: GitHub returned 403',
  });
  assert.ok(JSON.parse(h.calls[0].init.body).body.startsWith(DETAIL_MARKER));
  assert.match(h.calls[1].url, /\/events$/);
  assert.equal(git.requests.filter((r) => r.path === 'trees').length, 1, 'a 403 is not retried');
});

test('without a fallback issue a failed commit is recorded as failed', async () => {
  const git = fakeGit({ fail: { 'GET ref': 500 } });
  const h = harness({ report: sample('iso-9001-2015--8.1--ai-hub.json'), env: WITH_GITHUB, git });
  assert.equal(await h.go(), 0);
  assert.equal(events(h)[0].detail.status, 'failed');
  assert.equal(h.calls.length, 1);
});

test('a token alone is not consent to write to the audited repository', async () => {
  // The audited repository is usually the customer's. With no COMPLIANCE_DETAIL_STORE set,
  // a run that happens to carry a GITHUB_TOKEN must still not commit anything there:
  // the detailed report goes to AI Hub, beside the summary.
  const env = { ...PUBLISH_ENV, GITHUB_TOKEN: 'ghp_x0123456789abcdefghijklmnop' };
  const h = harness({ report: sample('iso-9001-2015--8.1--ai-hub.json'), env });
  assert.equal(await h.go(), 0);
  const [ev] = events(h);
  assert.equal(ev.detail.provider, 'aihub');
  assert.equal(h.git.requests.length, 0, 'nothing is written to any repository');
  assert.ok(h.hub.requests.every((r) => r.key === 'ah_tm_testkey1234567890'), 'the GitHub token goes nowhere');
  assert.equal(h.calls.length, 1, 'the summary still reaches AI Hub');
});

test('no GitHub token, store off, dry run and publishing off each say why there is no detail', async () => {
  const cases = [
    [{ env: { ...PUBLISH_ENV, COMPLIANCE_DETAIL_STORE: 'off' } }, 'disabled', /is off/],
    [{ env: { ...PUBLISH_ENV, COMPLIANCE_DETAIL_STORE: 'github' } }, 'failed', /no GitHub token/],
    [{ env: { ...WITH_GITHUB, COMPLIANCE_DETAIL_STORE: 'off' } }, 'disabled', /is off/],
    [{ env: WITH_GITHUB, argv: ['--dry-run'] }, 'disabled', /dry run/],
    [{ env: {} }, 'disabled', /publishing is off/],
  ];
  for (const [opts, status, reason] of cases) {
    const h = harness({ report: sample('iso-9001-2015--8.1--ai-hub.json'), ...opts });
    assert.equal(await h.go(), 0);
    const [ev] = events(h);
    assert.equal(ev.detail.status, status);
    assert.match(ev.detail.reason, reason);
    if (status === 'disabled') {
      assert.equal(h.git.requests.length, 0);
      assert.equal(h.hub.requests.length, 0);
    }
  }
});

test('an invalid report never reaches the repository', async () => {
  const report = sample('iso-9001-2015--8.1--ai-hub.json');
  report.controls[0].control = '8.9';
  const h = harness({ report, env: WITH_GITHUB });
  assert.equal(await h.go(), 2);
  assert.equal(h.git.requests.length, 0);
});

test('--check: publishing off is fine; bad config exits 3; an unreachable Hub only warns', async () => {
  assert.equal(await harness({ argv: ['--check'] }).go(), 0);
  assert.equal(await harness({ argv: ['--check'], env: { AIHUB_PUBLISH: '1', AIHUB_URL: 'http://evil.test' } }).go(), 3);
  assert.equal(await harness({ argv: ['--check'], env: { ...PUBLISH_ENV, COMPLIANCE_DETAIL_BRANCH: '../main' } }).go(), 3);
  assert.equal(await harness({ argv: ['--check'], env: { ...PUBLISH_ENV, COMPLIANCE_DETAIL_STORE: 'sharepoint' } }).go(), 3);
  // The token warning belongs to the opt-in github store; the default store warns about nothing.
  const noToken = harness({
    argv: ['--check'],
    env: { ...PUBLISH_ENV, COMPLIANCE_DETAIL_STORE: 'github' },
    responses: [{ status: 200 }],
  });
  assert.equal(await noToken.go(), 0);
  assert.match(noToken.logs.join('\n'), /GITHUB_TOKEN is not set/);
  const byDefault = harness({ argv: ['--check'], env: PUBLISH_ENV, responses: [{ status: 200 }] });
  assert.equal(await byDefault.go(), 0);
  assert.doesNotMatch(byDefault.logs.join('\n'), /GITHUB_TOKEN/);
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

// ── The default detail store: AI Hub artifacts ──────────────────────────────────────────────

test('by default each control\'s report is uploaded to AI Hub, and the summary links to it by id and hash (F18)', async () => {
  const h = harness({ report: sample('iso-9001-2015--8.1--ai-hub.json'), env: PUBLISH_ENV });
  assert.equal(await h.go(), 0);

  assert.equal(h.hub.requests.length, 1);
  const [upload] = h.hub.requests;
  assert.equal(upload.url, 'https://ai-hub-api.example.test/metrics/nodes/nd_9lcgvLaCAP/node-activities/na_NfPIrObtec/artifacts');
  assert.equal(upload.key, 'ah_tm_testkey1234567890');
  assert.ok(!upload.url.includes('whs_'), 'never the secret-in-URL route');

  const [ev] = events(h);
  assert.deepEqual(
    { ...upload.body, content: undefined, sha256: undefined },
    {
      key: ev.eventId,
      kind: 'report',
      name: '8.1.md',
      contentType: 'text/markdown',
      content: undefined,
      sha256: undefined,
      correlationId: 'exec-test-1',
      eventId: ev.eventId,
      attributes: { standardKey: 'iso-9001-2015', control: '8.1', repository: '99x-internal/ai-hub' },
    },
  );
  assert.match(upload.body.content, /8\.1/);

  const stored = h.hub.artifacts.get(ev.eventId);
  assert.deepEqual(ev.detail, {
    status: 'stored',
    provider: 'aihub',
    artifactId: stored.artifactId,
    byteSize: stored.byteSize,
    sha256: sha256(stored.content),
  });
  assert.equal(h.git.requests.length, 0, 'nothing is written to any repository');
  assert.equal(h.calls.length, 1, 'then the summary goes to AI Hub');
  assert.equal(JSON.parse(h.calls[0].init.body)[0].detail.artifactId, stored.artifactId);
  assert.match(h.logs.join('\n'), /detailed report stored in AI Hub \(1 artifact\)/);
});

test('a multi-control run uploads one artifact per control and tells AI Hub how many events to expect', async () => {
  const h = harness({ report: sample('iso-27001-2022--multi--synthetic.json'), env: PUBLISH_ENV });
  assert.equal(await h.go(), 0);
  const out = events(h);
  assert.deepEqual(h.hub.requests.map((r) => r.body.name), ['A.5.15.md', 'A.8.13.md']);
  assert.deepEqual(out.map((e) => e.dimensions.runEvents), [2, 2]);
  assert.notEqual(out[0].detail.artifactId, out[1].detail.artifactId);
  out.forEach((e, i) => assert.equal(e.detail.sha256, sha256(h.hub.requests[i].body.content), 'each event vouches for its own control\'s report'));
  assert.match(h.logs.join('\n'), /stored in AI Hub \(2 artifacts\)/);
});

test('publishing the same execution twice stores nothing twice', async () => {
  const hub = fakeHub();
  const first = harness({ report: sample('iso-9001-2015--8.1--ai-hub.json'), env: PUBLISH_ENV, hub });
  const again = harness({ report: sample('iso-9001-2015--8.1--ai-hub.json'), env: PUBLISH_ENV, hub });
  assert.equal(await first.go(), 0);
  assert.equal(await again.go(), 0);
  assert.equal(hub.artifacts.size, 1);
  assert.deepEqual(events(again)[0].detail, events(first)[0].detail);
});

test('a 5xx or a dropped connection during upload is retried', async () => {
  const hub = fakeHub({ fail: [503, 'network'] });
  const h = harness({ report: sample('iso-9001-2015--8.1--ai-hub.json'), env: PUBLISH_ENV, hub });
  assert.equal(await h.go(), 0);
  assert.equal(hub.requests.length, 3);
  assert.equal(events(h)[0].detail.status, 'stored');
});

test('a failed upload is a warning: the event says why, and the summary still reaches AI Hub', async () => {
  const hub = fakeHub({ fail: [400] });
  const h = harness({ report: sample('iso-9001-2015--8.1--ai-hub.json'), env: PUBLISH_ENV, hub });
  assert.equal(await h.go(), 0);
  assert.equal(hub.requests.length, 1, 'a 4xx is not retried');
  assert.deepEqual(events(h)[0].detail, { status: 'failed', reason: 'AI Hub returned 400: fake hub: 400' });
  assert.equal(h.calls.length, 1);
  assert.match(h.logs.join('\n'), /⚠ detailed report not stored for 8\.1/);
});

test('an AI Hub without the artifact store is asked once, not once per control', async () => {
  const hub = fakeHub({ fail: [401, 401, 401] });
  const h = harness({ report: sample('iso-27001-2022--multi--synthetic.json'), env: PUBLISH_ENV, hub });
  assert.equal(await h.go(), 0);
  assert.equal(hub.requests.length, 1);
  const out = events(h);
  assert.ok(out.every((e) => e.detail.status === 'failed' && /no artifact store yet/.test(e.detail.reason)));
  assert.equal(h.calls.length, 1, 'the summary is still delivered');
  assert.match(h.logs.join('\n'), /not stored for 2 controls/);
});

test('changed content under an execution id that was already published is refused, not overwritten', async () => {
  const hub = fakeHub();
  assert.equal(await harness({ report: sample('iso-9001-2015--8.1--ai-hub.json'), env: PUBLISH_ENV, hub }).go(), 0);
  const changed = sample('iso-9001-2015--8.1--ai-hub.json');
  changed.controls[0].reportMd += '\nAn afterthought.\n';
  const h = harness({ report: changed, env: PUBLISH_ENV, hub });
  assert.equal(await h.go(), 0);
  assert.equal(events(h)[0].detail.status, 'failed');
  assert.match(events(h)[0].detail.reason, /write-once/);
  assert.ok(![...hub.artifacts.values()].some((a) => a.content.includes('An afterthought')));
});

test('an event never vouches for a hash AI Hub did not confirm', async () => {
  const h = harness({ report: sample('iso-9001-2015--8.1--ai-hub.json'), env: PUBLISH_ENV, hub: fakeHub({ tamper: true }) });
  assert.equal(await h.go(), 0);
  assert.equal(events(h)[0].detail.status, 'failed');
  assert.match(events(h)[0].detail.reason, /SHA-256 mismatch/);

  // Nor for an upload AI Hub answered without an id (an older Hub, or a proxy's empty 200).
  const hub = { requests: [], handle: () => ({ status: 200, body: '{}' }) };
  const blank = harness({ report: sample('iso-9001-2015--8.1--ai-hub.json'), env: PUBLISH_ENV, hub });
  assert.equal(await blank.go(), 0);
  assert.match(events(blank)[0].detail.reason, /returned no artifact id/);
});

test('a report too large for one artifact is refused by AI Hub and recorded, not truncated', async () => {
  // 204800 characters is the contract's limit; as three-byte characters that is 600 KB.
  const report = sample('iso-9001-2015--8.1--ai-hub.json');
  report.controls[0].reportMd = '規'.repeat(MAX_REPORT_MD);
  const h = harness({ report, env: PUBLISH_ENV });
  assert.equal(await h.go(), 0);
  assert.deepEqual(events(h)[0].detail, { status: 'failed', reason: 'AI Hub returned 400: content must be at most 512 KB.' });
  assert.equal(h.calls.length, 1, 'the summary is still delivered');
});

test('secrets never reach AI Hub in an uploaded report either (F4)', async () => {
  const report = sample('iso-9001-2015--8.1--ai-hub.json');
  report.controls[0].reportMd += '\nToken in a script: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123\nConnection: Server=db;Password=Sup3rS3cret!\n';
  const h = harness({ report, env: { ...PUBLISH_ENV, DB_CONNECTION: 'Server=db;Password=Sup3rS3cret!' } });
  assert.equal(await h.go(), 0);
  const uploaded = h.hub.requests.map((r) => JSON.stringify(r.body)).join('\n');
  for (const secret of ['ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123', 'Sup3rS3cret!', 'ah_tm_testkey1234567890']) {
    assert.ok(!uploaded.includes(secret), `an uploaded artifact contains ${secret}`);
    assert.ok(!h.logs.join('\n').includes(secret), `logs contain ${secret}`);
  }
  assert.match(h.hub.requests[0].body.content, /\[REDACTED\]/);
});

test('an invalid report, a dry run and publishing off upload nothing', async () => {
  const invalid = sample('iso-9001-2015--8.1--ai-hub.json');
  invalid.controls[0].control = '8.9';
  const cases = [
    { report: invalid, env: PUBLISH_ENV },
    { report: sample('iso-9001-2015--8.1--ai-hub.json'), env: PUBLISH_ENV, argv: ['--dry-run'] },
    { report: sample('iso-9001-2015--8.1--ai-hub.json'), env: {} },
  ];
  for (const opts of cases) {
    const h = harness(opts);
    await h.go();
    assert.equal(h.hub.requests.length, 0);
  }
});

test('events saved by an earlier plugin version (compliance.v1) can still be re-sent', async () => {
  const legacy = loadSamples('events').find((s) => s.file === 'legacy-v1--iso-9001-2015--8.1--the-agent.json').data;
  assert.equal(legacy[0].dimensions.schema, 'compliance.v1');
  const h = harness({ env: PUBLISH_ENV, argv: ['--from-file', 'saved.json'], files: { 'saved.json': JSON.stringify(legacy) } });
  assert.equal(await h.go(), 0);
  assert.deepEqual(JSON.parse(h.calls[0].init.body), legacy);
  assert.equal(h.hub.requests.length, 0, 're-sending events uploads nothing');
});
