// InvoicePilot front-end (no build step, plain JS).
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);
let STATUS = {};

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), err ? 6000 : 3000);
}
async function busy(btn, fn) {
  const label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Working…';
  try { return await fn(); } catch (e) { toast(e.message, true); } finally { btn.disabled = false; btn.innerHTML = label; }
}
const money = (cur, v) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(Number(v)); } catch { return `${cur} ${v}`; } };

// ---------- Status badges ----------
async function loadStatus() {
  STATUS = await api('/api/status');
  const pp = STATUS.paypal.mode === 'demo' ? '<span class="badge demo">PayPal: demo</span>' : `<span class="badge live">PayPal ${esc(STATUS.paypal.mode)}</span>`;
  const ai = STATUS.ai.mode === 'demo' ? '<span class="badge demo">AI: demo rules</span>' : `<span class="badge live">AI: ${esc(STATUS.ai.provider)} · ${esc(STATUS.ai.model)}</span>`;
  $('#status').innerHTML = pp + ai;
}

// ---------- Tabs ----------
function showTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.panel').forEach((p) => (p.hidden = p.id !== `tab-${name}`));
  if (name === 'dashboard') loadDashboard();
  if (name === 'agent') $('#chat-input').focus();
}
$$('.tab').forEach((t) => (t.onclick = () => showTab(t.dataset.tab)));

// ---------- Samples ----------
const SAMPLES = {
  email: `Hi Raja,

Thanks for the great work on the new Bloom & Co. brand kit - the team loves it!
Can you send over the invoice? As agreed it's $450 for the logo + brand guide, plus $120 for the 4 social media templates.
Our accounts team needs it paid by the 15th of next month at the latest. Please send it to accounts@bloomco.example.

Best,
Sarah Lin
Marketing Lead, Bloom & Co.`,
  hinglish: `Bhai Rohan Kapoor (rohan.k@example.com) ko invoice bhejo - website ke 3 pages ka $150 each, aur hosting setup ka $40. 50% advance pehle hi mil gaya tha, baaki amount Friday tak due hai.`,
  quick: `invoice Acme Corp $300 for logo design due Friday, billing@acme.example`,
};
$$('[data-sample]').forEach((b) => (b.onclick = () => { $('#raw').value = SAMPLES[b.dataset.sample]; $('#raw').focus(); }));

