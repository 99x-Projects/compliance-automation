export function githubHeaders(config) {
  return {
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    ...(config.githubToken ? { Authorization: `Bearer ${config.githubToken}` } : {}),
    'User-Agent': 'compliance-automation-publisher',
  };
}
