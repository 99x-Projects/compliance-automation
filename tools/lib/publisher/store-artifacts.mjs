// Uploads each control's detailed report to AI Hub as a write-once artifact (AI Hub ADR 0019),
// with the same API key the events use. Nothing is written to the audited repository.
// Network access is injected so tests run offline.
import { artifactDetail, artifactUploads } from '../detail-files.mjs';
import { artifactUrl } from './config.mjs';

const ARTIFACT_ID = /^art_[A-Za-z0-9]{6,32}$/;
// Answers that will be the same for every control of this run: stop after the first.
const SAME_FOR_ALL = new Set([401, 403, 404]);

function explain(status, body) {
  if (status === 401) return 'AI Hub refused the upload (401): the API key is not valid here, or this AI Hub has no artifact store yet';
  if (status === 403) return 'AI Hub refused the upload (403): the API key may not write to this team';
  if (status === 404) return 'AI Hub did not find the activity to upload to (404)';
  if (status === 409) return 'AI Hub already holds a different report under this execution id (409); artifacts are write-once';
  let message = '';
  try {
    message = JSON.parse(body).error ?? '';
  } catch { /* not JSON */ }
  return `AI Hub returned ${status || 'no response'}${message ? `: ${message}` : ''}`;
}

async function uploadOne(body, config, { fetchImpl, sleep, attempts }) {
  let last = { ok: false, status: 0, reason: 'not attempted' };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(artifactUrl(config), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': config.apiKey },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      if (response.ok) {
        let data = {};
        try {
          data = JSON.parse(text);
        } catch { /* handled below */ }
        if (typeof data.artifactId !== 'string' || !ARTIFACT_ID.test(data.artifactId)) {
          return { ok: false, status: response.status, reason: 'AI Hub accepted the upload but returned no artifact id' };
        }
        // The event will vouch for this hash, so it has to be the hash of what AI Hub stored.
        if (data.sha256 !== body.sha256) {
          return { ok: false, status: response.status, reason: 'AI Hub stored different bytes than were sent (SHA-256 mismatch)' };
        }
        return { ok: true, artifactId: data.artifactId, created: data.created !== false };
      }
      last = { ok: false, status: response.status, reason: explain(response.status, text) };
      if (response.status < 500 && response.status !== 429) return last;
    } catch (err) {
      last = { ok: false, status: 0, reason: `AI Hub could not be reached: ${String(err?.message ?? err)}` };
    }
    if (attempt < attempts) await sleep(1000 * 2 ** (attempt - 1));
  }
  return last;
}

// Returns { details, stored, failed }: details maps control id → detail, for every control.
// A failed upload is recorded on that control's event; it never stops the summary being sent.
export async function storeArtifacts(report, config, { fetchImpl = fetch, sleep = defaultSleep, attempts = 3 } = {}) {
  const details = {};
  const failed = [];
  let stored = 0;
  let abandon = null;

  for (const { control, body } of artifactUploads(report)) {
    const result = abandon ?? await uploadOne(body, config, { fetchImpl, sleep, attempts });
    if (result.ok) {
      stored += 1;
      details[control] = artifactDetail(body, result.artifactId);
    } else {
      failed.push({ control, reason: result.reason });
      details[control] = { status: 'failed', reason: result.reason };
      if (SAME_FOR_ALL.has(result.status)) abandon = result;
    }
  }
  return { details, stored, failed };
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
