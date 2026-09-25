// Commits the detailed report to a dedicated branch (default: compliance-audits) through the
// GitHub Git Data API. The branch shares no history with the code, so audits never trigger CI,
// never meet branch protection, and are never read back as evidence by the next audit.
// Network access is injected so tests run offline.
import { detailFiles, storedDetails } from '../detail-files.mjs';
import { githubHeaders } from './github.mjs';

const MAX_ATTEMPTS = 3;

async function call(fetchImpl, config, method, path, body) {
  const response = await fetchImpl(`${config.githubApiUrl}${path}`, {
    method,
    headers: githubHeaders(config),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, data };
}

class GitHubError extends Error {
  constructor(step, status) {
    super(`${step}: GitHub returned ${status}`);
    this.status = status;
  }
}

async function commitOnce(files, report, target, config, fetchImpl) {
  const repo = `/repos/${target.repository}`;
  const ref = await call(fetchImpl, config, 'GET', `${repo}/git/ref/heads/${target.branch}`);
  if (!ref.ok && ref.status !== 404) throw new GitHubError('read branch', ref.status);
  const parent = ref.ok ? ref.data.object.sha : null;

  let baseTree;
  if (parent) {
    const commit = await call(fetchImpl, config, 'GET', `${repo}/git/commits/${parent}`);
    if (!commit.ok) throw new GitHubError('read branch head', commit.status);
    baseTree = commit.data.tree.sha;
  }

  const tree = await call(fetchImpl, config, 'POST', `${repo}/git/trees`, {
    ...(baseTree ? { base_tree: baseTree } : {}),
    tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
  });
  if (!tree.ok) throw new GitHubError('write tree', tree.status);

  const controls = report.controls.map((c) => `${c.control} ${c.overall}`).join(', ');
  const commit = await call(fetchImpl, config, 'POST', `${repo}/git/commits`, {
    message: `Compliance audit ${report.standardKey} (${controls})\n\nExecution: ${report.executionId}\nAudited: ${report.repository}@${report.baseline.commit}\nRun at: ${report.runAt}\n`,
    tree: tree.data.sha,
    parents: parent ? [parent] : [],
  });
  if (!commit.ok) throw new GitHubError('write commit', commit.status);

  // Never force: if another run moved the branch meanwhile, GitHub answers 422 and we retry on top of it.
  const move = parent
    ? await call(fetchImpl, config, 'PATCH', `${repo}/git/refs/heads/${target.branch}`, { sha: commit.data.sha, force: false })
    : await call(fetchImpl, config, 'POST', `${repo}/git/refs`, { ref: `refs/heads/${target.branch}`, sha: commit.data.sha });
  if (!move.ok) throw new GitHubError('move branch', move.status);
  return commit.data.sha;
}

// Returns { ok: true, details } (control id → detail) or { ok: false, error }.
export async function storeDetail(report, config, { fetchImpl = fetch } = {}) {
  const target = { repository: config.detailRepo ?? report.repository, branch: config.detailBranch };
  const { files } = detailFiles(report);
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const commit = await commitOnce(files, report, target, config, fetchImpl);
      return {
        ok: true,
        commit,
        details: storedDetails(report, { ...target, commit, serverUrl: config.githubServerUrl }),
        target,
      };
    } catch (err) {
      lastError = err;
      // 409/422 on the branch = a concurrent run won the race; anything else will not improve.
      const race = err instanceof GitHubError && [409, 422].includes(err.status) && err.message.startsWith('move branch');
      if (!race) break;
    }
  }
  return { ok: false, error: String(lastError?.message ?? lastError), target };
}
