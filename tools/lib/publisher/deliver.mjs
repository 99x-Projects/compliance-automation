// POST to AI Hub with retry, and the GitHub issue-comment fallback. Network access is injected
// (fetchImpl, sleep) so tests run offline.
import { ingestUrl } from './config.mjs';
import { githubHeaders } from './github.mjs';

export const COMMENT_MARKER = '<!-- aihub-compliance-event -->';
export const DETAIL_MARKER = '<!-- compliance-detail-report -->';
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

// One comment per chunk of events that fits GitHub's comment limit. Each is re-sendable on its own.
export function buildIssueComments(events, reason) {
  const chunks = [];
  let current = [];
  for (const event of events) {
    if (current.length && buildIssueComment([...current, event], reason).length > GITHUB_COMMENT_LIMIT) {
      chunks.push(current);
      current = [];
    }
    current.push(event);
  }
  if (current.length) chunks.push(current);
  return chunks.map((chunk, i) => buildIssueComment(chunk, reason, chunks.length > 1 ? `part ${i + 1} of ${chunks.length}` : ''));
}

export function buildIssueComment(events, reason, part = '') {
  const header = [
    COMMENT_MARKER,
    `### Compliance results were not delivered to AI Hub${part ? ` (${part})` : ''}`,
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
  const body = wrap(JSON.stringify(events, null, 2));
  return body.length > GITHUB_COMMENT_LIMIT ? wrap(JSON.stringify(events)) : body;
}

// Used when the detailed report could not be committed: the control's Markdown report goes to
// the triggering issue instead, so it outlives the run's workspace.
export function buildDetailComment(control, markdown, reason) {
  const header = [
    DETAIL_MARKER,
    `### Detailed compliance report: ${control}`,
    '',
    `It could not be committed to the repository (${reason}), so it is kept here. AI Hub links to this comment.`,
    '',
    '---',
    '',
  ].join('\n');
  const room = GITHUB_COMMENT_LIMIT - header.length - 200;
  return header + (markdown.length > room ? `${markdown.slice(0, room)}\n\n…[truncated to fit a GitHub comment]\n` : markdown);
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
  const response = await fetchImpl(`${config.githubApiUrl}/repos/${issue.owner}/${issue.repo}/issues/${issue.number}/comments`, {
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
  const response = await fetchImpl(`${config.githubApiUrl}/repos/${ref.owner}/${ref.repo}/issues/comments/${ref.commentId}`, {
    headers: githubHeaders(config),
  });
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
  return (await response.json()).body;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