// ---------- Draft editor (used in Create tab and agent cards) ----------
function renderDraft(container, draft, meta = {}) {
  const cur = draft.currency;
  const notes = [...(meta.warnings || []), ...(draft.assumptions || []), ...(draft.missing || []).map((m) => m === 'client_email' ? 'No client email found - add one to have PayPal email the invoice, or just create a payment link.' : `Missing: ${m}`)];
  container.innerHTML = `
    ${notes.length ? `<div class="notes"><b>Check these:</b><ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
    <div class="row c2">
      <div><label>Client name</label><input name="name" value="${esc(draft.client.name)}"></div>
      <div><label>Client email</label><input name="email" type="email" placeholder="client@company.com" value="${esc(draft.client.email)}"></div>
    </div>
    <div class="items-h"><span>Item</span><span>Qty</span><span>Price (${esc(cur)})</span><span></span></div>
    <div class="items">${draft.items.map(itemRow).join('')}</div>
    <button type="button" class="btn btn-ghost btn-sm add-item">+ Add item</button>
    <div class="row c3" style="margin-top:12px">
      <div><label>Currency</label><input name="currency" maxlength="3" value="${esc(cur)}"></div>
      <div><label>Due date</label><input name="due_date" type="date" value="${esc(draft.due_date)}" min="${today()}"></div>
      <div><label>Terms</label><input name="terms" value="${esc(draft.terms || '')}" placeholder="Optional"></div>
    </div>
    <div class="row"><div><label>Note to client</label><input name="note" value="${esc(draft.note || '')}"></div></div>
    <div class="total"><span class="muted">Total</span><b class="total-v"></b></div>
    <div class="actions">
      <button type="button" class="btn btn-paypal send-inv">📨 Send PayPal invoice</button>
      <button type="button" class="btn btn-dark make-link">🔗 Create checkout link</button>
    </div>
    <p class="hint">Invoice = PayPal emails a professional invoice (Invoicing API). Checkout link = a PayPal pay page you can share on WhatsApp (Orders API + Smart Buttons).</p>
    <div class="draft-result"></div>`;

  const read = () => ({
    client: { name: $('[name=name]', container).value.trim(), email: $('[name=email]', container).value.trim(), business_name: '' },
    items: $$('.item', container).map((r) => ({ name: $('.i-name', r).value.trim(), quantity: Number($('.i-qty', r).value) || 1, unit_amount: Number($('.i-amt', r).value) || 0 })).filter((i) => i.name),
    currency: $('[name=currency]', container).value.trim().toUpperCase() || 'USD',
    due_date: $('[name=due_date]', container).value,
    terms: $('[name=terms]', container).value.trim(),
    note: $('[name=note]', container).value.trim(),
  });
  const updateTotal = () => { const d = read(); $('.total-v', container).textContent = money(d.currency, d.items.reduce((s, i) => s + i.quantity * i.unit_amount, 0)); };
  container.addEventListener('input', updateTotal);
  container.addEventListener('click', (e) => {
    if (e.target.classList.contains('x')) { e.target.closest('.item').remove(); updateTotal(); }
  });
  $('.add-item', container).onclick = () => { $('.items', container).insertAdjacentHTML('beforeend', itemRow({ name: '', quantity: 1, unit_amount: '' })); };
  updateTotal();

  $('.send-inv', container).onclick = (e) => busy(e.currentTarget, async () => {
    const d = read();
    if (!d.client.email && !confirm('No client email: PayPal will create the invoice but won\'t email it. You can still share the link yourself. Continue?')) return;
    const { invoice } = await api('/api/invoices', { method: 'POST', body: { draft: d, send: true } });
    $('.draft-result', container).innerHTML = successCard('Invoice sent via PayPal', `${invoice.number || invoice.id} · ${money(invoice.currency, invoice.total)} to ${invoice.client_name} · due ${invoice.due_date}`, invoice.payer_view_url, invoice.status);
    toast('Invoice created and sent with PayPal ✅');
  });
  $('.make-link', container).onclick = (e) => busy(e.currentTarget, async () => {
    const { link } = await api('/api/payment-links', { method: 'POST', body: { draft: read() } });
    $('.draft-result', container).innerHTML = successCard('PayPal checkout link ready', `${money(link.currency, link.total)} · ${link.description}`, link.pay_url, link.status, `Hi ${read().client.name.split(' ')[0]}, here's the payment link for ${link.description}: ${link.pay_url} - thank you!`);
    toast('Checkout link created ✅');
  });
}
const itemRow = (i) => `<div class="item"><input class="i-name" value="${esc(i.name)}" placeholder="Description"><input class="i-qty" type="number" min="1" value="${esc(i.quantity)}"><input class="i-amt" type="number" min="0" step="0.01" value="${esc(i.unit_amount)}"><button type="button" class="x" title="Remove">×</button></div>`;

