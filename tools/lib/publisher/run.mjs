// The publisher: compliance-report.json → detailed report committed to the repository →
// validated summary events → POST to AI Hub (option B) or file (option A).
// Every side effect is injected so the whole flow is testable offline.
//
// A detailed report that cannot be committed is a warning, never a failure: the summary still
// goes to AI Hub, with detail.status telling the dashboard why there is no link.
//
// Exit codes: 0 done (delivered, written, or preserved in the fallback issue comment)
//             2 the report or events are invalid — fix compliance-report.json and run again
//             3 configuration error (only when publishing is enabled)
//             4 delivery failed and the fallback comment could not be posted either
import { flatten } from '../flatten.mjs';
import { createValidators, validateEvents, validateReport } from '../contracts.mjs';
import { configErrors, detailWarnings, readConfig } from './config.mjs';
import { finalizeReport } from './finalize.mjs';
import { redactDeep, secretValuesFromEnv } from './redact.mjs';
import {
  buildDetailComment, buildIssueComments, checkReachable, fetchIssueComment, parseIssueComment, postEvents, postIssueComment,
} from './deliver.mjs';
import { storeDetail } from './store-detail.mjs';
import { detailFiles } from '../detail-files.mjs';

const MAX_DETAIL_COMMENTS = 10;

export const USAGE = `Usage: publish-aihub [options]
  --check               check publishing configuration and exit
  --report <path>       skill output to publish (default: compliance-report.json)
  --out <path>          where to write the events (default: aihub-event.json)
  --dry-run             build, validate and write the events, but do not POST
  --from-file <path>    re-send events saved earlier
  --from-issue <url>    re-send events from a fallback GitHub issue comment (repeat for each part)

Environment: AIHUB_PUBLISH=1 to POST; AIHUB_URL, AIHUB_NODE_ID, AIHUB_ACTIVITY_ID, AIHUB_API_KEY;
GITHUB_TOKEN to commit the detailed report (COMPLIANCE_DETAIL_STORE=github|off,
COMPLIANCE_DETAIL_REPO default: the audited repository, COMPLIANCE_DETAIL_BRANCH default: compliance-audits);
optional EXECUTION_ID, AIHUB_ACTOR, AIHUB_FALLBACK_ISSUE (owner/repo#n).`;

function parseArgs(argv) {
  const opts = { report: 'compliance-report.json', out: 'aihub-event.json' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--check') opts.check = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--from-issue') {
      if (!argv[i + 1]) throw new Error(`${a} needs a value`);
      (opts.fromIssue ??= []).push(argv[i += 1]);
    } else if (['--report', '--out', '--from-file'].includes(a)) {
      const key = a.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase());
      opts[key] = argv[i += 1];
      if (!opts[key]) throw new Error(`${a} needs a value`);
    } else throw new Error(`unknown option ${a}`);
  }
  return opts;
}

