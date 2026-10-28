// The InvoicePilot agent: an LLM with tool calling over PayPal.
// Human-in-the-loop by design: tools that would send money requests or emails
// to a client (send invoice, create payment link, send reminder) return an
// "action card" that the freelancer confirms with one click in the UI.
const cfg = require('./config');
const ai = require('./ai');
const { todayISO } = require('./money');

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'prepare_invoice',
      description: 'Turn a plain-language billing request into an invoice draft (client, line items, amounts, currency, due date). The user then reviews it and clicks to send it as a PayPal invoice or a PayPal checkout link. Use whenever the user wants to bill, invoice, charge, or request payment from someone.',
      parameters: { type: 'object', properties: { request: { type: 'string', description: 'The full billing request in the user\'s words, including any client name, email, amounts, items, currency and due date mentioned in the conversation.' } }, required: ['request'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_invoices',
      description: 'List the freelancer\'s PayPal invoices with live status from the PayPal Invoicing API.',
      parameters: { type: 'object', properties: { filter: { type: 'string', enum: ['all', 'unpaid', 'overdue', 'paid'], description: 'Which invoices to show.' } }, required: ['filter'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_invoice',
      description: 'Find invoices for a client name, email, or invoice number and return their live PayPal status.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'draft_reminder',
      description: 'Write a polite payment reminder for one unpaid invoice. Returns a draft the user confirms before PayPal emails it to the client.',
      parameters: { type: 'object', properties: { invoice_id: { type: 'string', description: 'PayPal invoice id (e.g. INV2-...).' }, tone: { type: 'string', enum: ['friendly', 'firm'] } }, required: ['invoice_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'payment_summary',
      description: 'Totals of paid, outstanding and overdue money per currency across all PayPal invoices.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

const UNPAID = new Set(['SENT', 'UNPAID', 'PARTIALLY_PAID', 'SCHEDULED', 'PAYMENT_PENDING']);
const isOverdue = (i) => UNPAID.has(i.status) && i.due_date && i.due_date < todayISO();
const compact = (i) => ({ id: i.id, number: i.number, client: i.client_name, email: i.client_email, amount: `${i.currency} ${i.total}`, status: i.status, due_date: i.due_date, overdue: isOverdue(i) });

function summarize(list) {
  const by = {};
  for (const i of list) {
    const c = (by[i.currency] = by[i.currency] || { paid: 0, outstanding: 0, overdue: 0 });
    const v = Number(i.total) || 0;
    if (i.status === 'PAID' || i.status === 'MARKED_AS_PAID') c.paid += v;
    else if (UNPAID.has(i.status)) { c.outstanding += v; if (isOverdue(i)) c.overdue += v; }
  }
  for (const k of Object.keys(by)) for (const f of ['paid', 'outstanding', 'overdue']) by[k][f] = Number(by[k][f].toFixed(2));
  return by;
}

function makeToolRunner(pp) {
  const cards = [];
  async function run(name, args) {
    switch (name) {
      case 'prepare_invoice': {
        const { draft, source, warnings } = await ai.extractInvoice(args.request || '');
        cards.push({ type: 'invoice_draft', draft, source, warnings });
        return { draft_ready: true, client: draft.client, total: `${draft.currency} ${draft.total}`, due_date: draft.due_date, missing: draft.missing, note: 'Draft shown to the user with Send buttons. Do not claim it was sent.' };
      }
      case 'list_invoices': {
        const all = await pp.listInvoices();
        const f = args.filter || 'all';
        const list = all.filter((i) => f === 'all' || (f === 'paid' && /PAID/.test(i.status) && !/PARTIALLY/.test(i.status)) || (f === 'unpaid' && UNPAID.has(i.status)) || (f === 'overdue' && isOverdue(i)));
        cards.push({ type: 'invoice_list', title: `${f[0].toUpperCase() + f.slice(1)} invoices`, invoices: list });
        return { count: list.length, invoices: list.slice(0, 20).map(compact) };
      }
      case 'find_invoice': {
        const q = String(args.query || '').toLowerCase();
        const list = (await pp.listInvoices()).filter((i) => [i.client_name, i.client_email, i.number, i.id].some((v) => String(v || '').toLowerCase().includes(q)));
        if (list.length) cards.push({ type: 'invoice_list', title: `Invoices matching "${args.query}"`, invoices: list });
        return { count: list.length, invoices: list.map(compact) };
      }
      case 'draft_reminder': {
        const inv = await pp.getInvoice(args.invoice_id);
        const r = await ai.draftReminder(inv, args.tone || 'friendly');
        cards.push({ type: 'reminder', invoice: inv, subject: r.subject, note: r.note });
        return { drafted: true, invoice: compact(inv), subject: r.subject, note: 'Reminder shown to the user for approval; not sent yet.' };
      }
      case 'payment_summary': {
        const s = summarize(await pp.listInvoices());
        cards.push({ type: 'summary', summary: s });
        return s;
      }
      default:
        return { error: `Unknown tool ${name}` };
    }
  }
  return { run, cards };
}

const SYSTEM = () => `You are InvoicePilot, a friendly AI billing agent for a solo freelancer. You are connected to their PayPal business account (Invoicing v2 + Orders v2 APIs) through tools.
Today is ${todayISO()}. The user may write in English, Hindi or Hinglish; reply in the same style, briefly (1-3 sentences).
- To bill someone, call prepare_invoice. The user confirms the draft with a button; never say an invoice was sent unless they confirmed.
- For "who hasn't paid", "status", "pending" questions, call list_invoices or find_invoice and answer from the live data.
- To chase a payment, find the invoice then call draft_reminder (use "firm" only if the user asks or it is more than 14 days overdue).
- If several invoices match, ask which one. Never invent invoice ids, amounts or emails.`;

async function runAgent(history, pp) {
  const { run, cards } = makeToolRunner(pp);
  const userText = [...history].reverse().find((m) => m.role === 'user')?.content || '';

  if (!cfg.ai.enabled) return runDemoAgent(userText, run, cards);

  const messages = [{ role: 'system', content: SYSTEM() }, ...history.slice(-12).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 4000) }))];
  try {
    for (let step = 0; step < 5; step++) {
      const msg = await ai.chatCompletion({ messages, tools: TOOLS });
      const calls = msg.tool_calls || [];
      if (!calls.length) return { reply: msg.content || 'Done.', cards, mode: 'ai' };
      // Push the assistant turn back unchanged: Gemini 3 needs its thought signatures returned.
      messages.push({ ...msg, role: 'assistant', content: msg.content || '' });
      for (const c of calls) {
        let result;
        try { result = await run(c.function.name, ai.parseJsonLoose(c.function.arguments) || {}); } catch (e) { result = { error: e.message }; }
        messages.push({ role: 'tool', tool_call_id: c.id || c.function.name, name: c.function.name, content: JSON.stringify(result).slice(0, 6000) });
      }
    }
    return { reply: 'Here is what I found.', cards, mode: 'ai' };
  } catch (e) {
    const out = await runDemoAgent(userText, run, cards);
    out.warning = `AI unavailable, used the built-in rules instead: ${e.message}`;
    return out;
  }
}

// Rule-based agent used in demo mode (no AI key) so the chat still works on camera.
async function runDemoAgent(text, run, cards) {
  const t = text.toLowerCase();
  if (/remind|reminder|chase|follow ?up|yaad|nudge/.test(t)) {
    const res = await run('list_invoices', { filter: 'unpaid' });
    cards.pop();
    const target = res.invoices.find((i) => t.includes(String(i.client).toLowerCase().split(' ')[0])) || res.invoices.find((i) => i.overdue) || res.invoices[0];
    if (!target) return { reply: 'Nothing to chase - every invoice is paid.', cards, mode: 'demo' };
    await run('draft_reminder', { invoice_id: target.id, tone: /firm|strict|serious/.test(t) ? 'firm' : 'friendly' });
    return { reply: `I drafted a reminder for ${target.client} (${target.amount}, due ${target.due_date}). Review it and hit Send when it looks right.`, cards, mode: 'demo' };
  }
  if (/summary|total|kitna|how much|earned|kamaya/.test(t)) {
    const s = await run('payment_summary', {});
    const line = Object.entries(s).map(([c, v]) => `${c}: ${v.paid} paid, ${v.outstanding} outstanding (${v.overdue} overdue)`).join(' | ');
    return { reply: `Here's your money picture. ${line}`, cards, mode: 'demo' };
  }
  if (/overdue|late|hasn.?t paid|not paid|unpaid|pending|baaki|status|who owes|list|show/.test(t)) {
    const filter = /overdue|late/.test(t) ? 'overdue' : /paid/.test(t) && !/unpaid|not paid|hasn/.test(t) ? 'paid' : /list|show|all/.test(t) && !/unpaid|pending/.test(t) ? 'all' : 'unpaid';
    const r = await run('list_invoices', { filter });
    return { reply: r.count ? `You have ${r.count} ${filter} invoice${r.count === 1 ? '' : 's'}. ${r.invoices.filter((i) => i.overdue).map((i) => `${i.client} is overdue (${i.amount}).`).join(' ')}`.trim() : `No ${filter} invoices right now.`, cards, mode: 'demo' };
  }
  if (/\d/.test(t) && /(invoice|bill|charge|pay|request|\$|₹|usd|inr|eur|bhejo|rs)/.test(t)) {
    const r = await run('prepare_invoice', { request: text });
    return { reply: `Draft ready for ${r.client.name}: ${r.total}, due ${r.due_date}.${r.missing.includes('client_email') ? ' I could not find their email, so add it or send as a payment link.' : ''} Check it and choose how to send.`, cards, mode: 'demo' };
  }
  return { reply: 'Try: "Invoice Acme $300 for logo design due Friday, billing@acme.com", "Who hasn\'t paid?", or "Remind Northwind".', cards, mode: 'demo' };
}

module.exports = { runAgent, summarize, isOverdue };
