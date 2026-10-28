// End-to-end smoke test. Boots the app on a random port and exercises every API
// route. With no keys set it tests demo mode; with keys set it hits the real
// PayPal sandbox and AI provider.
//   npm test
const assert = require('assert');
const app = require('../server');

(async () => {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const j = async (path, body, method) => {
    const r = await fetch(base + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const d = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
    return { status: r.status, d };
  };
  const ok = (name) => console.log('  ✓', name);
  try {
    let r = await j('/api/status'); assert.equal(r.status, 200); ok(`status: paypal=${r.d.paypal.mode} ai=${r.d.ai.mode}`);
    r = await j('/'); assert.match(r.d, /InvoicePilot/); ok('UI served');

    const samples = {
      email: "Hi Raja,\nAs agreed it's $450 for the logo + brand guide, plus $120 for the 4 social media templates.\nPlease send it to accounts@bloomco.example by 15 dec.\n\nBest,\nSarah Lin",
      hinglish: 'Bhai Rohan Kapoor (rohan.k@example.com) ko invoice bhejo - website ke 3 pages ka $150 each, aur hosting setup ka $40. Friday tak due hai.',
      quick: 'invoice Acme Corp $300 for logo design due Friday, billing@acme.example',
    };
    let draft;
    for (const [k, text] of Object.entries(samples)) {
      r = await j('/api/extract', { text }); assert.equal(r.status, 200, JSON.stringify(r.d));
      const d = r.d.draft;
      assert(d.items.length && Number(d.total) > 0, 'has amount');
      console.log(`  ✓ extract[${k}] (${r.d.source}) -> ${d.client.name} <${d.client.email}> ${d.currency} ${d.total} due ${d.due_date} items=${JSON.stringify(d.items.map((i) => `${i.quantity}x ${i.name} @${i.unit_amount}`))}`);
      if (k === 'quick') draft = d;
    }
    r = await j('/api/extract', { text: '' }); assert.equal(r.status, 400); ok('extract rejects empty');

    r = await j('/api/invoices', { draft, send: true }); assert.equal(r.status, 200, JSON.stringify(r.d));
    const inv = r.d.invoice; ok(`invoice created+sent ${inv.id} ${inv.status} payer=${inv.payer_view_url}`);
    r = await j('/api/invoices', { draft: { ...draft, items: [{ name: 'x', quantity: 1, unit_amount: 0 }] } }); assert.equal(r.status, 400); ok('zero-amount invoice rejected');

    r = await j('/api/invoices'); assert(r.d.invoices.some((i) => i.id === inv.id)); ok(`list invoices (${r.d.invoices.length}) summary=${JSON.stringify(r.d.summary)}`);
    r = await j(`/api/invoices/${inv.id}`); assert.equal(r.d.invoice.id, inv.id); ok('get invoice');
    r = await j(`/api/invoices/${inv.id}/reminder-draft`, { tone: 'friendly' }); assert(r.d.subject && r.d.note); ok(`reminder draft (${r.d.source}): "${r.d.subject}"`);
    r = await j(`/api/invoices/${inv.id}/remind`, { subject: r.d.subject, note: r.d.note }); assert.equal(r.status, 200, JSON.stringify(r.d)); ok('reminder sent');

    r = await j('/api/payment-links', { draft }); assert.equal(r.status, 200, JSON.stringify(r.d));
    const link = r.d.link; ok(`payment link ${link.id} ${link.status} ${link.pay_url}`);
    r = await j(`/pay/${link.id}`); assert.match(r.d, /PayPal/); ok('hosted pay page renders');
    r = await j('/api/payment-links'); assert(r.d.links.length); ok('list payment links');
    if (link.id.startsWith('DEMO')) {
      r = await j(`/api/orders/${link.id}/capture`, {}); assert.equal(r.d.order.status, 'COMPLETED'); ok('demo capture -> COMPLETED');
      r = await j(`/api/demo/invoices/${inv.id}/pay`, {}); assert.equal(r.d.invoice.status, 'PAID'); ok('demo invoice paid');
      r = await j(`/demo-invoice/${inv.id}`); assert.match(r.d, /Paid/); ok('demo invoice page');
    }

    for (const msg of ["Who hasn't paid me yet?", 'Remind Northwind about the overdue invoice', 'Invoice Acme Corp $300 for logo design due Friday, billing@acme.example', 'kitna pending hai total?']) {
      r = await j('/api/chat', { messages: [{ role: 'user', content: msg }] }); assert.equal(r.status, 200, JSON.stringify(r.d));
      console.log(`  ✓ agent "${msg}" -> ${r.d.reply.slice(0, 110)} | cards=${(r.d.cards || []).map((c) => c.type).join(',')}`);
    }
    r = await j(`/api/invoices/${inv.id}/cancel`, {}); ok(`cancel -> ${r.status}`);
    console.log('\nAll smoke tests passed.');
  } catch (e) {
    console.error('\nFAILED:', e.message); process.exitCode = 1;
  } finally { server.close(); }
})();
