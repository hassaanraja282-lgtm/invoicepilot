// AI layer. Talks to any OpenAI-compatible Chat Completions endpoint
// (Google Gemini, OpenAI, Groq, OpenRouter, Ollama, ...). If no key is set, or a
// call fails, it falls back to the rule-based extractor so the app never breaks.
const cfg = require('./config');
const { extractHeuristic } = require('./heuristics');
const { todayISO, draftTotal } = require('./money');

async function chatCompletion({ messages, tools, json = false, temperature = 0.2 }) {
  if (!cfg.ai.enabled) throw new Error('AI is not configured (demo mode)');
  const body = { model: cfg.ai.model, messages, temperature };
  if (tools && tools.length) { body.tools = tools; body.tool_choice = 'auto'; }
  if (json) body.response_format = { type: 'json_object' };
  // Gemini 3 models think by default; keep it light so replies stay fast.
  if (cfg.ai.provider === 'gemini') body.reasoning_effort = process.env.AI_REASONING_EFFORT || 'low';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const res = await fetch(`${cfg.ai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.ai.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = {}; }
    if (!res.ok) {
      const msg = (Array.isArray(data) ? data[0]?.error?.message : data.error?.message) || text.slice(0, 300);
      throw new Error(`AI provider error (${res.status}): ${msg}`);
    }
    return data.choices?.[0]?.message || { content: '' };
  } finally { clearTimeout(timer); }
}

function parseJsonLoose(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch {}
  const m = String(s).match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

const EXTRACT_SYSTEM = (today, cur) => `You are InvoicePilot, an assistant that turns a freelancer's messy client chat, email, or plain-language note (English, Hindi, or Hinglish) into a structured invoice.
Today's date is ${today} (${new Date(today + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' })}). Default currency if none is stated: ${cur}.
Return ONLY a JSON object with exactly these keys:
{
  "client": { "name": string (person or company being billed), "business_name": string or "", "email": string or "" },
  "items": [ { "name": short line-item title, "description": string or "", "quantity": number, "unit_amount": number (price per unit, no currency symbol) } ],
  "currency": ISO 4217 code like "USD", "EUR", "GBP", "INR",
  "due_date": "YYYY-MM-DD" (resolve relative dates like "Friday", "next week", "15 tarikh", "in 10 days" against today; if none is given use today + 14 days),
  "note": a short warm thank-you note to the client (1 sentence, match the tone of the conversation),
  "terms": payment terms if mentioned (e.g. "50% advance received", "Net 15"), else "",
  "missing": array of field names you could not find (e.g. "client_email"),
  "assumptions": array of short plain-English notes about anything you guessed
}
Rules: Never invent an email address. If an advance/deposit was already paid, bill only the remaining balance and say so in "terms". Split clearly separate deliverables into separate items. "k" means thousand. Ignore amounts that are clearly not charges (e.g. follower counts).`;

function sanitizeDraft(d, fallbackCurrency) {
  const out = {
    client: {
      name: String(d?.client?.name || d?.client_name || 'Client').trim().slice(0, 140),
      business_name: String(d?.client?.business_name || '').trim().slice(0, 140),
      email: String(d?.client?.email || d?.client_email || '').trim(),
    },
    items: (Array.isArray(d?.items) ? d.items : []).map((i) => ({
      name: String(i.name || 'Professional services').slice(0, 120),
      description: String(i.description || '').slice(0, 500),
      quantity: Math.max(1, Math.round(Number(i.quantity) || 1)),
      unit_amount: Math.max(0, Number(String(i.unit_amount ?? 0).replace(/[^\d.]/g, '')) || 0),
    })).filter((i) => i.name),
    currency: /^[A-Z]{3}$/.test(String(d?.currency || '').toUpperCase()) ? String(d.currency).toUpperCase() : fallbackCurrency,
    due_date: /^\d{4}-\d{2}-\d{2}$/.test(d?.due_date || '') ? d.due_date : todayISO(new Date(Date.now() + 14 * 864e5)),
    note: String(d?.note || 'Thank you for your business!').slice(0, 500),
    terms: String(d?.terms || '').slice(0, 500),
    missing: Array.isArray(d?.missing) ? d.missing.map(String) : [],
    assumptions: Array.isArray(d?.assumptions) ? d.assumptions.map(String) : [],
  };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.client.email)) {
    out.client.email = '';
    if (!out.missing.includes('client_email')) out.missing.push('client_email');
  }
  if (!out.items.length) out.items = [{ name: 'Professional services', description: '', quantity: 1, unit_amount: 0 }];
  if (out.due_date < todayISO()) { out.assumptions.push(`Due date was in the past, moved to today.`); out.due_date = todayISO(); }
  out.total = draftTotal(out);
  return out;
}

async function extractInvoice(text) {
  const today = todayISO();
  if (cfg.ai.enabled) {
    try {
      const msg = await chatCompletion({
        json: true,
        messages: [
          { role: 'system', content: EXTRACT_SYSTEM(today, cfg.defaultCurrency) },
          { role: 'user', content: String(text).slice(0, 8000) },
        ],
      });
      const parsed = parseJsonLoose(msg.content);
      if (!parsed) throw new Error('AI returned something that was not JSON');
      return { draft: sanitizeDraft(parsed, cfg.defaultCurrency), source: 'ai', warnings: [] };
    } catch (e) {
      return { draft: sanitizeDraft(extractHeuristic(text, { defaultCurrency: cfg.defaultCurrency }), cfg.defaultCurrency), source: 'heuristic', warnings: [`AI unavailable, used the built-in parser instead: ${e.message}`] };
    }
  }
  return { draft: sanitizeDraft(extractHeuristic(text, { defaultCurrency: cfg.defaultCurrency }), cfg.defaultCurrency), source: 'heuristic', warnings: [] };
}

function daysOverdue(inv) {
  if (!inv.due_date) return 0;
  return Math.floor((new Date(todayISO()) - new Date(inv.due_date)) / 864e5);
}

function templateReminder(inv, tone) {
  const od = daysOverdue(inv);
  const amt = `${inv.currency} ${inv.total}`;
  const first = (inv.client_name || 'there').split(' ')[0];
  if (tone === 'firm' && od > 0) {
    return { subject: `Overdue: invoice ${inv.number || ''} (${amt})`.replace('  ', ' '), note: `Hi ${first}, invoice ${inv.number || ''} for ${amt} is now ${od} day${od === 1 ? '' : 's'} overdue. Please arrange payment through the PayPal link at your earliest convenience, or let me know if anything is holding it up. Thank you.` };
  }
  return {
    subject: od > 0 ? `Friendly reminder: invoice ${inv.number || ''} (${amt})` : `Reminder: invoice ${inv.number || ''} due ${inv.due_date}`,
    note: od > 0
      ? `Hi ${first}, hope you're doing well! Just a gentle reminder that invoice ${inv.number || ''} for ${amt} was due on ${inv.due_date}. You can pay securely with PayPal using the link in this email. Thanks so much!`
      : `Hi ${first}, a quick heads-up that invoice ${inv.number || ''} for ${amt} is due on ${inv.due_date}. You can pay securely with PayPal using the link in this email. Thank you!`,
  };
}

