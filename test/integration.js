// Integration test against FAKE PayPal + FAKE OpenAI-compatible servers.
// Proves the real (non-demo) code paths build valid requests: OAuth, Invoicing v2,
// Orders v2 breakdown math, and the AI tool-calling loop. No real keys needed.
//   node test/integration.js
const http = require('http');
const assert = require('assert');

const seen = [];
function fakeServer(handler) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
        const body = b && req.headers['content-type']?.includes('json') ? JSON.parse(b) : b;
        seen.push({ method: req.method, url: req.url, body, headers: req.headers });
        const [status, data] = handler(req, body);
        res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(data === undefined ? '' : JSON.stringify(data));
      });
    }).listen(0, () => resolve(s));
  });
}

(async () => {
  const invoices = {};
  const paypal = await fakeServer((req, body) => {
    if (req.url === '/v1/oauth2/token') { assert.match(req.headers.authorization, /^Basic /); return [200, { access_token: 'tok', expires_in: 3600 }]; }
    assert.equal(req.headers.authorization, 'Bearer tok');
    if (req.method === 'POST' && req.url === '/v2/invoicing/invoices') {
      assert.equal(body.detail.payment_term.term_type, 'DUE_ON_DATE_SPECIFIED');
      assert(body.items.every((i) => typeof i.unit_amount.value === 'string' && typeof i.quantity === 'string'));
      const id = 'INV2-TEST-' + Object.keys(invoices).length;
      invoices[id] = { id, status: 'DRAFT', detail: { ...body.detail, invoice_number: '0001', metadata: { recipient_view_url: 'https://sandbox.example/inv/' + id } }, primary_recipients: body.primary_recipients, items: body.items, amount: { currency_code: body.detail.currency_code, value: '300.00' } };
      return [201, invoices[id]];
    }
    let m;
    if ((m = req.url.match(/^\/v2\/invoicing\/invoices\/([^/]+)\/send$/))) { invoices[m[1]].status = 'SENT'; return [200, { links: [{ rel: 'payer-view', href: 'https://sandbox.example/pay/' + m[1] }] }]; }
    if ((m = req.url.match(/^\/v2\/invoicing\/invoices\/([^/]+)\/remind$/))) { assert(body.subject && body.note); return [204]; }
    if ((m = req.url.match(/^\/v2\/invoicing\/invoices\/([^/?]+)$/))) return [200, invoices[m[1]]];
    if (req.url.startsWith('/v2/invoicing/invoices?')) return [200, { items: Object.values(invoices), total_items: 1 }];
    if (req.method === 'POST' && req.url === '/v2/checkout/orders') {
      const pu = body.purchase_units[0];
      const sum = pu.items.reduce((s, i) => s + Number(i.unit_amount.value) * Number(i.quantity), 0);
      assert.equal(Number(pu.amount.value), sum); assert.equal(pu.amount.breakdown.item_total.value, pu.amount.value);
      assert(body.payment_source.paypal.experience_context.return_url.endsWith('/paypal/return'));
      return [200, { id: 'ORDER1', status: 'PAYER_ACTION_REQUIRED', purchase_units: [{ ...pu }], links: [{ rel: 'payer-action', href: 'https://sandbox.example/checkoutnow?token=ORDER1' }] }];
    }
    if (req.url === '/v2/checkout/orders/ORDER1') return [200, { id: 'ORDER1', status: 'APPROVED', purchase_units: [{ amount: { currency_code: 'USD', value: '150.00' } }] }];
    if (req.url === '/v2/checkout/orders/ORDER1/capture') return [201, { id: 'ORDER1', status: 'COMPLETED', purchase_units: [{ amount: { currency_code: 'USD', value: '150.00' }, payments: { captures: [{ id: 'CAP1' }] } }] }];
    return [404, { name: 'NOT_FOUND', message: req.url }];
  });

  const llm = await fakeServer((req, body) => {
    assert.equal(req.url, '/chat/completions'); assert.equal(req.headers.authorization, 'Bearer test-key');
    const last = body.messages[body.messages.length - 1];
    if (body.response_format) {
      if (/reminder/i.test(body.messages[0].content)) return [200, { choices: [{ message: { content: JSON.stringify({ subject: 'Quick nudge on your invoice', note: 'Hi! Gentle reminder...' }) } }] }];
      return [200, { choices: [{ message: { content: '```json\n' + JSON.stringify({ client: { name: 'Acme Corp', email: 'billing@acme.example' }, items: [{ name: 'Logo design', quantity: 1, unit_amount: 300 }], currency: 'USD', due_date: '2099-01-01', note: 'Thanks!', terms: '', missing: [], assumptions: [] }) + '\n```' } }] }];
    }
    if (last.role === 'user') return [200, { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: /paid/.test(last.content) ? 'list_invoices' : 'prepare_invoice', arguments: /paid/.test(last.content) ? '{"filter":"unpaid"}' : JSON.stringify({ request: last.content }) } }] } }] }];
    if (last.role === 'tool') return [200, { choices: [{ message: { role: 'assistant', content: 'Done - draft ready.' } }] }];
    return [400, { error: { message: 'unexpected' } }];
  });

  Object.assign(process.env, {
    PAYPAL_CLIENT_ID: 'cid', PAYPAL_CLIENT_SECRET: 'sec', PAYPAL_API_BASE: `http://127.0.0.1:${paypal.address().port}`,
    AI_PROVIDER: 'custom', AI_API_KEY: 'test-key', AI_BASE_URL: `http://127.0.0.1:${llm.address().port}`, AI_MODEL: 'fake-model',
  });
  const app = require('../server');
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const j = async (p, body) => { const r = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }); return { status: r.status, d: r.headers.get('content-type').includes('json') ? await r.json() : await r.text() }; };
  const ok = (s) => console.log('  ✓', s);
  try {
    let r = await j('/api/status'); assert.equal(r.d.paypal.mode, 'sandbox'); assert.equal(r.d.ai.mode, 'live'); ok('status sandbox + live AI');
    r = await j('/api/extract', { text: 'invoice acme 300 logo' }); assert.equal(r.d.source, 'ai'); assert.equal(r.d.draft.client.email, 'billing@acme.example'); ok('AI extraction parsed (code-fenced JSON)');
    const draft = r.d.draft;
    r = await j('/api/invoices', { draft }); assert.equal(r.status, 200, JSON.stringify(r.d)); assert.equal(r.d.invoice.status, 'SENT'); assert.match(r.d.invoice.payer_view_url, /sandbox.example\/pay/); ok('Invoicing v2 create + send -> payer link');
    const id = r.d.invoice.id;
    r = await j('/api/invoices'); assert.equal(r.d.invoices.length, 1); ok('Invoicing v2 list');
    r = await j(`/api/invoices/${id}/reminder-draft`, {}); assert.equal(r.d.source, 'ai'); ok('AI reminder draft');
    r = await j(`/api/invoices/${id}/remind`, { subject: r.d.subject, note: r.d.note }); assert.equal(r.status, 200, JSON.stringify(r.d)); ok('Invoicing v2 remind (204 handled)');
    r = await j('/api/payment-links', { draft: { ...draft, items: [{ name: 'Page', quantity: 3, unit_amount: 33.33 }, { name: 'Setup', quantity: 1, unit_amount: 0.01 }] } }); assert.equal(r.status, 200, JSON.stringify(r.d)); ok('Orders v2 create (breakdown sums exactly)');
    r = await j('/paypal/return?token=ORDER1'); assert.match(r.d, /Payment complete/); ok('return URL captures order');
    r = await j('/api/chat', { messages: [{ role: 'user', content: 'Invoice Acme $300 for logo' }] }); assert.equal(r.d.mode, 'ai'); assert.equal(r.d.cards[0].type, 'invoice_draft'); ok('agent tool-call loop -> prepare_invoice card');
    r = await j('/api/chat', { messages: [{ role: 'user', content: "who hasn't paid" }] }); assert.equal(r.d.cards[0].type, 'invoice_list'); ok('agent tool-call loop -> list_invoices card');
    const toolMsg = seen.filter((s) => s.url === '/chat/completions' && s.body.messages?.some((m) => m.role === 'tool'));
    assert(toolMsg.length && toolMsg[0].body.messages.find((m) => m.role === 'tool').tool_call_id === 'call_1'); ok('tool results returned with tool_call_id');
    console.log('\nIntegration tests passed.');
  } catch (e) { console.error('FAILED:', e); process.exitCode = 1; } finally { srv.close(); paypal.close(); llm.close(); }
})();
