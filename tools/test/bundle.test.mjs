// Runs the shipped, bundled publisher (plugins/operation/scripts/publish-aihub.mjs) as a child
// process against a local HTTP server — proves the artefact the plugin installs actually works.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSamples } from '../lib/contracts.mjs';

const BUNDLE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins', 'operation', 'scripts', 'publish-aihub.mjs');

function runBundle(args, env, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BUNDLE, ...args], { cwd, env: { PATH: process.env.PATH, ...env } });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
  });
}

// One local server plays both AI Hub and a GitHub Git Data API with no compliance-audits branch yet.
function gitReply(req, body) {
  if (req.method === 'GET') return [404, {}];
  if (req.url.endsWith('/git/trees')) return [201, { sha: 't'.repeat(40) }];
  if (req.url.endsWith('/git/commits')) return [201, { sha: 'b'.repeat(40) }];
  if (req.url.endsWith('/git/refs')) return [201, { ref: JSON.parse(body).ref }];
  return [500, {}];
}

test('the bundled publisher validates, redacts, commits the detail and POSTs the summary to AI Hub', async () => {
  const received = [];
  const git = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.url.includes('/git/')) {
        git.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
        const [status, data] = gitReply(req, body);
        res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
        return;
      }
      received.push({ url: req.url, key: req.headers['x-api-key'], body });
      res.writeHead(201, { 'Content-Type': 'application/json' }).end('{"accepted":1}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  const dir = mkdtempSync(join(tmpdir(), 'publisher-'));
  try {
    const report = structuredClone(loadSamples('reports').find((s) => s.file === 'iso-9001-2015--8.1--the-agent.json').data);
    report.executionId = 'pending';
    report.controls[0].summary += ' Leaked: ah_tm_leakedkey0123456789';
    writeFileSync(join(dir, 'compliance-report.json'), JSON.stringify(report));

    const { code, out } = await runBundle([], {
      AIHUB_PUBLISH: '1',
      AIHUB_URL: `http://127.0.0.1:${port}`,
      AIHUB_NODE_ID: 'nd_9lcgvLaCAP',
      AIHUB_ACTIVITY_ID: 'na_NfPIrObtec',
      'AIHUB-API-KEY': 'ah_tm_testkey1234567890',
      EXECUTION_ID: 'exec-bundle-1',
      COMPLIANCE_DETAIL_STORE: 'github',
      GITHUB_TOKEN: 'ghp_bundletoken0123456789abcdef',
      GITHUB_API_URL: `http://127.0.0.1:${port}`,
    }, dir);

    assert.equal(code, 0, out);
    assert.match(out, /detailed report committed to xianix-team\/the-agent@compliance-audits \(bbbbbbb\)/);
    assert.match(out, /delivered to AI Hub \(201\)/);
    assert.deepEqual(git.map((g) => `${g.method} ${g.url}`), [
      'GET /repos/xianix-team/the-agent/git/ref/heads/compliance-audits',
      'POST /repos/xianix-team/the-agent/git/trees',
      'POST /repos/xianix-team/the-agent/git/commits',
      'POST /repos/xianix-team/the-agent/git/refs',
    ]);
    assert.ok(git.every((g) => g.auth === 'Bearer ghp_bundletoken0123456789abcdef'));
    assert.ok(!git.some((g) => g.body.includes('ah_tm_leakedkey')), 'secret was committed');
    assert.equal(received.length, 1);
    assert.equal(received[0].url, '/metrics/nodes/nd_9lcgvLaCAP/node-activities/na_NfPIrObtec/events');
    assert.equal(received[0].key, 'ah_tm_testkey1234567890');
    const events = JSON.parse(received[0].body);
    assert.equal(events[0].correlationId, 'exec-bundle-1');
    assert.equal(events[0].detail.status, 'stored');
    assert.equal(events[0].detail.url, `https://github.com/xianix-team/the-agent/blob/${'b'.repeat(40)}/${events[0].detail.path}`);
    assert.equal(events[0].reportMd, undefined);
    assert.equal(events[0].dimensions.pluginVersion, JSON.parse(readFileSync(join(dirname(BUNDLE), '..', '.claude-plugin', 'plugin.json'), 'utf8')).version.replace(/^/, 'operation@'));
    assert.ok(!received[0].body.includes('ah_tm_leakedkey'), 'secret was sent');
    assert.ok(!out.includes('ah_tm_testkey'), 'API key was logged');
    assert.ok(!out.includes('ghp_bundletoken'), 'GitHub token was logged');
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'aihub-event.json'), 'utf8')), events);
  } finally {
    server.close();
    rmSync(dir, { recursive: true });
  }
});

