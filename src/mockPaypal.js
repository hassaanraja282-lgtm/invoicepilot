// Demo-mode stand-in for PayPal, used automatically when PAYPAL_CLIENT_ID /
// PAYPAL_CLIENT_SECRET are not set. Same function signatures and return shapes
// as src/paypal.js, so the whole UI and agent work end to end without keys.
const { draftTotal, todayISO, fmt } = require('./money');

const invoices = new Map();
const orders = new Map();
let seq = 1001;

const rid = (p) => `${p}${Math.random().toString(36).slice(2, 6).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return todayISO(d); };

function makeInvoice(draft, status) {
  const id = rid('INV2-DEMO-');
  const inv = {
    id,
    number: `IP-${seq++}`,
    status,
    client_name: draft.client.business_name || draft.client.name,
    client_email: draft.client.email || '',
    currency: draft.currency,
    total: draftTotal(draft),
    invoice_date: draft.invoice_date || todayISO(),
    due_date: draft.due_date,
    note: draft.note || '',
    items: draft.items.map((i) => ({ name: i.name, quantity: String(i.quantity || 1), unit_amount: fmt(i.unit_amount, draft.currency) })),
    payer_view_url: `/demo-invoice/${id}`,
    invoicer_view_url: `/demo-invoice/${id}`,
    reminders: [],
  };
  invoices.set(id, inv);
  return inv;
}

// A few seeded invoices so the dashboard and the "who hasn't paid?" agent demo have data.
function seed() {
  makeInvoice({ client: { name: 'Northwind Studio', email: 'accounts@northwind.example' }, currency: 'USD', due_date: daysFromNow(-6), invoice_date: daysFromNow(-20), items: [{ name: 'Website landing page redesign', quantity: 1, unit_amount: 450 }] }, 'SENT');
  makeInvoice({ client: { name: 'Priya Mehta', email: 'priya@example.com' }, currency: 'USD', due_date: daysFromNow(5), invoice_date: daysFromNow(-2), items: [{ name: 'Instagram post design', quantity: 6, unit_amount: 25 }] }, 'SENT');
  makeInvoice({ client: { name: 'BlueOcean Media', email: 'finance@blueocean.example' }, currency: 'EUR', due_date: daysFromNow(-12), invoice_date: daysFromNow(-30), items: [{ name: 'Video editing (2 reels)', quantity: 2, unit_amount: 120 }] }, 'PAID');
}
seed();

async function createInvoice(draft, { send = true } = {}) {
  return { ...makeInvoice(draft, send ? 'SENT' : 'DRAFT') };
}
async function listInvoices() { return [...invoices.values()].reverse().map((i) => ({ ...i })); }
async function getInvoice(id) {
  const inv = invoices.get(id);
  if (!inv) { const e = new Error(`Invoice ${id} not found`); e.status = 404; throw e; }
  return { ...inv };
}
async function remindInvoice(id, { subject, note }) {
  const inv = invoices.get(id);
  if (!inv) throw new Error(`Invoice ${id} not found`);
  inv.reminders.push({ at: new Date().toISOString(), subject, note });
  return { ok: true };
}
async function cancelInvoice(id) {
  const inv = invoices.get(id);
  if (!inv) throw new Error(`Invoice ${id} not found`);
  inv.status = 'CANCELLED';
  return { ok: true };
}
function markInvoicePaid(id) {
  const inv = invoices.get(id);
  if (!inv) throw new Error(`Invoice ${id} not found`);
  inv.status = 'PAID';
  return { ...inv };
}

async function createOrder(draft) {
  const id = rid('DEMOORDER');
  const o = {
    id,
    status: 'CREATED',
    description: draft.items.map((i) => i.name).join(', '),
    client_name: draft.client.name,
    currency: draft.currency,
    total: draftTotal(draft),
    approve_url: `/pay/${id}`,
    capture_id: '',
    payer_email: '',
  };
  orders.set(id, o);
  return { ...o };
}
async function getOrder(id) {
  const o = orders.get(id);
  if (!o) { const e = new Error(`Order ${id} not found`); e.status = 404; throw e; }
  return { ...o };
}
async function captureOrder(id) {
  const o = orders.get(id);
  if (!o) throw new Error(`Order ${id} not found`);
  o.status = 'COMPLETED';
  o.capture_id = rid('DEMOCAP');
  o.payer_email = 'sandbox-buyer@example.com';
  return { ...o };
}

module.exports = {
  mode: 'demo',
  createInvoice, listInvoices, getInvoice, remindInvoice, cancelInvoice, markInvoicePaid,
  createOrder, getOrder, captureOrder,
};
