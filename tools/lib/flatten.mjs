// Reference flattener: one compliance report (report.json) → AI Hub events (one per control).
// The publisher (delivery step 3) uses this exact function; the golden event samples are
// generated from it, so contract tests catch any drift between the two.

export const DEFAULT_ACTOR = 'ISO Audit Agent';
export const EVENT_SCHEMA = 'compliance.v1';
const USAGE_KEYS = ['tokens', 'cacheReadTokens', 'costUsd', 'model'];

export function eventIdFor(report, control) {
  return `${report.standardKey}:${control}:${report.repository}:${report.executionId}`;
}

export function tally(obligations) {
  const counts = { Conform: 0, Partial: 0, Gap: 0, 'N/A': 0 };
  for (const o of obligations) counts[o.verdict] += 1;
  return counts;
}

export function flatten(report, { actor = DEFAULT_ACTOR } = {}) {
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
      summary: c.summary,
      obligations: c.obligations,
      actions: c.actions,
      sources: report.sources,
      sections: c.sections,
      notAssessed: report.notAssessed,
      reportMd: c.reportMd,
    };
  });
}
