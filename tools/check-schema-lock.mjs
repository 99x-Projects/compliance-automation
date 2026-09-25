#!/usr/bin/env node
// Fitness function F2 CLI.
//   npm run schemas:check                         fail if a released schema changed, was deleted, or a new one is unlocked
//   npm run schemas:check -- --base <lock.json>   also fail if a lock entry from the base branch was edited or removed
//   npm run schemas:lock                          lock schemas that are new (never re-locks a released one)
import { readFileSync } from 'node:fs';
import { SCHEMAS_DIR } from './lib/contracts.mjs';
import { checkLock, compareWithBaseLock, lockNewSchemas, readLock } from './lib/schema-lock.mjs';

const args = process.argv.slice(2);

if (args.includes('--lock')) {
  const added = lockNewSchemas(SCHEMAS_DIR);
  console.log(added.length ? `Locked: ${added.join(', ')}` : 'Nothing new to lock.');
}

const errors = checkLock(SCHEMAS_DIR);

const baseIndex = args.indexOf('--base');
if (baseIndex !== -1) {
  const basePath = args[baseIndex + 1];
  const baseLock = JSON.parse(readFileSync(basePath, 'utf8'));
  errors.push(...compareWithBaseLock(baseLock, readLock(SCHEMAS_DIR)));
}

if (errors.length) {
  for (const e of errors) console.log(`✗ ${e}`);
  process.exit(1);
}
console.log('✓ released schemas unchanged');
