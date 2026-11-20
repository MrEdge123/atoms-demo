import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_JSON = process.argv[2];
const ENV_LOCAL_PATH = path.join(ROOT_DIR, '.env.local');
const ENV_EXAMPLE_PATH = path.join(ROOT_DIR, '.env.example');

const VENDOR_ENV_MAP = {
  deepseek: 'DEEPSEEK_API_KEY',
  kimi: 'KIMI_API_KEY',
  moonshot: 'KIMI_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  claude: 'ANTHROPIC_API_KEY',
};

function maskSecret(val) {
  if (!val || val.length <= 10) return '***';
  return `${val.slice(0, 7)}...${val.slice(-4)}`;
}

function parseEnvLines(content) {
  return content.split(/\r?\n/);
}

function upsertEnvVar(lines, key, value) {
  const prefix = `${key}=`;
  let updated = false;
  const next = lines.map((line) => {
    if (line.startsWith(prefix)) {
      updated = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!updated) {
    next.push(`${key}=${value}`);
  }
  return next;
}

function main() {
  if (!SOURCE_JSON) {
    throw new Error('Usage: node scripts/sync-api-keys.mjs <path-to-api-keys.json>');
  }
  if (!fs.existsSync(SOURCE_JSON)) {
    throw new Error(`API key JSON file not found: ${SOURCE_JSON}`);
  }

  const rawJson = fs.readFileSync(SOURCE_JSON, 'utf8').replace(/^\uFEFF/, '');
  const parsed = JSON.parse(rawJson);

  const baseContent = fs.existsSync(ENV_LOCAL_PATH)
    ? fs.readFileSync(ENV_LOCAL_PATH, 'utf8')
    : fs.existsSync(ENV_EXAMPLE_PATH)
      ? fs.readFileSync(ENV_EXAMPLE_PATH, 'utf8')
      : '';

  let lines = parseEnvLines(baseContent);
  // Remove trailing empty lines before appending, re-add one newline at end
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  const synced = [];
  for (const [vendor, apiKey] of Object.entries(parsed)) {
    const envName = VENDOR_ENV_MAP[vendor.trim().toLowerCase()];
    if (!envName || typeof apiKey !== 'string' || !apiKey.trim()) {
      continue;
    }
    const cleanKey = apiKey.trim();
    lines = upsertEnvVar(lines, envName, cleanKey);
    synced.push({ vendor, envName, masked: maskSecret(cleanKey) });
  }

  if (synced.length === 0) {
    throw new Error('No recognized vendor API keys found in source JSON.');
  }

  // Ensure real LLM mode and live-verified vendor defaults are present
  lines = upsertEnvVar(lines, 'LLM_ADAPTER', 'vercel-ai');
  lines = upsertEnvVar(lines, 'DEFAULT_LLM_MODEL', 'deepseek:deepseek-v4-pro');
  if (!lines.some((l) => l.startsWith('DEEPSEEK_BASE_URL='))) {
    lines = upsertEnvVar(lines, 'DEEPSEEK_BASE_URL', 'https://api.deepseek.com/v1');
  }
  lines = upsertEnvVar(lines, 'DEEPSEEK_MODEL', 'deepseek-v4-pro');
  if (!lines.some((l) => l.startsWith('KIMI_BASE_URL='))) {
    lines = upsertEnvVar(lines, 'KIMI_BASE_URL', 'https://api.moonshot.cn/v1');
  }
  lines = upsertEnvVar(lines, 'KIMI_MODEL', 'kimi-k2.7-code');

  fs.writeFileSync(ENV_LOCAL_PATH, `${lines.join('\n')}\n`, 'utf8');
  console.log('Synced API credentials to .env.local (masked):');
  for (const item of synced) {
    console.log(`- ${item.vendor} -> ${item.envName} (${item.masked})`);
  }
}

main();
