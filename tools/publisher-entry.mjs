// Entry point bundled into plugins/operation/scripts/publish-aihub.mjs (npm run build:publisher).
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { run } from './lib/publisher/run.mjs';
import { PRODUCTION_CATALOGS } from './lib/contract-data.mjs';

/* global __PLUGIN_VERSION__ */
const pluginVersion = typeof __PLUGIN_VERSION__ === 'string' ? __PLUGIN_VERSION__ : 'operation@dev';

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined;
  } catch {
    return undefined;
  }
}

async function gitInfo() {
  let ref = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!ref || ref === 'HEAD') {
    // Xianix checks out a detached worktree of the default branch.
    ref = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])?.replace(/^origin\//, '');
  }
  return {
    remote: git(['remote', 'get-url', 'origin']),
    commit: git(['rev-parse', '--short=7', 'HEAD']),
    ref,
  };
}

const code = await run({
  argv: process.argv.slice(2),
  env: process.env,
  deps: {
    readText: (p) => readFile(p, 'utf8'),
    writeText: (p, t) => writeFile(p, t),
    gitInfo,
    fetchImpl: fetch,
    log: (m) => console.log(m),
    pluginVersion,
    catalogs: PRODUCTION_CATALOGS,
  },
});
process.exit(code);
