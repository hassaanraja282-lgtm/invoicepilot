// InvoicePilot server: Express API + static UI + hosted PayPal checkout page.
const path = require('path');
const express = require('express');
const cfg = require('./src/config');
const ai = require('./src/ai');
const { runAgent, summarize } = require('./src/agent');
const { sanitizeDraft } = require('./src/ai');

const pp = cfg.paypal.enabled ? require('./src/paypal') : require('./src/mockPaypal');
const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '200kb' }));

// Optional password so a public deployment can't be used by strangers.
if (cfg.appPassword) {
  app.use((req, res, next) => {
    if (req.path.startsWith('/pay/') || req.path.startsWith('/paypal/') || req.path.startsWith('/api/orders/') || req.path === '/healthz' || req.path.startsWith('/demo-')) return next();
    const [, b64] = (req.headers.authorization || '').split(' ');
    const [, pass] = Buffer.from(b64 || '', 'base64').toString().split(':');
    if (pass === cfg.appPassword) return next();
    res.set('WWW-Authenticate', 'Basic realm="InvoicePilot"').status(401).send('Password required');
  });
}

app.use(express.static(path.join(__dirname, 'public')));

const baseUrl = (req) => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(e.message);
  res.status(e.status && e.status < 500 ? e.status : 500).json({ error: e.message });
});
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Payment links created in this session (PayPal has no "list orders" API, so we keep ids).
const paymentLinks = new Map();

function validateDraft(raw) {
  const d = sanitizeDraft(raw, cfg.defaultCurrency);
  if (!d.items.some((i) => i.unit_amount > 0)) { const e = new Error('Add at least one line item with an amount above 0.'); e.status = 400; throw e; }
  d.items = d.items.filter((i) => i.unit_amount > 0);
  return d;
}

// ---------- API ----------
app.get('/healthz', (req, res) => res.json({ ok: true }));

app.get('/api/status', (req, res) => res.json({
  paypal: { mode: cfg.paypal.enabled ? cfg.paypal.env : 'demo', clientId: cfg.paypal.enabled ? cfg.paypal.clientId : null },
  ai: { mode: cfg.ai.enabled ? 'live' : 'demo', provider: cfg.ai.provider, model: cfg.ai.model || null },
  businessName: cfg.businessName,
  defaultCurrency: cfg.defaultCurrency,
}));


