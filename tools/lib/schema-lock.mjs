// Fitness function F2: released schemas are immutable.
// SCHEMAS.lock.json records a SHA-256 per schema file. Changing a locked schema fails the check —
// the change must ship as a new versioned file (…v2.schema.json) instead.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const LOCK_FILE = 'SCHEMAS.lock.json';
const SCHEMA_FILE = /^(?<name>[a-z0-9-]+)\.v(?<version>\d+)\.schema\.json$/;

export function hashFile(path) {
  // Normalise line endings so a checkout on Windows doesn't look like a change.
  const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  return createHash('sha256').update(text).digest('hex');
}

export function readLock(dir) {
  const path = join(dir, LOCK_FILE);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { files: {} };
}

export function schemaFiles(dir) {
  return readdirSync(dir).filter((f) => f.endsWith('.schema.json')).sort();
}

export function checkLock(dir) {
  const errors = [];
  const lock = readLock(dir);
  const files = schemaFiles(dir);

  for (const file of files) {
    const match = SCHEMA_FILE.exec(file);
    if (!match) {
      errors.push(`${file}: name must be <name>.v<N>.schema.json`);
      continue;
    }
    const schema = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    if (typeof schema.$id !== 'string' || !schema.$id.endsWith(`/${file}`)) {
      errors.push(`${file}: $id must end with /${file}`);
    }
    const locked = lock.files[file];
    if (!locked) {
      errors.push(`${file}: new schema is not locked yet — run 'npm run schemas:lock' when it is ready to release`);
    } else if (locked.sha256 !== hashFile(join(dir, file))) {
      errors.push(`${file}: released schema changed. Released schemas are immutable — add ${match.groups.name}.v${Number(match.groups.version) + 1}.schema.json instead`);
    }
  }
  for (const file of Object.keys(lock.files)) {
    if (!files.includes(file)) errors.push(`${file}: released schema was deleted`);
  }
  return errors;
}

// A pull request may add lock entries but never edit or remove one that exists on the base branch —
// otherwise a changed schema could be "fixed" by hand-editing its hash.
export function compareWithBaseLock(baseLock, currentLock) {
  const errors = [];
  for (const [file, entry] of Object.entries(baseLock.files ?? {})) {
    const now = currentLock.files?.[file];
    if (!now) errors.push(`${file}: lock entry removed (released on the base branch)`);
    else if (now.sha256 !== entry.sha256) errors.push(`${file}: lock hash edited (released on the base branch)`);
  }
  return errors;
}

export function lockNewSchemas(dir, now = new Date().toISOString()) {
  const lock = readLock(dir);
  const added = [];
  for (const file of schemaFiles(dir)) {
    if (lock.files[file]) continue; // never re-lock: a changed released schema must stay a failure
    lock.files[file] = { sha256: hashFile(join(dir, file)), lockedAt: now };
    added.push(file);
  }
  const sorted = Object.fromEntries(Object.entries(lock.files).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(join(dir, LOCK_FILE), `${JSON.stringify({ files: sorted }, null, 2)}\n`);
  return added;
}
