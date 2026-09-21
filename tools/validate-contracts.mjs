#!/usr/bin/env node
// Fitness function F1: every catalogue, sample report and sample event satisfies the contract,
// golden events match what the reference flattener produces, and every invalid sample is rejected
// for the expected reason.
//
//   npm run validate                  check everything
//   npm run validate -- --update-golden   regenerate samples/events from samples/reports
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { ROOT, createValidators, loadCatalogs, loadSamples, schemaFilesOnDisk, validateCatalog, validateReport, validateEvents } from './lib/contracts.mjs';
import { SCHEMAS, CATALOGS } from './lib/contract-data.mjs';
import { flatten } from './lib/flatten.mjs';

const updateGolden = process.argv.includes('--update-golden');
const validators = createValidators();
const failures = [];
let checks = 0;

function record(label, errors) {
  checks += 1;
  if (errors.length) {
    failures.push(label);
    console.log(`✗ ${label}`);
    for (const e of errors) console.log(`    ${e}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

const embeddedSchemas = Object.keys(SCHEMAS).sort();
record('embedded schemas match contracts/schemas',
  isDeepStrictEqual(embeddedSchemas, schemaFilesOnDisk()) ? [] : [`embedded ${embeddedSchemas.join(', ')} ≠ on disk ${schemaFilesOnDisk().join(', ')} — update lib/contract-data.mjs`]);

const catalogs = loadCatalogs();
record('embedded catalogues match contracts/catalogs',
  isDeepStrictEqual(Object.keys(CATALOGS).sort(), catalogs.map((c) => c.file))
  && catalogs.every((c) => isDeepStrictEqual(c.data, CATALOGS[c.file]))
    ? [] : ['embedded catalogues differ from contracts/catalogs — update lib/contract-data.mjs']);
for (const { file, data } of catalogs) record(`catalog ${file}`, validateCatalog(validators, data));
const catalogData = catalogs.map((c) => c.data);

const eventsDir = join(ROOT, 'samples', 'events');
for (const { file, data } of loadSamples('reports')) {
  record(`report ${file}`, validateReport(validators, data, catalogData));

  const expected = flatten(data);
  const goldenPath = join(eventsDir, file);
  if (updateGolden) {
    writeFileSync(goldenPath, `${JSON.stringify(expected, null, 2)}\n`);
    console.log(`  ↳ wrote golden events/${file}`);
  }
  const golden = existsSync(goldenPath) ? JSON.parse(readFileSync(goldenPath, 'utf8')) : null;
  record(`golden events/${file} matches flatten(report)`,
    golden && isDeepStrictEqual(golden, expected) ? [] : ['golden events are missing or out of date — run: npm run validate -- --update-golden']);
}

for (const { file, data } of loadSamples('events')) {
  record(`events ${file}`, validateEvents(validators, data, catalogData));
}

const expectations = JSON.parse(readFileSync(join(ROOT, 'samples', 'invalid', 'expectations.json'), 'utf8'));
for (const { file, data } of loadSamples('invalid')) {
  if (file === 'expectations.json') continue;
  const expect = expectations[file];
  if (!expect) {
    record(`invalid ${file}`, ['no entry in invalid/expectations.json']);
    continue;
  }
  const errors = expect.type === 'report'
    ? validateReport(validators, data, catalogData)
    : validateEvents(validators, data, catalogData);
  const matched = errors.some((e) => e.includes(expect.error));
  record(`invalid ${file} is rejected (${expect.error})`,
    matched ? [] : [errors.length ? `rejected, but not for the expected reason: ${errors.join(' | ')}` : 'was accepted but must be rejected']);
}

console.log(`\n${checks - failures.length}/${checks} checks passed`);
process.exit(failures.length ? 1 : 0);
