// F2: released schemas are immutable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkLock, compareWithBaseLock, lockNewSchemas, LOCK_FILE } from '../lib/schema-lock.mjs';
import { SCHEMAS_DIR } from '../lib/contracts.mjs';

function copyOfSchemas() {
  const dir = mkdtempSync(join(tmpdir(), 'schemas-'));
  for (const f of readdirSync(SCHEMAS_DIR)) copyFileSync(join(SCHEMAS_DIR, f), join(dir, f));
  return dir;
}

test('the repository lock matches the released schemas', () => {
  assert.deepEqual(checkLock(SCHEMAS_DIR), []);
});

test('changing a released schema fails and names the next version', () => {
  const dir = copyOfSchemas();
  try {
    const file = join(dir, 'compliance-event.v1.schema.json');
    const schema = JSON.parse(readFileSync(file, 'utf8'));
    schema.description += ' (edited)';
    writeFileSync(file, JSON.stringify(schema, null, 2));
    const errors = checkLock(dir);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /released schema changed.*compliance-event\.v2\.schema\.json/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('re-running the lock never accepts a changed released schema', () => {
  const dir = copyOfSchemas();
  try {
    const file = join(dir, 'compliance-report.v1.schema.json');
    writeFileSync(file, readFileSync(file, 'utf8').replace('Compliance report (v1)', 'Compliance report'));
    assert.deepEqual(lockNewSchemas(dir), []);
    assert.equal(checkLock(dir).length, 1);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('a new schema must be locked, and deleting a released one fails', () => {
  const dir = copyOfSchemas();
  try {
    const v2 = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://github.com/99x-Projects/compliance-automation/contracts/schemas/compliance-event.v2.schema.json',
      type: 'array',
    };
    writeFileSync(join(dir, 'compliance-event.v2.schema.json'), JSON.stringify(v2));
    assert.match(checkLock(dir).join('\n'), /v2\.schema\.json: new schema is not locked/);
    assert.deepEqual(lockNewSchemas(dir), ['compliance-event.v2.schema.json']);
    assert.deepEqual(checkLock(dir), []);

    rmSync(join(dir, 'control-catalog.v1.schema.json'));
    assert.match(checkLock(dir).join('\n'), /control-catalog\.v1\.schema\.json: released schema was deleted/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('line-ending changes alone are not a schema change', () => {
  const dir = copyOfSchemas();
  try {
    const file = join(dir, 'compliance-common.v1.schema.json');
    writeFileSync(file, readFileSync(file, 'utf8').replace(/\n/g, '\r\n'));
    assert.deepEqual(checkLock(dir), []);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('hand-editing a released hash in the lock is caught against the base branch', () => {
  const base = { files: { 'a.v1.schema.json': { sha256: 'aaa' }, 'b.v1.schema.json': { sha256: 'bbb' } } };
  const current = { files: { 'a.v1.schema.json': { sha256: 'zzz' }, 'c.v1.schema.json': { sha256: 'ccc' } } };
  assert.deepEqual(compareWithBaseLock(base, current), [
    'a.v1.schema.json: lock hash edited (released on the base branch)',
    'b.v1.schema.json: lock entry removed (released on the base branch)',
  ]);
  assert.deepEqual(compareWithBaseLock(base, { files: { ...base.files, 'c.v1.schema.json': { sha256: 'ccc' } } }), []);
});

test('lock file is present', () => {
  assert.ok(readdirSync(SCHEMAS_DIR).includes(LOCK_FILE));
});
