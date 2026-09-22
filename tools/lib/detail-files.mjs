// The detailed report as it is committed to a repository: one folder per execution, holding the
// full compliance-report.json and one Markdown report per control. AI Hub events link to the
// control's Markdown file by commit permalink and carry its SHA-256.
import { createHash } from 'node:crypto';

export const DEFAULT_DETAIL_BRANCH = 'compliance-audits';

const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '-');

export function detailFolder(report) {
  const stamp = report.runAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `audits/${report.standardKey}/${stamp}--${safe(report.executionId)}`;
}

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// Files in commit order; each control's Markdown is keyed by control id.
export function detailFiles(report) {
  const folder = detailFolder(report);
  const controls = report.controls.map((c) => ({
    control: c.control,
    path: `${folder}/${safe(c.control)}.md`,
    content: c.reportMd.endsWith('\n') ? c.reportMd : `${c.reportMd}\n`,
  }));
  return {
    folder,
    controls,
    files: [
      { path: `${folder}/compliance-report.json`, content: `${JSON.stringify(report, null, 2)}\n` },
      ...controls.map(({ path, content }) => ({ path, content })),
    ],
  };
}

export function blobUrl(serverUrl, repository, commit, path) {
  return `${serverUrl.replace(/\/+$/, '')}/${repository}/blob/${commit}/${path}`;
}

// Detail objects for every control of a commit that holds detailFiles(report).
export function storedDetails(report, { repository, branch, commit, serverUrl = 'https://github.com' }) {
  const { controls } = detailFiles(report);
  return Object.fromEntries(controls.map((c) => [c.control, {
    status: 'stored',
    provider: 'github',
    repository,
    branch,
    commit,
    path: c.path,
    url: blobUrl(serverUrl, repository, commit, c.path),
    sha256: sha256(c.content),
  }]));
}