export async function run({ argv, env, deps }) {
  const { readText, writeText, gitInfo, fetchImpl, sleep, now = () => new Date(), log, pluginVersion, catalogs } = deps;
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    log(`✗ ${err.message}\n${USAGE}`);
    return 2;
  }
  if (opts.help) {
    log(USAGE);
    return 0;
  }

  const config = readConfig(env);
  const cfgErrors = configErrors(config);

  if (opts.check) {
    if (!config.publish) {
      log('✓ publishing is off (AIHUB_PUBLISH is not 1): the report will be written but not sent');
      return 0;
    }
    if (cfgErrors.length) {
      for (const e of cfgErrors) log(`✗ ${e}`);
      return 3;
    }
    for (const w of detailWarnings(config)) log(`⚠ ${w}`);
    const reach = await checkReachable(config, { fetchImpl });
    log(reach.reachable
      ? `✓ publishing configured; AI Hub answered (${reach.status})`
      : `⚠ publishing configured, but AI Hub did not answer (${reach.error}). The audit runs anyway; delivery retries at the end.`);
    return 0;
  }

  const validators = createValidators();
  let events;

  if (opts.fromFile || opts.fromIssue) {
    try {
      if (opts.fromFile) events = JSON.parse(await readText(opts.fromFile));
      else {
        events = [];
        for (const url of opts.fromIssue) events.push(...parseIssueComment(await fetchIssueComment(config, url, { fetchImpl })));
      }
    } catch (err) {
      log(`✗ could not load events: ${err.message}`);
      return 2;
    }
    const errors = validateEvents(validators, events, catalogs);
    if (errors.length) {
      for (const e of errors) log(`✗ ${e}`);
      return 2;
    }
  } else {
    let raw;
    try {
      raw = JSON.parse(await readText(opts.report));
    } catch (err) {
      log(`✗ could not read ${opts.report}: ${err.message}`);
      return 2;
    }
    const { report: finalized, notes } = finalizeReport(raw, {
      executionId: config.executionId, pluginVersion, git: await gitInfo(), now: now(),
    });
    for (const n of notes) log(`ℹ ${n}`);

    const { value: report, count } = redactDeep(finalized, secretValuesFromEnv(env));
    if (count) log(`⚠ removed ${count} secret-looking value(s) from the report before publishing`);

    const reportErrors = validateReport(validators, report, catalogs);
    if (reportErrors.length) {
      log(`✗ ${opts.report} does not match the compliance-report.v1 contract:`);
      for (const e of reportErrors) log(`    ${e}`);
      return 2;
    }
    // Validate the summary before any side effect, so an invalid report never reaches the repository.
    const previewErrors = validateEvents(validators, flatten(report, { actor: config.actor }), catalogs);
    if (previewErrors.length) {
      for (const e of previewErrors) log(`✗ ${e}`);
      return 2;
    }

    const willPublish = config.publish && !opts.dryRun && cfgErrors.length === 0;
    const details = willPublish
      ? await resolveDetails(report, config, { fetchImpl, log })
      : allDetails(report, { status: 'disabled', reason: opts.dryRun ? 'dry run' : 'publishing is off' });

    events = flatten(report, { actor: config.actor, details });
    const eventErrors = validateEvents(validators, events, catalogs);
    if (eventErrors.length) {
      for (const e of eventErrors) log(`✗ ${e}`);
      return 2;
    }
    await writeText(opts.out, `${JSON.stringify(events, null, 2)}\n`);
    log(`✓ ${events.length} event(s) written to ${opts.out} (${events.map((e) => `${e.dimensions.control}: ${e.dimensions.overall}`).join(', ')})`);
  }

  if (opts.dryRun || !config.publish) {
    log(opts.dryRun ? 'ℹ dry run: nothing sent' : 'ℹ publishing is off: nothing sent');
    return 0;
  }
  if (cfgErrors.length) {
    for (const e of cfgErrors) log(`✗ ${e}`);
    return 3;
  }

  const result = await postEvents(events, config, { fetchImpl, sleep });
  if (result.ok) {
    log(`✓ delivered to AI Hub (${result.status}) after ${result.attempts} attempt(s)`);
    return 0;
  }
  const reason = `AI Hub returned ${result.status || 'no response'} after ${result.attempts} attempt(s): ${result.error}`;
  log(`✗ ${reason}`);

  const urls = [];
  for (const body of buildIssueComments(events, reason)) {
    const comment = await postIssueComment(config, body, { fetchImpl });
    if (!comment.ok) {
      log(`✗ fallback comment failed (${comment.error}); events remain in ${opts.out} for this run only`);
      return 4;
    }
    urls.push(comment.url);
  }
  log(`✓ results preserved in ${urls.join(', ')} — re-send later with ${urls.map((u) => `--from-issue ${u}`).join(' ')}`);
  return 0;
}

function allDetails(report, detail) {
  return Object.fromEntries(report.controls.map((c) => [c.control, detail]));
}

const reasonText = (text) => (text.length > 300 ? `${text.slice(0, 299)}…` : text);

async function resolveDetails(report, config, { fetchImpl, log }) {
  if (config.detailStore === 'off') {
    return allDetails(report, { status: 'disabled', reason: 'COMPLIANCE_DETAIL_STORE is off' });
  }
  if (!config.githubToken) {
    log('⚠ GITHUB_TOKEN is not set: the detailed report is not stored; AI Hub gets the summary only');
    return allDetails(report, { status: 'failed', reason: 'no GitHub token in the run' });
  }

  const stored = await storeDetail(report, config, { fetchImpl });
  if (stored.ok) {
    log(`✓ detailed report committed to ${stored.target.repository}@${stored.target.branch} (${stored.commit.slice(0, 7)})`);
    return stored.details;
  }
  const reason = reasonText(`commit to ${stored.target.repository}@${stored.target.branch} failed: ${stored.error}`);
  log(`⚠ ${reason}`);

  if (!config.fallbackIssue || report.controls.length > MAX_DETAIL_COMMENTS) {
    return allDetails(report, { status: 'failed', reason });
  }
  const details = {};
  for (const c of detailFiles(report).controls) {
    const comment = await postIssueComment(config, buildDetailComment(c.control, c.content, reason), { fetchImpl });
    details[c.control] = comment.ok
      ? { status: 'issue-comment', url: comment.url, reason }
      : { status: 'failed', reason };
    if (comment.ok) log(`✓ detailed report for ${c.control} kept in ${comment.url}`);
  }
  return details;
}
