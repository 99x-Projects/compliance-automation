// Reference flattener: one compliance report (report.json) → AI Hub events (one per control).
// Events are summaries: evidence, sections and the Markdown report are stored separately (an
// AI Hub artifact by default) and linked through `detail` (see detail-files.mjs).
// The publisher (delivery step 3) uses this exact function; the golden event samples are
// generated from it, so contract tests catch any drift between the two.

export const DEFAULT_ACTOR = 'ISO Audit Agent';
export const EVENT_SCHEMA = 'compliance.v2';
export const LEGACY_EVENT_SCHEMA = 'compliance.v1';
const USAGE_KEYS = ['tokens', 'cacheReadTokens', 'costUsd', 'model'];
export const MAX_EVENT_BYTES = 16 * 1024;
export const MAX_GAP = 300;
export const MAX_SUMMARY = 2000;
const NO_DETAIL = { status: 'disabled', reason: 'the detailed report was not stored' };

function cut(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function summariseObligation(o) {
  return {
    n: o.n,
    title: o.title,
    core: o.core,
    verdict: o.verdict,
    ...(o.originalVerdict !== undefined ? { originalVerdict: o.originalVerdict } : {}),
    gap: cut(o.gap, MAX_GAP),
    evidenceCount: o.evidence.length,
  };
}

export function eventIdFor(report, control) {
  return `${report.standardKey}:${control}:${report.repository}:${report.executionId}`;
}

export function tally(obligations) {
  const counts = { Conform: 0, Partial: 0, Gap: 0, 'N/A': 0 };
  for (const o of obligations) counts[o.verdict] += 1;
  return counts;
}

// details: control id → detail object (from storedDetails or a fallback). Missing = disabled.
export function flatten(report, { actor = DEFAULT_ACTOR, details = {} } = {}) {
  const sourcesOk = report.sources.filter((s) => s.verdict === 'ok').length;

  return report.controls.map((c, index) => {
    const t = tally(c.obligations);
    const dimensions = {
      schema: EVENT_SCHEMA,
      standard: report.standard,
      standardKey: report.standardKey,
      control: c.control,
      controlTitle: c.controlTitle,
      controlGroup: c.controlGroup,
      repository: report.repository,
      commit: report.baseline.commit,
      baselineRef: report.baseline.ref,
      runAt: report.runAt,
      // One event per control, so this is how many AI Hub should expect before the run is complete.
      runEvents: report.controls.length,
      executionId: report.executionId,
      pluginVersion: report.pluginVersion,
      overall: c.overall,
      conform: t.Conform,
      partial: t.Partial,
      gap: t.Gap,
      na: t['N/A'],
      p0Actions: c.actions.filter((a) => a.priority === 'P0').length,
      sourcesOk,
      sourcesTotal: report.sources.length,
      sourcesMode: report.scope.sourcesMode,
      notAssessedCount: report.notAssessed.length,
    };

    // Usage belongs to the execution, not to each control. Attach it to the first event only,
    // so AI Hub usage rollups (which sum tokens/costUsd per event) never double count.
    if (index === 0 && report.usage) {
      for (const key of USAGE_KEYS) {
        if (report.usage[key] !== undefined) dimensions[key] = report.usage[key];
      }
    }

    return {
      correlationId: report.executionId,
      eventId: eventIdFor(report, c.control),
      actors: [actor],
      dimensions,
      summary: cut(c.summary, MAX_SUMMARY),
      obligations: c.obligations.map(summariseObligation),
      actions: c.actions,
      sources: report.sources,
      notAssessed: report.notAssessed,
      detail: details[c.control] ?? NO_DETAIL,
    };
  });
}
