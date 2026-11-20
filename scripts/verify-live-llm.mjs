import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_LOCAL_PATH = path.join(ROOT_DIR, '.env.local');

function loadEnvLocal() {
  if (!fs.existsSync(ENV_LOCAL_PATH)) {
    throw new Error(`.env.local not found at ${ENV_LOCAL_PATH}`);
  }
  const lines = fs.readFileSync(ENV_LOCAL_PATH, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function probeModels(label, baseUrls, apiKey) {
  for (const baseUrl of baseUrls) {
    const clean = baseUrl.replace(/\/$/, '');
    try {
      const res = await fetch(`${clean}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        // Ignore non-JSON error
      }
      if (res.ok && json && Array.isArray(json.data)) {
        const ids = json.data.map((m) => m.id);
        return { ok: true, baseUrl: clean, models: ids };
      }
      console.log(`[${label}] ${clean}/models -> HTTP ${res.status}: ${text.slice(0, 180)}`);
    } catch (err) {
      console.log(
        `[${label}] ${clean}/models -> ERR: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return { ok: false, baseUrl: baseUrls[0], models: [] };
}

async function runModelDiscovery() {
  const dsKey = process.env.DEEPSEEK_API_KEY?.trim();
  const kimiKey = process.env.KIMI_API_KEY?.trim();

  if (dsKey) {
    const res = await probeModels(
      'deepseek',
      [process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1'],
      dsKey
    );
    console.log('DeepSeek probe:', JSON.stringify(res));
  } else {
    console.log('DeepSeek probe: missing DEEPSEEK_API_KEY');
  }

  if (kimiKey) {
    const configuredKimiUrl = process.env.KIMI_BASE_URL?.trim();
    const res = await probeModels(
      'kimi',
      configuredKimiUrl
        ? [configuredKimiUrl]
        : ['https://api.moonshot.cn/v1', 'https://api.moonshot.ai/v1'],
      kimiKey
    );
    console.log('Kimi probe:', JSON.stringify(res));
  } else {
    console.log('Kimi probe: missing KIMI_API_KEY');
  }
}

async function runStructuredTests() {
  const { VercelAISDKProvider } = await import(
    '../src/adapters/llm/vercel-ai.ts'
  );
  const { researchOutputSchema } = await import('../src/core/schemas.ts');

  const provider = new VercelAISDKProvider({
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiBaseUrl: process.env.OPENAI_BASE_URL,
    openaiModel: process.env.OPENAI_MODEL,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    anthropicModel: process.env.ANTHROPIC_MODEL,
    deepseekApiKey: process.env.DEEPSEEK_API_KEY,
    deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL,
    deepseekModel: process.env.DEEPSEEK_MODEL,
    kimiApiKey: process.env.KIMI_API_KEY,
    kimiBaseUrl: process.env.KIMI_BASE_URL,
    kimiModel: process.env.KIMI_MODEL,
    defaultModel: process.env.DEFAULT_LLM_MODEL,
  });

  const models = provider.listModels();
  console.log('Registered real models:', models.map((m) => m.id));
  if (models.length === 0) {
    throw new Error('No real LLM models registered');
  }

  for (const m of models) {
    const started = Date.now();
    const out = await provider.generateObject({
      model: m.id,
      system:
        'You are Iris, a product researcher. Return concise Chinese structured JSON strictly matching the schema.',
      prompt:
        'Analyze this product idea: 做一个极简线上科技沙龙活动报名与签到站。Return keys: marketSummary, targetAudience, competitorPainPoints (array), differentiators (array), recommendedPositioning.',
      schema: researchOutputSchema,
    });
    const elapsed = Date.now() - started;
    console.log(
      `PASS [${m.id}] in ${elapsed}ms -> marketSummary="${out.marketSummary.slice(0, 60)}"`
    );
  }
}

async function main() {
  loadEnvLocal();
  const mode = process.argv.includes('--probe-only') ? 'probe' : 'all';
  await runModelDiscovery();
  if (mode === 'all') {
    await runStructuredTests();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
