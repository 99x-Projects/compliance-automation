// The detailed report: one Markdown report per control, which each event links to with its
// SHA-256. It is stored as AI Hub artifacts (the default) or committed to a repository, where one
// folder per execution also holds the full compliance-report.json.
import { createHash } from 'node:crypto';
import { eventIdFor } from './flatten.mjs';

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

// One upload per control for AI Hub's artifact store. The key is the control's eventId, so a
// retried run finds what its first attempt stored instead of storing it twice.
export function artifactUploads(report) {
  return detailFiles(report).controls.map((c) => {
    const id = eventIdFor(report, c.control);
    return {
      control: c.control,
      body: {
        key: id,
        kind: 'report',
        name: `${safe(c.control)}.md`,
        contentType: 'text/markdown',
        content: c.content,
        sha256: sha256(c.content),
        correlationId: report.executionId,
        eventId: id,
        attributes: { standardKey: report.standardKey, control: c.control, repository: report.repository },
      },
    };
  });
}

// The detail an event carries once AI Hub has stored an upload and answered with its id.
export function artifactDetail(body, artifactId) {
  return {
    status: 'stored',
    provider: 'aihub',
    artifactId,
    byteSize: Buffer.byteLength(body.content, 'utf8'),
    sha256: body.sha256,
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