// Quick AI connectivity check (no secrets returned).
app.get('/api/ai-ping', wrap(async (req, res) => {
  const cfgAi = require('./src/config').ai;
  if (!cfgAi.enabled) return res.json({ enabled: false });
  const out = { provider: cfgAi.provider, model: cfgAi.model };
  const t0 = Date.now();
  try {
    const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 20000);
    const r = await fetch(`${cfgAi.baseUrl}/chat/completions`, { method: 'POST', signal: ctrl.signal,
      headers: { Authorization: `Bearer ${cfgAi.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cfgAi.model, messages: [{ role: 'user', content: 'Reply with OK' }] }) });
    clearTimeout(tm);
    out.status = r.status; out.body = (await r.text()).slice(0, 300);
  } catch (e) { out.error = String(e.message || e); }
  out.ms = Date.now() - t0;
  res.json(out);
}));

app.post('/api/extract', wrap(async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Paste a client message or describe the job first.' });
  res.json(await ai.extractInvoice(text));
}));

app.post('/api/invoices', wrap(async (req, res) => {
  const draft = validateDraft(req.body?.draft);
  const invoice = await pp.createInvoice(draft, { send: req.body?.send !== false });
  res.json({ invoice });
}));

app.get('/api/invoices', wrap(async (req, res) => {
  const invoices = await pp.listInvoices();
  res.json({ invoices, summary: summarize(invoices) });
}));

app.get('/api/invoices/:id', wrap(async (req, res) => res.json({ invoice: await pp.getInvoice(req.params.id) })));

app.post('/api/invoices/:id/reminder-draft', wrap(async (req, res) => {
  const inv = await pp.getInvoice(req.params.id);
  res.json({ invoice: inv, ...(await ai.draftReminder(inv, req.body?.tone || 'friendly')) });
}));

app.post('/api/invoices/:id/remind', wrap(async (req, res) => {
  const subject = String(req.body?.subject || 'Payment reminder').slice(0, 200);
  const note = String(req.body?.note || '').slice(0, 1000);
  res.json(await pp.remindInvoice(req.params.id, { subject, note }));
}));

app.post('/api/invoices/:id/cancel', wrap(async (req, res) => res.json(await pp.cancelInvoice(req.params.id, req.body || {}))));

app.post('/api/payment-links', wrap(async (req, res) => {
  const draft = validateDraft(req.body?.draft);
  const order = await pp.createOrder(draft, { returnUrl: `${baseUrl(req)}/paypal/return`, cancelUrl: `${baseUrl(req)}/paypal/cancel` });
  const link = { ...order, client_name: draft.client.name, client_email: draft.client.email, created: new Date().toISOString(), pay_url: `${baseUrl(req)}/pay/${order.id}` };
  paymentLinks.set(order.id, link);
  res.json({ link });
}));

app.get('/api/payment-links', wrap(async (req, res) => {
  const links = await Promise.all([...paymentLinks.values()].reverse().map(async (l) => {
    try { const o = await pp.getOrder(l.id); Object.assign(l, { status: o.status, capture_id: o.capture_id || l.capture_id }); } catch {}
    return l;
  }));
  res.json({ links });
}));

app.get('/api/orders/:id', wrap(async (req, res) => res.json({ order: await pp.getOrder(req.params.id) })));

app.post('/api/orders/:id/capture', wrap(async (req, res) => {
  const order = await pp.captureOrder(req.params.id);
  if (paymentLinks.has(order.id)) Object.assign(paymentLinks.get(order.id), { status: order.status, capture_id: order.capture_id });
  res.json({ order });
}));

app.post('/api/chat', wrap(async (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages.filter((m) => m && m.content) : [];
  if (!messages.length) return res.status(400).json({ error: 'Say something first.' });
  res.json(await runAgent(messages, pp));
}));

// Demo-mode only: simulate the client paying an invoice.
app.post('/api/demo/invoices/:id/pay', wrap(async (req, res) => {
  if (!pp.markInvoicePaid) return res.status(400).json({ error: 'Only available in demo mode.' });
  res.json({ invoice: pp.markInvoicePaid(req.params.id) });
}));

// ---------- Hosted pages ----------
const page = (title, body, head = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">${head}</head><body class="pay-body"><main class="pay-card">${body}</main></body></html>`;

// Branded checkout page the freelancer shares with the client. Uses the PayPal JS SDK
// Smart Buttons on top of the Orders v2 order created by /api/payment-links.
app.get('/pay/:id', async (req, res) => {
  let o;
  try { o = await pp.getOrder(req.params.id); } catch (e) { return res.status(404).send(page('Not found', `<h1>Payment link not found</h1><p class="muted">${esc(e.message)}</p>`)); }
  const paid = o.status === 'COMPLETED';
  const sdk = cfg.paypal.enabled
    ? `<script src="https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(cfg.paypal.clientId)}&currency=${encodeURIComponent(o.currency)}&intent=capture&components=buttons"></script>`
    : '';
  const buttons = paid ? `<div class="paid-banner">✅ Paid - thank you!</div>` : cfg.paypal.enabled
    ? `<div id="paypal-buttons"></div><p class="muted small">Sandbox: pay with a PayPal <b>sandbox personal</b> account, not a real one.</p>`
    : `<button class="btn btn-paypal" id="demo-pay">Pay with PayPal (demo)</button><p class="muted small">Demo mode - no real PayPal call is made.</p>`;
  const script = paid ? '' : cfg.paypal.enabled ? `<script>
paypal.Buttons({
  createOrder: () => ${JSON.stringify(o.id)},
  onApprove: async () => { const r = await fetch('/api/orders/${esc(o.id)}/capture', {method:'POST'}); const d = await r.json(); if (d.order && d.order.status === 'COMPLETED') location.reload(); else alert(d.error || 'Capture failed'); },
  onError: (err) => alert('PayPal error: ' + err)
}).render('#paypal-buttons');</script>` : `<script>document.getElementById('demo-pay').onclick = async () => { await fetch('/api/orders/${esc(o.id)}/capture', {method:'POST'}); location.reload(); };</script>`;
  res.send(page(`Pay ${cfg.businessName}`, `
    <div class="brand"><span class="logo">✈︎</span> ${esc(cfg.businessName)}</div>
    <h1>${esc(o.currency)} ${esc(o.total)}</h1>
    <p class="muted">${esc(o.description)}</p>
    ${o.client_name ? `<p class="muted small">Billed to ${esc(o.client_name)}</p>` : ''}
    ${buttons}
    <p class="muted tiny">Secured by PayPal · Order ${esc(o.id)} · Status ${esc(o.status)}</p>${script}`, sdk));
});

// Return URL for the plain PayPal approval link (payer-action) flow.
app.get('/paypal/return', async (req, res) => {
  const id = req.query.token;
  try {
    const o = await pp.captureOrder(id);
    if (paymentLinks.has(o.id)) Object.assign(paymentLinks.get(o.id), { status: o.status, capture_id: o.capture_id });
    res.send(page('Payment complete', `<div class="paid-banner">✅ Payment complete</div><h1>${esc(o.currency)} ${esc(o.total)}</h1><p class="muted">Thank you! ${esc(cfg.businessName)} has been notified.</p><p class="muted tiny">Capture ${esc(o.capture_id)}</p>`));
  } catch (e) {
    res.status(400).send(page('Payment issue', `<h1>We couldn't complete the payment</h1><p class="muted">${esc(e.message)}</p>`));
  }
});
app.get('/paypal/cancel', (req, res) => res.send(page('Payment cancelled', '<h1>Payment cancelled</h1><p class="muted">No money was taken. You can use the link again any time.</p>')));

// Demo-mode stand-in for PayPal's hosted invoice page.
app.get('/demo-invoice/:id', async (req, res) => {
  let inv;
  try { inv = await pp.getInvoice(req.params.id); } catch { return res.status(404).send(page('Not found', '<h1>Invoice not found</h1>')); }
  const rows = inv.items.map((i) => `<tr><td>${esc(i.name)}</td><td>${esc(i.quantity)}</td><td>${esc(i.unit_amount)}</td></tr>`).join('');
  res.send(page(`Invoice ${inv.number}`, `
    <div class="brand"><span class="logo">✈︎</span> ${esc(cfg.businessName)}</div>
    <p class="muted small">Invoice ${esc(inv.number)} · Due ${esc(inv.due_date)} · <b>${esc(inv.status)}</b></p>
    <h1>${esc(inv.currency)} ${esc(inv.total)}</h1>
    <p class="muted">To ${esc(inv.client_name)} ${inv.client_email ? '&lt;' + esc(inv.client_email) + '&gt;' : ''}</p>
    <table class="mini"><tr><th>Item</th><th>Qty</th><th>Price</th></tr>${rows}</table>
    ${inv.status === 'PAID' ? '<div class="paid-banner">✅ Paid</div>' : `<button class="btn btn-paypal" id="p">Pay with PayPal (demo)</button>`}
    <p class="muted tiny">Demo mode: this page simulates PayPal's hosted invoice. With sandbox keys, clients get a real PayPal invoice.</p>
    <script>const b=document.getElementById('p'); if(b) b.onclick=async()=>{await fetch('/api/demo/invoices/${esc(inv.id)}/pay',{method:'POST'});location.reload();};</script>`));
});

if (require.main === module) {
  app.listen(cfg.port, () => {
    console.log(`InvoicePilot running on http://localhost:${cfg.port}`);
    console.log(`  PayPal: ${cfg.paypal.enabled ? cfg.paypal.env.toUpperCase() : 'DEMO (no PAYPAL_CLIENT_ID/SECRET set)'}`);
    console.log(`  AI:     ${cfg.ai.enabled ? `${cfg.ai.provider} / ${cfg.ai.model}` : 'DEMO (no AI key set - using built-in rules)'}`);
  });
}

module.exports = app;
