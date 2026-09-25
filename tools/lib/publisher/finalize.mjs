// Fills the provenance fields of a skill's report. The LLM writes content; these facts come
// from the environment and git, never from the model.

export const MAX_REPORT_MD = 204800;
const TRUNCATION_MARKER = '\n\n…[report truncated to 200 KB by the publisher]\n';

export function normaliseRepository(value) {
  if (!value) return undefined;
  let s = String(value).trim().replace(/\.git$/i, '');
  const ssh = /^git@[^:]+:(.+)$/.exec(s);
  if (ssh) s = ssh[1];
  const url = /^https?:\/\/[^/]+\/(.+)$/.exec(s);
  if (url) s = url[1];
  // Azure DevOps: org/project/_git/repo → org/repo
  const ado = /^([^/]+)\/[^/]+\/_git\/([^/]+)$/.exec(s);
  if (ado) s = `${ado[1]}/${ado[2]}`;
  const parts = s.split('/').filter(Boolean);
  if (parts.length < 2) return undefined;
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`.toLowerCase();
}

export function localExecutionId(repository, now) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `local-${stamp}-${(repository ?? 'repo').split('/').pop()}`;
}

export function finalizeReport(input, { executionId, pluginVersion, git, now }) {
  const report = structuredClone(input);
  const notes = [];

  const repository = normaliseRepository(git.remote) ?? normaliseRepository(report.repository);
  if (repository) report.repository = repository;
  report.baseline = {
    ref: git.ref ?? report.baseline?.ref ?? 'unknown',
    commit: git.commit ?? report.baseline?.commit,
  };
  report.executionId = executionId ?? localExecutionId(report.repository, now);
  report.pluginVersion = pluginVersion;
  if (!report.runAt || Number.isNaN(Date.parse(report.runAt))) {
    report.runAt = now.toISOString().replace(/\.\d+Z$/, 'Z');
    notes.push('runAt was missing or invalid; set to the publish time');
  }

  for (const control of report.controls ?? []) {
    if (typeof control.reportMd === 'string' && control.reportMd.length > MAX_REPORT_MD) {
      control.reportMd = control.reportMd.slice(0, MAX_REPORT_MD - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
      notes.push(`reportMd for ${control.control} truncated to 200 KB`);
    }
  }
  return { report, notes };
}
