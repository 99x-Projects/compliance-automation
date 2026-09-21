// The publisher: compliance-report.json → validated AI Hub events → POST (option B) or file (option A).
// Every side effect is injected so the whole flow is testable offline.
//
// Exit codes: 0 done (delivered, written, or preserved in the fallback issue comment)
//             2 the report or events are invalid — fix compliance-report.json and run again
//             3 configuration error (only when publishing is enabled)
//             4 delivery failed and the fallback comment could not be posted either
import { flatten } from '../flatten.mjs';
import { createValidators, validateEvents, validateReport } from '../contracts.mjs';
import { configErrors, readConfig } from './config.mjs';
import { finalizeReport } from './finalize.mjs';
import { redactDeep, secretValuesFromEnv } from './redact.mjs';
import {
  buildIssueComment, checkReachable, fetchIssueComment, parseIssueComment, postEvents, postIssueComment,
} from './deliver.mjs';

export const USAGE = `Usage: publish-aihub [options]
  --check               check publishing configuration and exit
  --report <path>       skill output to publish (default: compliance-report.json)
  --out <path>          where to write the events (default: aihub-event.json)
  --dry-run             build, validate and write the events, but do not POST
  --from-file <path>    re-send events saved earlier
  --from-issue <url>    re-send events from a fallback GitHub issue comment

Environment: AIHUB_PUBLISH=1 to POST; AIHUB_URL, AIHUB_NODE_ID, AIHUB_ACTIVITY_ID, AIHUB_API_KEY;
optional EXECUTION_ID, AIHUB_ACTOR, AIHUB_FALLBACK_ISSUE (owner/repo#n) with GITHUB_TOKEN.`;

function parseArgs(argv) {
  const opts = { report: 'compliance-report.json', out: 'aihub-event.json' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--check') opts.check = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (['--report', '--out', '--from-file', '--from-issue'].includes(a)) {
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
      events = opts.fromFile
        ? JSON.parse(await readText(opts.fromFile))
        : parseIssueComment(await fetchIssueComment(config, opts.fromIssue, { fetchImpl }));
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
    events = flatten(report, { actor: config.actor });
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

  const comment = await postIssueComment(config, buildIssueComment(events, reason), { fetchImpl });
  if (comment.ok) {
    log(`✓ results preserved in ${comment.url} — re-send later with --from-issue`);
    return 0;
  }
  log(`✗ fallback comment failed (${comment.error}); events remain in ${opts.out} for this run only`);
  return 4;
}
