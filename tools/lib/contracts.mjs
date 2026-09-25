// Validators built from the embedded schemas, plus file loaders for catalogues and samples.
// The validators have no file-system access, so the publisher bundle can use them unchanged.
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMAS } from './contract-data.mjs';
import { checkCatalog, checkEvents, checkReport } from './semantic.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'contracts');
export const SCHEMAS_DIR = join(ROOT, 'schemas');
const SCHEMA_BASE = 'https://github.com/99x-Projects/compliance-automation/contracts/schemas/';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const jsonFiles = (dir) => readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

export function createValidators() {
  // strictRequired is off because if/then blocks in the section schema require properties
  // declared in the parent object; every other strict check stays on.
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  addFormats(ajv);
  for (const schema of Object.values(SCHEMAS)) ajv.addSchema(schema);
  const get = (name) => ajv.getSchema(`${SCHEMA_BASE}${name}`);
  // Messages go to an agent that must fix the JSON in one pass, so name the allowed values.
  const describe = (validate) => (validate.errors ?? []).map((e) => {
    const allowed = e.params?.allowedValues ? `: ${e.params.allowedValues.map((v) => JSON.stringify(v)).join(', ')}` : '';
    const constant = e.keyword === 'const' ? `: ${JSON.stringify(e.params.allowedValue)}` : '';
    return `${e.instancePath || '/'} ${e.message}${allowed}${constant}`;
  });
  const wrap = (validate) => (data) => (validate(data) ? [] : describe(validate));
  return {
    report: wrap(get('compliance-report.v1.schema.json')),
    event: wrap(get('compliance-event.v1.schema.json')),
    catalog: wrap(get('control-catalog.v1.schema.json')),
  };
}

export function loadCatalogs() {
  const dir = join(ROOT, 'catalogs');
  return jsonFiles(dir).map((f) => ({ file: f, data: readJson(join(dir, f)) }));
}

export function loadSamples(kind) {
  const dir = join(ROOT, 'samples', kind);
  return jsonFiles(dir).map((f) => ({ file: f, path: join(dir, f), data: readJson(join(dir, f)) }));
}

export function schemaFilesOnDisk() {
  return readdirSync(SCHEMAS_DIR).filter((f) => f.endsWith('.schema.json')).sort();
}

export function validateCatalog(validators, catalog) {
  return [...validators.catalog(catalog), ...checkCatalog(catalog)];
}

// Semantic checks also run when the schema fails, so every problem is reported in one pass.
// On badly malformed input they may throw; then only the schema errors are returned.
function withSemantic(schemaErrors, semantic) {
  try {
    return [...schemaErrors, ...semantic()];
  } catch {
    return schemaErrors;
  }
}

export function validateReport(validators, report, catalogs) {
  return withSemantic(validators.report(report), () => checkReport(report, catalogs));
}

export function validateEvents(validators, events, catalogs) {
  return withSemantic(validators.event(events), () => checkEvents(events, catalogs));
}