async function draftReminder(inv, tone = 'friendly') {
  if (!cfg.ai.enabled) return { ...templateReminder(inv, tone), source: 'template' };
  try {
    const msg = await chatCompletion({
      json: true,
      temperature: 0.5,
      messages: [
        { role: 'system', content: `You write short, polite payment reminder emails for a freelancer. Tone: ${tone}. Never be rude or threatening; keep the client relationship warm. Max 80 words for the note. The PayPal pay link is attached automatically, so just mention they can pay via the PayPal link. Return JSON {"subject": string, "note": string}.` },
        { role: 'user', content: JSON.stringify({ today: todayISO(), days_overdue: daysOverdue(inv), invoice: { number: inv.number, client: inv.client_name, amount: `${inv.currency} ${inv.total}`, due_date: inv.due_date, items: inv.items?.map((i) => i.name) } }) },
      ],
    });
    const p = parseJsonLoose(msg.content);
    if (!p?.subject || !p?.note) throw new Error('bad AI response');
    return { subject: String(p.subject).slice(0, 200), note: String(p.note).slice(0, 1000), source: 'ai' };
  } catch (e) {
    return { ...templateReminder(inv, tone), source: 'template', warning: e.message };
  }
}

module.exports = { chatCompletion, extractInvoice, draftReminder, sanitizeDraft, daysOverdue, parseJsonLoose };
