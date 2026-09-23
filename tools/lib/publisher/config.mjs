// Publisher configuration from the environment. Xianix passes env names in dashed form
// (AIHUB-API-KEY); local shells use underscores. Both are accepted.
import { DEFAULT_DETAIL_BRANCH } from '../detail-files.mjs';

export function envValue(env, name) {
  const dashed = name.replace(/_/g, '-');
  const value = env[name] ?? env[dashed];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

export function readConfig(env) {
  const publish = envValue(env, 'AIHUB_PUBLISH');
  return {
    publish: publish === '1' || publish?.toLowerCase() === 'true',
    url: envValue(env, 'AIHUB_URL')?.replace(/\/+$/, ''),
    nodeId: envValue(env, 'AIHUB_NODE_ID'),
    activityId: envValue(env, 'AIHUB_ACTIVITY_ID'),
    apiKey: envValue(env, 'AIHUB_API_KEY'),
    actor: envValue(env, 'AIHUB_ACTOR') ?? 'ISO Audit Agent',
    executionId: envValue(env, 'EXECUTION_ID'),
    fallbackIssue: envValue(env, 'AIHUB_FALLBACK_ISSUE'),
    githubToken: envValue(env, 'GITHUB_TOKEN'),
    githubApiUrl: (envValue(env, 'GITHUB_API_URL') ?? 'https://api.github.com').replace(/\/+$/, ''),
    githubServerUrl: (envValue(env, 'GITHUB_SERVER_URL') ?? 'https://github.com').replace(/\/+$/, ''),
    // Where the detailed report goes. Default: nowhere. The audited repository is usually the
    // customer's, so committing findings there has to be a deliberate choice, never a default.
    // AI Hub's artifact store becomes the default once it exists (ADR 0019).
    detailStore: envValue(env, 'COMPLIANCE_DETAIL_STORE')?.toLowerCase() ?? 'off',
    detailRepo: envValue(env, 'COMPLIANCE_DETAIL_REPO')?.toLowerCase(),
    detailBranch: envValue(env, 'COMPLIANCE_DETAIL_BRANCH') ?? DEFAULT_DETAIL_BRANCH,
  };
}

// Configuration errors only matter when publishing is on. They never depend on the Hub being up.
export function configErrors(config) {
  if (!config.publish) return [];
  const errors = [];
  if (!config.url) errors.push('AIHUB_URL is not set');
  else if (!/^https:\/\/[^\s/]+/.test(config.url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(config.url)) {
    errors.push('AIHUB_URL must be an https URL (http is allowed only for localhost)');
  }
  if (!config.nodeId) errors.push('AIHUB_NODE_ID is not set');
  else if (!/^nd_[A-Za-z0-9_-]{6,}$/.test(config.nodeId)) errors.push('AIHUB_NODE_ID must look like nd_…');
  if (!config.activityId) errors.push('AIHUB_ACTIVITY_ID is not set');
  else if (!/^na_[A-Za-z0-9_-]{6,}$/.test(config.activityId)) errors.push('AIHUB_ACTIVITY_ID must look like na_…');
  if (!config.apiKey) errors.push('AIHUB_API_KEY is not set');
  else if (!/^ah_(tm|pat)_/.test(config.apiKey)) errors.push('AIHUB_API_KEY must be a team key (ah_tm_…) or a personal access token (ah_pat_…)');
  if (config.fallbackIssue && !/^[\w.-]+\/[\w.-]+#\d+$/.test(config.fallbackIssue)) {
    errors.push('AIHUB_FALLBACK_ISSUE must look like owner/repo#123');
  }
  if (!['github', 'off'].includes(config.detailStore)) errors.push('COMPLIANCE_DETAIL_STORE must be github or off');
  if (config.detailRepo && !/^[a-z0-9._-]+\/[a-z0-9._-]+$/.test(config.detailRepo)) {
    errors.push('COMPLIANCE_DETAIL_REPO must look like owner/repo');
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(config.detailBranch) || config.detailBranch.includes('..')) {
    errors.push('COMPLIANCE_DETAIL_BRANCH is not a valid branch name');
  }
  return errors;
}

// Not errors: the summary still reaches AI Hub, only the link to the detailed report is missing.
export function detailWarnings(config) {
  if (!config.publish || config.detailStore === 'off') return [];
  return config.githubToken ? [] : ['GITHUB_TOKEN is not set: the detailed report cannot be committed and AI Hub will show the summary only'];
}

export function ingestUrl(config) {
  return `${config.url}/metrics/nodes/${encodeURIComponent(config.nodeId)}/node-activities/${encodeURIComponent(config.activityId)}/events`;
}
