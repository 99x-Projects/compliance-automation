// POST to AI Hub with retry, and the GitHub issue-comment fallback. Network access is injected
// (fetchImpl, sleep) so tests run offline.
import { ingestUrl } from './config.mjs';

export const COMMENT_MARKER = '<!-- aihub-compliance-event -->';
const GITHUB_COMMENT_LIMIT = 65536;

export async function postEvents(events, config, { fetchImpl = fetch, sleep = defaultSleep, attempts = 3 } = {}) {
  let last = { ok: false, status: 0, error: 'not attempted', attempts: 0 };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(ingestUrl(config), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': config.apiKey },
        body: JSON.stringify(events),
      });
      const body = await response.text();
      if (response.ok) return { ok: true, status: response.status, body, attempts: attempt };
      last = { ok: false, status: response.status, error: body.slice(0, 500), attempts: attempt };
      const retryable = response.status >= 500 || response.status === 429;
      if (!retryable) return last;
    } catch (err) {
      last = { ok: false, status: 0, error: String(err?.message ?? err), attempts: attempt };
    }
    if (attempt < attempts) await sleep(1000 * 2 ** (attempt - 1));
  }
  return last;
}

export async function checkReachable(config, { fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl(config.url, { method: 'GET' });
    return { reachable: true, status: response.status };
  } catch (err) {
    return { reachable: false, error: String(err?.message ?? err) };
  }
}

export function buildIssueComment(events, reason) {
  const header = [
    COMMENT_MARKER,
    '### Compliance results were not delivered to AI Hub',
    '',
    `Reason: ${reason}`,
    '',
    'The events are below with secrets removed. Re-send them with:',
    '',
    '```bash',
    'node <plugin>/scripts/publish-aihub.mjs --from-issue <this comment URL>',
    '```',
    '',
  ].join('\n');
  const wrap = (json) => `${header}<details><summary>Event JSON</summary>\n\n\`\`\`json\n${json}\n\`\`\`\n\n</details>\n`;
  let body = wrap(JSON.stringify(events, null, 2));
  if (body.length > GITHUB_COMMENT_LIMIT) {
    const slim = events.map((e) => ({ ...e, reportMd: '(omitted: too large for a GitHub comment — see the run output)' }));
    body = wrap(JSON.stringify(slim));
  }
  return body;
}

export function parseIssueComment(body) {
  if (!body.includes(COMMENT_MARKER)) throw new Error('comment was not written by the compliance publisher');
  const match = /```json\n([\s\S]*?)\n```/.exec(body);
  if (!match) throw new Error('comment has no event JSON block');
  return JSON.parse(match[1]);
}

export function parseIssueRef(ref) {
  const m = /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(ref);
  return m ? { owner: m[1], repo: m[2], number: Number(m[3]) } : null;
}

export function parseCommentUrl(url) {
  const m = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:issues|pull)\/\d+#issuecomment-(\d+)$/.exec(url);
  return m ? { owner: m[1], repo: m[2], commentId: m[3] } : null;
}

export async function postIssueComment(config, body, { fetchImpl = fetch } = {}) {
  const issue = parseIssueRef(config.fallbackIssue ?? '');
  if (!issue || !config.githubToken) return { ok: false, error: 'no fallback issue or GitHub token configured' };
  const response = await fetchImpl(`https://api.github.com/repos/${issue.owner}/${issue.repo}/issues/${issue.number}/comments`, {
    method: 'POST',
    headers: githubHeaders(config),
    body: JSON.stringify({ body }),
  });
  const data = await response.json().catch(() => ({}));
  return response.ok ? { ok: true, url: data.html_url } : { ok: false, error: `GitHub returned ${response.status}` };
}

export async function fetchIssueComment(config, url, { fetchImpl = fetch } = {}) {
  const ref = parseCommentUrl(url);
  if (!ref) throw new Error('expected a GitHub comment URL like https://github.com/o/r/issues/1#issuecomment-123');
  const response = await fetchImpl(`https://api.github.com/repos/${ref.owner}/${ref.repo}/issues/comments/${ref.commentId}`, {
    headers: githubHeaders(config),
  });
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
  return (await response.json()).body;
}

function githubHeaders(config) {
  return {
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    ...(config.githubToken ? { Authorization: `Bearer ${config.githubToken}` } : {}),
    'User-Agent': 'compliance-automation-publisher',
  };
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