function successCard(title, sub, url, status, shareText) {
  const abs = url && url.startsWith('/') ? location.origin + url : url;
  return `<div class="card success" style="margin-top:14px">
    <div class="card-h"><h2>✅ ${esc(title)}</h2><span class="st ${esc(status)}">${esc(status)}</span></div>
    <p class="muted small">${esc(sub)}</p>
    ${abs ? `<div class="linkbox"><input readonly value="${esc(abs)}" onclick="this.select()"><button type="button" class="btn btn-ghost btn-sm" onclick="navigator.clipboard.writeText('${esc(abs)}');this.textContent='Copied'">Copy</button><a class="btn btn-primary btn-sm" href="${esc(abs)}" target="_blank" rel="noopener">Open</a></div>` : ''}
    ${shareText ? `<p class="hint">WhatsApp-ready: <a target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(shareText.replace(url, abs))}">share this link on WhatsApp</a></p>` : ''}
  </div>`;
}

// ---------- Create tab ----------
$('#extract').onclick = (e) => busy(e.currentTarget, async () => {
  const text = $('#raw').value.trim();
  if (!text) return toast('Paste a client message first', true);
  const t0 = performance.now();
  const r = await api('/api/extract', { method: 'POST', body: { text } });
  $('#draft-empty').hidden = true;
  const form = $('#draft'); form.hidden = false;
  const fresh = form.cloneNode(false); fresh.onsubmit = (ev) => ev.preventDefault(); form.replaceWith(fresh);
  renderDraft(fresh, r.draft, r);
  const src = $('#draft-source'); src.hidden = false;
  src.className = 'pill' + (r.source === 'ai' ? ' ai' : '');
  src.textContent = r.source === 'ai' ? `AI · ${STATUS.ai.provider}` : 'Built-in parser';
  $('#extract-meta').textContent = `Extracted in ${((performance.now() - t0) / 1000).toFixed(1)}s`;
});

// ---------- Agent chat ----------
const history = [];
function addMsg(role, html, cls = '') { const d = document.createElement('div'); d.className = `msg ${role} ${cls}`; d.innerHTML = html; $('#chat').appendChild(d); $('#chat').scrollTop = 1e9; return d; }
function addCard(node) { node.classList.add('agent-card'); $('#chat').appendChild(node); $('#chat').scrollTop = 1e9; }

async function say(text) {
  if (!text.trim()) return;
  history.push({ role: 'user', content: text });
  addMsg('user', esc(text));
  const typing = addMsg('bot', 'InvoicePilot is thinking…', 'typing');
  try {
    const r = await api('/api/chat', { method: 'POST', body: { messages: history } });
    typing.remove();
    if (r.warning) addMsg('warn', esc(r.warning));
    addMsg('bot', esc(r.reply));
    history.push({ role: 'assistant', content: r.reply });
    for (const c of r.cards || []) renderAgentCard(c);
  } catch (e) { typing.remove(); addMsg('warn', esc(e.message)); }
}
function renderAgentCard(c) {
  const el = document.createElement('div');
  if (c.type === 'invoice_draft') { renderDraft(el, c.draft, c); addCard(el); }
  else if (c.type === 'invoice_list') { el.innerHTML = `<h2 style="margin-bottom:8px">${esc(c.title)}</h2>${invoiceTable(c.invoices, true)}`; addCard(el); wireInvoiceActions(el); }
  else if (c.type === 'reminder') { el.innerHTML = reminderForm(c.invoice, c.subject, c.note); addCard(el); wireReminder(el, c.invoice); }
  else if (c.type === 'summary') { el.innerHTML = Object.entries(c.summary).map(([cur, v]) => `<div class="stats" style="margin:0 0 8px">${stat('Paid', money(cur, v.paid), 'green')}${stat('Outstanding', money(cur, v.outstanding))}${stat('Overdue', money(cur, v.overdue), 'red')}</div>`).join('') || 'No invoices yet.'; addCard(el); }
}
$('#chat-form').onsubmit = (e) => { e.preventDefault(); const v = $('#chat-input').value; $('#chat-input').value = ''; say(v); };
$$('[data-say]').forEach((b) => (b.onclick = () => say(b.dataset.say)));
addMsg('bot', 'Hi! I\'m your billing agent. Tell me who to bill ("Invoice Acme $300 for logo design due Friday"), ask "who hasn\'t paid?", or say "remind Northwind". Hinglish works too 🙂');

// ---------- Reminders ----------
function reminderForm(inv, subject, note) {
  return `<h2 style="margin-bottom:6px">✉️ Reminder for ${esc(inv.client_name)}</h2>
  <p class="muted small">${esc(inv.number || inv.id)} · ${money(inv.currency, inv.total)} · due ${esc(inv.due_date)} · AI-drafted, edit freely</p>
  <div class="row"><div><label>Subject</label><input class="r-subj" value="${esc(subject)}"></div></div>
  <div class="row"><div><label>Message</label><textarea class="r-note" rows="4">${esc(note)}</textarea></div></div>
  <div class="actions"><button type="button" class="btn btn-paypal r-send">Send reminder via PayPal</button><button type="button" class="btn btn-ghost r-redo">↻ Make it firmer</button></div>`;
}
function wireReminder(el, inv) {
  $('.r-send', el).onclick = (e) => busy(e.currentTarget, async () => {
    await api(`/api/invoices/${encodeURIComponent(inv.id)}/remind`, { method: 'POST', body: { subject: $('.r-subj', el).value, note: $('.r-note', el).value } });
    el.innerHTML = `<b style="color:var(--green)">✅ Reminder sent to ${esc(inv.client_name)} via PayPal.</b>`;
    toast('Reminder sent ✅');
  });
  $('.r-redo', el).onclick = (e) => busy(e.currentTarget, async () => {
    const r = await api(`/api/invoices/${encodeURIComponent(inv.id)}/reminder-draft`, { method: 'POST', body: { tone: 'firm' } });
    $('.r-subj', el).value = r.subject; $('.r-note', el).value = r.note;
  });
}
function openReminderModal(inv, subject, note) {
  const m = $('#modal'); const b = $('#modal-body');
  b.innerHTML = reminderForm(inv, subject, note) + '<div class="modal-actions"><button class="btn btn-ghost btn-sm" value="close">Close</button></div>';
  wireReminder(b, inv); m.showModal();
}

// ---------- Dashboard ----------
const isOver = (i) => ['SENT', 'UNPAID', 'PARTIALLY_PAID', 'PAYMENT_PENDING'].includes(i.status) && i.due_date && i.due_date < today();
const stat = (k, v, cls = '') => `<div class="stat ${cls}"><div class="k">${k}</div><div class="v">${v}</div></div>`;
function invoiceTable(list, compact = false) {
  if (!list.length) return '<div class="empty">No invoices yet - create one from the New invoice tab.</div>';
  return `<div class="tbl-wrap"><table><tr><th>Invoice</th><th>Client</th><th>Amount</th><th>Due</th><th>Status</th><th></th></tr>${list.map((i) => {
    const st = isOver(i) ? 'OVERDUE' : i.status;
    const unpaid = ['SENT', 'UNPAID', 'PARTIALLY_PAID'].includes(i.status);
    const view = i.payer_view_url ? (i.payer_view_url.startsWith('/') ? i.payer_view_url : i.payer_view_url) : '';
    return `<tr><td><b>${esc(i.number || '-')}</b><div class="muted tiny">${esc(i.id)}</div></td><td>${esc(i.client_name)}<div class="muted tiny">${esc(i.client_email)}</div></td><td><b>${money(i.currency, i.total)}</b></td><td>${esc(i.due_date)}</td><td><span class="st ${st}">${st}</span></td>
    <td><div class="td-actions">${view ? `<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${esc(view)}">View</a>` : ''}${unpaid ? `<button class="btn btn-primary btn-sm" data-remind="${esc(i.id)}">✉️ Remind</button>` : ''}${unpaid && !compact ? `<button class="btn btn-danger btn-sm" data-cancel="${esc(i.id)}">Cancel</button>` : ''}</div></td></tr>`;
  }).join('')}</table></div>`;
}
function wireInvoiceActions(root) {
  $$('[data-remind]', root).forEach((b) => (b.onclick = () => busy(b, async () => {
    const r = await api(`/api/invoices/${encodeURIComponent(b.dataset.remind)}/reminder-draft`, { method: 'POST', body: { tone: 'friendly' } });
    openReminderModal(r.invoice, r.subject, r.note);
  })));
  $$('[data-cancel]', root).forEach((b) => (b.onclick = () => { if (confirm('Cancel this invoice in PayPal? The client will be notified.')) busy(b, async () => { await api(`/api/invoices/${encodeURIComponent(b.dataset.cancel)}/cancel`, { method: 'POST', body: {} }); toast('Invoice cancelled'); loadDashboard(); }); }));
}
async function loadDashboard() {
  $('#inv-table').innerHTML = '<p class="muted">Loading from PayPal…</p>';
  try {
    const { invoices, summary } = await api('/api/invoices');
    const curs = Object.keys(summary);
    $('#stats').innerHTML = curs.length ? curs.map((c) => `${stat(`Paid (${c})`, money(c, summary[c].paid), 'green')}${stat(`Outstanding (${c})`, money(c, summary[c].outstanding))}${stat(`Overdue (${c})`, money(c, summary[c].overdue), 'red')}`).join('') : '';
    $('#inv-table').innerHTML = invoiceTable(invoices);
    wireInvoiceActions($('#inv-table'));
  } catch (e) { $('#inv-table').innerHTML = `<div class="notes">${esc(e.message)}</div>`; }
  try {
    const { links } = await api('/api/payment-links');
    $('#links-table').innerHTML = links.length ? `<div class="tbl-wrap"><table><tr><th>Order</th><th>Client</th><th>Amount</th><th>Status</th><th></th></tr>${links.map((l) => `<tr><td class="tiny">${esc(l.id)}</td><td>${esc(l.client_name)}</td><td><b>${money(l.currency, l.total)}</b></td><td><span class="st ${esc(l.status)}">${esc(l.status)}</span></td><td><div class="td-actions"><a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${esc(l.pay_url)}">Open pay page</a></div></td></tr>`).join('')}</table></div>` : '<div class="empty">No checkout links yet.</div>';
  } catch (e) { $('#links-table').innerHTML = `<div class="notes">${esc(e.message)}</div>`; }
}
$('#refresh').onclick = loadDashboard;

loadStatus().catch(() => {});
