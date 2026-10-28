// Small helpers for money and dates that both the real and the demo PayPal
// clients share. Amounts are handled in minor units to avoid float errors,
// because PayPal rejects an order whose item_total does not add up exactly.

const ZERO_DECIMAL = new Set(['JPY', 'HUF', 'TWD']);

const decimals = (cur) => (ZERO_DECIMAL.has(cur) ? 0 : 2);
const toMinor = (v, cur) => Math.round(Number(v) * 10 ** decimals(cur));
const fromMinor = (m, cur) => (m / 10 ** decimals(cur)).toFixed(decimals(cur));
const fmt = (v, cur) => Number(v).toFixed(decimals(cur));

function draftTotal(draft) {
  const cur = draft.currency;
  const minor = draft.items.reduce((s, it) => s + toMinor(it.unit_amount, cur) * Number(it.quantity || 1), 0);
  return fromMinor(minor, cur);
}

function todayISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function splitName(full = '') {
  const parts = String(full).trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { given_name: parts[0] || 'Client', surname: '' };
  return { given_name: parts.slice(0, -1).join(' '), surname: parts[parts.length - 1] };
}

module.exports = { decimals, toMinor, fromMinor, fmt, draftTotal, todayISO, splitName };
