// Central configuration. Everything is read from environment variables so the
// app can run with zero keys (demo mode) or with real PayPal sandbox + AI keys.
require('dotenv').config();

const env = (k, d = '') => (process.env[k] || d).trim();

// ---------- PayPal ----------
const paypalClientId = env('PAYPAL_CLIENT_ID');
const paypalSecret = env('PAYPAL_CLIENT_SECRET');
const paypalEnv = env('PAYPAL_ENV', 'sandbox').toLowerCase() === 'live' ? 'live' : 'sandbox';

const paypal = {
  clientId: paypalClientId,
  secret: paypalSecret,
  env: paypalEnv,
  enabled: Boolean(paypalClientId && paypalSecret),
  apiBase: env('PAYPAL_API_BASE') || (paypalEnv === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'),
};

// ---------- AI (any OpenAI-compatible Chat Completions API) ----------
const PRESETS = {
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.8-flash', keyVar: 'GEMINI_API_KEY' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', keyVar: 'OPENAI_API_KEY' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', keyVar: 'GROQ_API_KEY' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4.1-mini', keyVar: 'OPENROUTER_API_KEY' },
  custom: { baseUrl: '', model: '', keyVar: 'AI_API_KEY' },
};

function resolveAi() {
  let provider = env('AI_PROVIDER', 'auto').toLowerCase();
  if (provider === 'demo' || provider === 'none') return { provider: 'demo', enabled: false };

  if (provider === 'auto') {
    // Pick the first provider that has a key set.
    provider = ['gemini', 'openai', 'groq', 'openrouter'].find((p) => env(PRESETS[p].keyVar)) || (env('AI_API_KEY') ? 'custom' : '');
    if (!provider) return { provider: 'demo', enabled: false };
  }
  const preset = PRESETS[provider] || PRESETS.custom;
  const apiKey = env('AI_API_KEY') || env(preset.keyVar);
  const baseUrl = (env('AI_BASE_URL') || preset.baseUrl).replace(/\/$/, '');
  const model = env('AI_MODEL') || preset.model;
  if (!apiKey || !baseUrl || !model) return { provider: 'demo', enabled: false };
  return { provider, apiKey, baseUrl, model, enabled: true };
}

module.exports = {
  port: Number(env('PORT', '3000')),
  defaultCurrency: env('DEFAULT_CURRENCY', 'USD').toUpperCase(),
  businessName: env('BUSINESS_NAME', 'My Freelance Studio'),
  appPassword: env('APP_PASSWORD'),
  paypal,
  ai: resolveAi(),
};
