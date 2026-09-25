// Rules JSON Schema cannot express. Each function returns a list of error strings (empty = valid).
import { eventIdFor, tally, MAX_EVENT_BYTES } from './flatten.mjs';

function catalogIndex(catalogs) {
  const byStandard = new Map();
  for (const cat of catalogs) {
    byStandard.set(cat.standardKey, new Map(cat.controls.map((c) => [c.id, c])));
  }
  return byStandard;
}

export function checkCatalog(catalog) {
  const errors = [];
  const ids = new Set();
  for (const c of catalog.controls) {
    if (ids.has(c.id)) errors.push(`duplicate control id ${c.id}`);
    ids.add(c.id);
  }
  for (const c of catalog.controls) {
    if (c.parent !== null && !ids.has(c.parent)) errors.push(`control ${c.id}: parent ${c.parent} is not in the catalogue`);
    if (c.skill && !c.auditable) errors.push(`control ${c.id}: has a skill but is not auditable`);
  }
  return errors;
}

function checkControlAgainstCatalog(index, standardKey, control, title, group, where) {
  const controls = index.get(standardKey);
  if (!controls) return [`${where}: no control catalogue for standard '${standardKey}'`];
  const entry = controls.get(control);
  if (!entry) return [`${where}: control ${control} is not in the ${standardKey} catalogue`];
  const errors = [];
  if (!entry.auditable) errors.push(`${where}: control ${control} is a group, not an auditable control`);
  if (entry.title !== title) errors.push(`${where}: controlTitle '${title}' does not match catalogue title '${entry.title}'`);
  if (entry.parent !== group) errors.push(`${where}: controlGroup '${group}' does not match catalogue parent '${entry.parent}'`);
  return errors;
}

function checkObligationsAndActions(obligations, actions, sources, where) {
  const errors = [];
  const numbers = new Set();
  for (const o of obligations) {
    if (numbers.has(o.n)) errors.push(`${where}: duplicate obligation number ${o.n}`);
    numbers.add(o.n);
    const sourceIds = new Set(sources.map((s) => s.id));
    for (const e of o.evidence ?? []) {
      if (e.kind !== 'external' && !sourceIds.has(e.sourceId)) {
        errors.push(`${where}: obligation ${o.n} cites source '${e.sourceId}', which is not in sources`);
      }
    }
  }
  for (const a of actions) {
    for (const n of a.closes) {
      // Number(): a string "5" is already a schema error; don't also report it as a missing obligation.
      if (!numbers.has(Number(n))) errors.push(`${where}: action "${a.text.slice(0, 40)}…" closes obligation ${n}, which does not exist`);
    }
  }
  return errors;
}

export function checkReport(report, catalogs) {
  const index = catalogIndex(catalogs);
  const errors = [];
  const seen = new Set();
  report.controls.forEach((c, i) => {
    const where = `controls[${i}] (${c.control})`;
    if (seen.has(c.control)) errors.push(`${where}: control assessed twice in one report`);
    seen.add(c.control);
    errors.push(...checkControlAgainstCatalog(index, report.standardKey, c.control, c.controlTitle, c.controlGroup, where));
    errors.push(...checkObligationsAndActions(c.obligations, c.actions, report.sources, where));
  });
  if (report.scope.sourcesMode === 'implicit-git-repo') {
    if (report.sources.length !== 1 || report.sources[0].provider !== 'git-repo') {
      errors.push('scope: implicit-git-repo runs must have exactly one git-repo source');
    }
  }
  return errors;
}

// F18: a stored detail is linked by an immutable commit permalink to its own control's file.
function checkDetail(detail, d, where) {
  if (detail?.status !== 'stored') return [];
  const errors = [];
  if (!detail.url.endsWith(`/${detail.repository}/blob/${detail.commit}/${detail.path}`)) {
    errors.push(`${where}: detail.url must be the commit permalink …/${detail.repository}/blob/${detail.commit}/${detail.path}`);
  }
  if (!detail.path.startsWith(`audits/${d.standardKey}/`) || !detail.path.endsWith('.md')) {
    errors.push(`${where}: detail.path must be a Markdown file under audits/${d.standardKey}/`);
  }
  return errors;
}

export function checkEvents(events, catalogs) {
  const index = catalogIndex(catalogs);
  const errors = [];
  const eventIds = new Set();
  const usageCarriers = new Map();

  events.forEach((ev, i) => {
    const d = ev.dimensions;
    const where = `[${i}] (${d.control})`;
    if (eventIds.has(ev.eventId)) errors.push(`${where}: duplicate eventId ${ev.eventId}`);
    eventIds.add(ev.eventId);

    const expectedId = eventIdFor({ standardKey: d.standardKey, repository: d.repository, executionId: d.executionId }, d.control);
    if (ev.eventId !== expectedId) errors.push(`${where}: eventId must be '${expectedId}'`);
    if (ev.correlationId !== d.executionId) errors.push(`${where}: correlationId must equal dimensions.executionId`);

    const t = tally(ev.obligations);
    for (const [dim, verdict] of [['conform', 'Conform'], ['partial', 'Partial'], ['gap', 'Gap'], ['na', 'N/A']]) {
      if (d[dim] !== t[verdict]) errors.push(`${where}: dimensions.${dim}=${d[dim]} but obligations contain ${t[verdict]} ${verdict}`);
    }
    const p0 = ev.actions.filter((a) => a.priority === 'P0').length;
    if (d.p0Actions !== p0) errors.push(`${where}: dimensions.p0Actions=${d.p0Actions} but there are ${p0} P0 actions`);
    const ok = ev.sources.filter((s) => s.verdict === 'ok').length;
    if (d.sourcesOk !== ok) errors.push(`${where}: dimensions.sourcesOk=${d.sourcesOk} but ${ok} sources are ok`);
    if (d.sourcesTotal !== ev.sources.length) errors.push(`${where}: dimensions.sourcesTotal=${d.sourcesTotal} but there are ${ev.sources.length} sources`);
    if (d.notAssessedCount !== ev.notAssessed.length) errors.push(`${where}: dimensions.notAssessedCount does not match notAssessed`);

    errors.push(...checkControlAgainstCatalog(index, d.standardKey, d.control, d.controlTitle, d.controlGroup, where));
    errors.push(...checkObligationsAndActions(ev.obligations, ev.actions, ev.sources, where));

    const bytes = new TextEncoder().encode(JSON.stringify(ev)).length;
    if (bytes > MAX_EVENT_BYTES) errors.push(`${where}: event is ${bytes} bytes; the limit is ${MAX_EVENT_BYTES} (F17). Detail belongs in the repository report`);
    errors.push(...checkDetail(ev.detail, d, where));

    if (d.tokens !== undefined || d.costUsd !== undefined) {
      usageCarriers.set(ev.correlationId, (usageCarriers.get(ev.correlationId) ?? 0) + 1);
    }
  });

  for (const [corr, count] of usageCarriers) {
    if (count > 1) errors.push(`execution ${corr}: usage (tokens/costUsd) appears on ${count} events; it must be on one only`);
  }
  return errors;
}