test('by default the bundled publisher stores the detailed report in AI Hub, then POSTs the summary', async () => {
  const uploads = [];
  const posted = [];
  const other = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const json = (status, data) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
      if (req.method === 'POST' && req.url.endsWith('/artifacts')) {
        const upload = JSON.parse(body);
        uploads.push({ url: req.url, key: req.headers['x-api-key'], upload });
        const sha256 = createHash('sha256').update(upload.content, 'utf8').digest('hex');
        return json(201, { artifactId: `art_bundle000${uploads.length}`, sha256, byteSize: Buffer.byteLength(upload.content), created: true });
      }
      if (req.method === 'POST' && req.url.endsWith('/events')) {
        posted.push({ url: req.url, key: req.headers['x-api-key'], body });
        return json(202, { accepted: 1 });
      }
      other.push(`${req.method} ${req.url}`);
      return json(404, {});
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  const dir = mkdtempSync(join(tmpdir(), 'publisher-'));
  try {
    const report = structuredClone(loadSamples('reports').find((s) => s.file === 'iso-9001-2015--8.1--ai-hub.json').data);
    report.executionId = 'pending';
    report.controls[0].reportMd += '\nLeaked: ah_tm_leakedkey0123456789\n';
    writeFileSync(join(dir, 'compliance-report.json'), JSON.stringify(report));

    // No COMPLIANCE_DETAIL_STORE, and a GitHub token the run happens to carry: it must go unused.
    const { code, out } = await runBundle([], {
      AIHUB_PUBLISH: '1',
      AIHUB_URL: `http://127.0.0.1:${port}`,
      AIHUB_NODE_ID: 'nd_9lcgvLaCAP',
      AIHUB_ACTIVITY_ID: 'na_NfPIrObtec',
      'AIHUB-API-KEY': 'ah_tm_testkey1234567890',
      EXECUTION_ID: 'exec-bundle-2',
      GITHUB_TOKEN: 'ghp_bundletoken0123456789abcdef',
      GITHUB_API_URL: `http://127.0.0.1:${port}`,
    }, dir);

    assert.equal(code, 0, out);
    assert.match(out, /detailed report stored in AI Hub \(1 artifact\)/);
    assert.match(out, /delivered to AI Hub \(202\)/);
    assert.deepEqual(other, [], 'nothing but AI Hub uploads and the events POST');

    assert.deepEqual(uploads.map((u) => u.url), ['/metrics/nodes/nd_9lcgvLaCAP/node-activities/na_NfPIrObtec/artifacts']);
    assert.ok(uploads.every((u) => u.key === 'ah_tm_testkey1234567890'));
    assert.ok(uploads.every((u) => u.upload.correlationId === 'exec-bundle-2' && u.upload.contentType === 'text/markdown'));
    assert.ok(!uploads.some((u) => u.upload.content.includes('ah_tm_leakedkey')), 'secret was uploaded');

    assert.equal(posted.length, 1);
    const events = JSON.parse(posted[0].body);
    assert.deepEqual(events.map((e) => e.dimensions.schema), ['compliance.v2']);
    assert.deepEqual(events.map((e) => e.dimensions.runEvents), [1]);
    events.forEach((e, i) => {
      assert.equal(uploads[i].upload.key, e.eventId);
      assert.deepEqual(e.detail, {
        status: 'stored',
        provider: 'aihub',
        artifactId: `art_bundle000${i + 1}`,
        byteSize: Buffer.byteLength(uploads[i].upload.content),
        sha256: createHash('sha256').update(uploads[i].upload.content, 'utf8').digest('hex'),
      });
    });
    assert.ok(!out.includes('ah_tm_testkey'), 'API key was logged');
    assert.ok(!out.includes('ghp_bundletoken'), 'GitHub token was logged');
  } finally {
    server.close();
    rmSync(dir, { recursive: true });
  }
});

test('the bundled publisher rejects an invalid report with exit code 2', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'publisher-'));
  try {
    writeFileSync(join(dir, 'compliance-report.json'), JSON.stringify({ schema: 'compliance-report.v1' }));
    const { code, out } = await runBundle([], {}, dir);
    assert.equal(code, 2);
    assert.match(out, /does not match the compliance-report\.v1 contract/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
