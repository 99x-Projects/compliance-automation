// Fitness function F4: no secret leaves the run. Every string in the report is scanned for the
// values of secret-looking environment variables and for well-known token formats.

export const REDACTED = '[REDACTED]';

const SECRET_ENV_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|PAT|CREDENTIAL|CONNECTION)/i;
const TOKEN_PATTERNS = [
  /\bah_(?:tm|pat)_[A-Za-z0-9_-]{8,}/g, // AI Hub team keys and PATs
  /\bwhs_[A-Fa-f0-9]{16,}/g, // AI Hub webhook secrets
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bsk-ant-[A-Za-z0-9_-]{16,}/g, // Anthropic
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

export function secretValuesFromEnv(env) {
  return Object.entries(env)
    .filter(([name, value]) => SECRET_ENV_NAME.test(name) && typeof value === 'string' && value.length >= 8)
    .map(([, value]) => value)
    .sort((a, b) => b.length - a.length);
}

export function redactString(text, secretValues) {
  let count = 0;
  let out = text;
  for (const value of secretValues) {
    if (out.includes(value)) {
      count += out.split(value).length - 1;
      out = out.split(value).join(REDACTED);
    }
  }
  for (const pattern of TOKEN_PATTERNS) {
    out = out.replace(pattern, () => {
      count += 1;
      return REDACTED;
    });
  }
  return { text: out, count };
}

export function redactDeep(value, secretValues) {
  let total = 0;
  const walk = (v) => {
    if (typeof v === 'string') {
      const { text, count } = redactString(v, secretValues);
      total += count;
      return text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value), count: total };
}
