// The Operation plugin as Claude Code loads it: every command and skill header parses, the
// manifest and the marketplace agree on the version, and the PreToolUse hook keeps the audit
// read-only and the AI Hub key out of the logs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLUGIN = join(ROOT, 'plugins', 'operation');
const HOOK = join(PLUGIN, 'hooks', 'validate-prerequisites.sh');

function frontmatter(file) {
  const text = readFileSync(file, 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(match, `${file} has no frontmatter`);
  // Strict, as Claude Code parses it: a header that fails here loads with empty metadata.
  return parse(match[1], { strict: true, uniqueKeys: true });
}

const markdownWithHeaders = [
  ...readdirSync(join(PLUGIN, 'commands')).map((f) => join(PLUGIN, 'commands', f)),
  ...readdirSync(join(PLUGIN, 'skills')).map((d) => join(PLUGIN, 'skills', d, 'SKILL.md')),
];

for (const file of markdownWithHeaders) {
  test(`${file.slice(PLUGIN.length + 1)}: header parses, with a name and a description`, () => {
    const meta = frontmatter(file);
    assert.equal(typeof meta.name, 'string');
    assert.ok(meta.name.length > 0);
    assert.equal(typeof meta.description, 'string');
    assert.ok(meta.description.length > 20);
    if ('argument-hint' in meta) assert.equal(typeof meta['argument-hint'], 'string');
  });
}

test('the manifest, the marketplace entry and the files they name agree', () => {
  const manifest = JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8'));
  const marketplace = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
  const entry = marketplace.plugins.find((p) => p.name === manifest.name);
  assert.ok(entry, 'the marketplace lists the plugin');
  // Claude Code installs the plugin.json version; a different marketplace version only misleads.
  assert.equal(entry.version, manifest.version);
  for (const command of manifest.commands) assert.ok(existsSync(join(PLUGIN, command)), command);
  assert.ok(existsSync(join(PLUGIN, manifest.hooks)), manifest.hooks);
  const hooks = JSON.parse(readFileSync(join(PLUGIN, manifest.hooks), 'utf8'));
  assert.match(hooks.hooks.PreToolUse[0].hooks[0].command, /validate-prerequisites\.sh/);
});

function hook(command, env = {}) {
  const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
  const result = spawnSync('bash', [HOOK], { input, encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
  assert.equal(result.status, 0, result.stderr);
  const out = result.stdout.trim();
  return out ? JSON.parse(out) : null;
}

const blocked = [
  'git commit -m "add report"',
  'git add -A && git commit -m report',
  'git -C /workspace/repo push origin HEAD',
  'cd repo; git push',
  'GIT_AUTHOR_NAME=x git commit -am x',
  'git checkout -b compliance-audits',
  'git switch -c audits',
  'git reset --hard HEAD~1',
  'gh pr create --title "8.1 report" --body x',
  'gh issue comment 12 --body "Gap"',
  'gh api -X POST repos/o/r/issues/1/comments -f body=x',
  'echo $AIHUB_API_KEY',
  'printenv AIHUB-API-KEY',
  'curl -H "X-Api-Key: $AIHUB_API_KEY" https://hub/x',
];

for (const command of blocked) {
  test(`blocks: ${command}`, () => {
    const decision = hook(command);
    assert.equal(decision?.decision, 'block');
    assert.ok(decision.reason.length > 20);
  });
}

const allowed = [
  'git log --since=180.days --pretty=format:%h',
  'git status',
  'git -C repo diff HEAD~5 --stat',
  'git show HEAD:README.md',
  'git commit-graph verify',
  'grep -rn "git push" .github/workflows',
  'gh pr list --state merged --limit 20',
  'gh api repos/o/r/pulls?state=closed',
  'node "$PUBLISHER" --check',
  'AIHUB_FALLBACK_ISSUE=o/r#1 node "$PUBLISHER"',
  'ls -la',
];

for (const command of allowed) {
  test(`allows: ${command}`, () => {
    assert.equal(hook(command), null);
  });
}

test('blocks the publisher when Node.js is missing, and says why', () => {
  // A PATH with bash and the basic tools the hook uses, but no node.
  const noNode = spawnSync('bash', ['-c', 'command -v node'], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8' });
  if (noNode.status === 0) return; // node is installed system-wide here; nothing to prove
  const decision = hook('node "$PUBLISHER" --check', { PATH: '/usr/bin:/bin' });
  assert.equal(decision?.decision, 'block');
  assert.match(decision.reason, /Node\.js/);
});

test('without Node.js the hook still reads the command and blocks writes', () => {
  const noNode = spawnSync('bash', ['-c', 'command -v node'], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8' });
  if (noNode.status === 0) return;
  for (const command of ['git commit -m "report"', 'gh pr create --title "x"', 'echo "$AIHUB_API_KEY"']) {
    assert.equal(hook(command, { PATH: '/usr/bin:/bin' })?.decision, 'block', command);
  }
  assert.equal(hook('git log --oneline -5', { PATH: '/usr/bin:/bin' }), null);
});
