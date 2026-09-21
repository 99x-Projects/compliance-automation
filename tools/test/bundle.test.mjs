// Runs the shipped, bundled publisher (plugins/operation/scripts/publish-aihub.mjs) as a child
// process against a local HTTP server — proves the artefact the plugin installs actually works.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
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

test('the bundled publisher validates, redacts and POSTs to AI Hub', async () => {
  const received = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
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
    }, dir);

    assert.equal(code, 0, out);
    assert.match(out, /delivered to AI Hub \(201\)/);
    assert.equal(received.length, 1);
    assert.equal(received[0].url, '/metrics/nodes/nd_9lcgvLaCAP/node-activities/na_NfPIrObtec/events');
    assert.equal(received[0].key, 'ah_tm_testkey1234567890');
    const events = JSON.parse(received[0].body);
    assert.equal(events[0].correlationId, 'exec-bundle-1');
    assert.equal(events[0].dimensions.pluginVersion, JSON.parse(readFileSync(join(dirname(BUNDLE), '..', '.claude-plugin', 'plugin.json'), 'utf8')).version.replace(/^/, 'operation@'));
    assert.ok(!received[0].body.includes('ah_tm_leakedkey'), 'secret was sent');
    assert.ok(!out.includes('ah_tm_testkey'), 'API key was logged');
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'aihub-event.json'), 'utf8')), events);
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
