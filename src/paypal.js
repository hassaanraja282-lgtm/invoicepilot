// Real PayPal REST client (sandbox by default).
// APIs used:
//   - OAuth 2.0 client credentials       POST /v1/oauth2/token
//   - Invoicing v2                       /v2/invoicing/invoices (create, send, list, get, remind, cancel)
//   - Orders v2 (checkout payment links) /v2/checkout/orders (create, get, capture)
const cfg = require('./config');
const { fmt, draftTotal, todayISO, splitName } = require('./money');

let tokenCache = { token: null, expiresAt: 0 };

async function getToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.token;
  const auth = Buffer.from(`${cfg.paypal.clientId}:${cfg.paypal.secret}`).toString('base64');
  const res = await fetch(`${cfg.paypal.apiBase}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`PayPal auth failed (${res.status}): ${data.error_description || data.error || 'check PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET'}`);
  tokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return tokenCache.token;
}

async function pp(method, path, body, extraHeaders = {}) {
  const token = await getToken();
  const res = await fetch(`${cfg.paypal.apiBase}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const detail = (data.details || []).map((d) => `${d.field || ''} ${d.issue || ''} ${d.description || ''}`.trim()).join('; ');
    const err = new Error(`PayPal ${method} ${path} failed (${res.status}): ${data.message || data.name || text}${detail ? ' - ' + detail : ''}${data.debug_id ? ` [debug_id ${data.debug_id}]` : ''}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- Invoices ----------
function normalizeInvoice(inv) {
  const r = inv.primary_recipients?.[0]?.billing_info || {};
  const name = r.business_name || [r.name?.given_name, r.name?.surname].filter(Boolean).join(' ') || r.email_address || '-';
  return {
    id: inv.id,
    number: inv.detail?.invoice_number,
    status: inv.status,
    client_name: name,
    client_email: r.email_address || '',
    currency: inv.amount?.currency_code || inv.detail?.currency_code,
    total: inv.amount?.value || '0',
    due_amount: inv.due_amount?.value,
    invoice_date: inv.detail?.invoice_date,
    due_date: inv.detail?.payment_term?.due_date || '',
    note: inv.detail?.note || '',
    items: (inv.items || []).map((i) => ({ name: i.name, quantity: i.quantity, unit_amount: i.unit_amount?.value })),
    payer_view_url: inv.detail?.metadata?.recipient_view_url || '',
    invoicer_view_url: inv.detail?.metadata?.invoicer_view_url || '',
  };
}

function invoiceBody(draft) {
  const cur = draft.currency;
  const recipient = { billing_info: { name: splitName(draft.client.name) } };
  if (draft.client.business_name) recipient.billing_info.business_name = draft.client.business_name;
  if (draft.client.email) recipient.billing_info.email_address = draft.client.email;
  const body = {
    detail: {
      currency_code: cur,
      invoice_date: todayISO(),
      note: draft.note || undefined,
      terms_and_conditions: draft.terms || undefined,
      payment_term: { term_type: 'DUE_ON_DATE_SPECIFIED', due_date: draft.due_date },
    },
    invoicer: cfg.businessName ? { business_name: cfg.businessName } : undefined,
    primary_recipients: [recipient],
    items: draft.items.map((it) => ({
      name: String(it.name).slice(0, 200),
      description: it.description ? String(it.description).slice(0, 1000) : undefined,
      quantity: String(it.quantity || 1),
      unit_amount: { currency_code: cur, value: fmt(it.unit_amount, cur) },
      unit_of_measure: 'QUANTITY',
    })),
    configuration: { allow_tip: false, tax_calculated_after_discount: true, tax_inclusive: false },
  };
  return JSON.parse(JSON.stringify(body)); // strip undefined
}

async function createInvoice(draft, { send = true } = {}) {
  const created = await pp('POST', '/v2/invoicing/invoices', invoiceBody(draft));
  // With Prefer: return=representation PayPal returns the invoice; otherwise a link to it.
  let id = created.id;
  if (!id && created.href) id = created.href.split('/').pop();
  let payerLink = '';
  if (send) {
    const sent = await pp('POST', `/v2/invoicing/invoices/${id}/send`, {
      send_to_invoicer: true,
      send_to_recipient: Boolean(draft.client.email),
    });
    payerLink = sent?.links?.find((l) => l.rel === 'payer-view')?.href || sent?.href || '';
  }
  const inv = normalizeInvoice(await pp('GET', `/v2/invoicing/invoices/${id}`));
  inv.payer_view_url = payerLink || inv.payer_view_url;
  return inv;
}

async function listInvoices() {
  const data = await pp('GET', '/v2/invoicing/invoices?page=1&page_size=50&total_required=true&fields=amount');
  return (data.items || []).map(normalizeInvoice);
}

async function getInvoice(id) {
  return normalizeInvoice(await pp('GET', `/v2/invoicing/invoices/${encodeURIComponent(id)}`));
}

async function remindInvoice(id, { subject, note }) {
  await pp('POST', `/v2/invoicing/invoices/${encodeURIComponent(id)}/remind`, {
    subject, note, send_to_invoicer: true, send_to_recipient: true,
  });
  return { ok: true };
}

async function cancelInvoice(id, { note } = {}) {
  await pp('POST', `/v2/invoicing/invoices/${encodeURIComponent(id)}/cancel`, {
    subject: 'Invoice cancelled', note: note || 'This invoice has been cancelled.', send_to_invoicer: true, send_to_recipient: true,
  });
  return { ok: true };
}

// ---------- Orders (checkout payment links) ----------
function normalizeOrder(o) {
  const pu = o.purchase_units?.[0] || {};
  const capture = pu.payments?.captures?.[0];
  return {
    id: o.id,
    status: o.status,
    description: pu.description || pu.items?.[0]?.name || '',
    client_name: pu.custom_id || '',
    currency: pu.amount?.currency_code,
    total: pu.amount?.value,
    approve_url: (o.links || []).find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href || '',
    capture_id: capture?.id || '',
    payer_email: o.payer?.email_address || '',
  };
}

async function createOrder(draft, { returnUrl, cancelUrl }) {
  const cur = draft.currency;
  const total = draftTotal(draft);
  const body = {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: `IP-${Date.now()}`,
      description: (draft.items.map((i) => i.name).join(', ') || 'Freelance services').slice(0, 127),
      custom_id: String(draft.client.name || '').slice(0, 127),
      amount: { currency_code: cur, value: total, breakdown: { item_total: { currency_code: cur, value: total } } },
      items: draft.items.map((it) => ({
        name: String(it.name).slice(0, 127),
        quantity: String(it.quantity || 1),
        unit_amount: { currency_code: cur, value: fmt(it.unit_amount, cur) },
        category: 'DIGITAL_GOODS',
      })),
    }],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: cfg.businessName.slice(0, 127),
          user_action: 'PAY_NOW',
          shipping_preference: 'NO_SHIPPING',
          return_url: returnUrl,
          cancel_url: cancelUrl,
        },
      },
    },
  };
  return normalizeOrder(await pp('POST', '/v2/checkout/orders', body, { 'PayPal-Request-Id': `ip-${Date.now()}-${Math.random().toString(36).slice(2)}` }));
}

async function getOrder(id) { return normalizeOrder(await pp('GET', `/v2/checkout/orders/${encodeURIComponent(id)}`)); }
async function captureOrder(id) { return normalizeOrder(await pp('POST', `/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {})); }

module.exports = {
  mode: 'sandbox',
  createInvoice, listInvoices, getInvoice, remindInvoice, cancelInvoice,
  createOrder, getOrder, captureOrder,
};
