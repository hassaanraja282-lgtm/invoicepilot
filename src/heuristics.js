// Rule-based fallback extractor, used when no AI key is configured (demo mode)
// or when the AI call fails. It is deliberately simple; the AI path is the
// real product. Handles common English + Hinglish phrasings.
const { todayISO } = require('./money');

const CUR_SYMBOLS = [
  [/us\$|\$|usd|dollars?|bucks/i, 'USD'],
  [/€|eur|euros?/i, 'EUR'],
  [/£|gbp|pounds?/i, 'GBP'],
  [/₹|rs\.?|inr|rupees?/i, 'INR'],
  [/a\$|aud/i, 'AUD'],
  [/c\$|cad/i, 'CAD'],
  [/sgd|s\$/i, 'SGD'],
];
const curOf = (s) => (CUR_SYMBOLS.find(([re]) => re.test(s)) || [null, null])[1];

const PRE = String.raw`(?<![a-zA-Z])(us\$|a\$|c\$|s\$|\$|€|£|₹|rs\.?|usd|eur|gbp|inr|aud|cad|sgd)\s?`;
const NUM = String.raw`(\d[\d,]*(?:\.\d+)?)\s?(k)?`;
const POST = String.raw`\s?(usd|dollars?|bucks|eur|euros?|gbp|pounds?|inr|rupees?|rs|aud|cad|sgd)\b`;
const AMOUNT_RE = new RegExp(`${PRE}${NUM}|${NUM}${POST}`, 'gi');

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function resolveDueDate(text, today = new Date()) {
  const t = text.toLowerCase();
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const add = (n) => { const d = new Date(base); d.setDate(d.getDate() + n); return todayISO(d); };

  let m = t.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (m) return { date: m[1], assumed: false };
  m = t.match(/\b(?:in|within)\s+(\d+)\s+(day|days|week|weeks)\b/) || t.match(/\b(\d+)\s+(din|days|day)\s*(?:me|mein|main)?\b/);
  if (m) return { date: add(Number(m[1]) * (/week/.test(m[2]) ? 7 : 1)), assumed: false };
  m = t.match(/\bnet\s?(\d{1,3})\b/);
  if (m) return { date: add(Number(m[1])), assumed: false };
  if (/\b(today|aaj)\b/.test(t)) return { date: add(0), assumed: false };
  if (/\btomorrow\b/.test(t)) return { date: add(1), assumed: false };
  if (/\b(next week|agle hafte|agle week)\b/.test(t)) return { date: add(7), assumed: false };
  if (/\b(end of (the )?month|month end|mahine ke end)\b/.test(t)) {
    return { date: todayISO(new Date(base.getFullYear(), base.getMonth() + 1, 0)), assumed: false };
  }
  // "15 nov", "15th november", "nov 15"
  m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/) ||
      t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (m) {
    const [day, mon] = /\d/.test(m[1]) ? [Number(m[1]), m[2]] : [Number(m[2]), m[1]];
    let d = new Date(base.getFullYear(), MONTHS.indexOf(mon), day);
    if (d < base) d = new Date(base.getFullYear() + 1, MONTHS.indexOf(mon), day);
    return { date: todayISO(d), assumed: false };
  }
  // weekday names (full or 3-letter)
  m = t.match(/\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/);
  if (m) {
    const idx = WEEKDAYS.findIndex((w) => w.startsWith(m[2].slice(0, 3)));
    let diff = (idx - base.getDay() + 7) % 7 || 7;
    if (m[1]) diff += diff < 7 ? 7 : 0;
    return { date: add(diff), assumed: false };
  }
  return { date: add(14), assumed: true };
}

function findClientName(text, email) {
  const patterns = [
    /\b(?:[Ii]nvoice|[Bb]ill|[Cc]harge)\s+(?:to\s+)?([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})/,
    /\b(?:client|customer|company)\s*(?:is|:|-)?\s*([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})/,
    /\b([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})\s*(?:\([^)]*\)\s*)?(?:ko|ka|ke liye ka)\b/,
    /\bfor\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})\s*(?:\(|,|$|\s+-|\s+for\b)/m,
    /(?:thanks|regards|cheers|best|thank you)[,!.]?\s*\n\s*([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,2})/i,
    /^\s*(?:hi|hey|hello)[^\n]*\n[\s\S]*?\n\s*-\s*([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,2})\s*$/m,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) {
      const name = m[1].replace(/^(Bhai|Bro|Sir|Ma'?am|Dear|Mr\.?|Ms\.?)\s+/i, '').trim();
      if (!/^(I|We|The|A|An|My|Please|Hi|Hello|Invoice|Payment|Due|USD|INR)$/i.test(name)) return name;
    }
  }
  if (email) {
    const [local, domain] = email.split('@');
    const org = domain.split('.')[0];
    if (!/^(gmail|yahoo|outlook|hotmail|icloud|proton|example)$/i.test(org)) return org.charAt(0).toUpperCase() + org.slice(1);
    return local.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return '';
}

function describe(segment, clientName) {
  let s = segment.replace(/\([^)]*\)/g, ' ');
  if (clientName) { const at = s.indexOf(clientName); if (at >= 0) s = s.slice(at + clientName.length); }
  const forM = s.match(/\b(?:for|ke liye)\s+(?:the\s+)?([^.,;\n$€£₹]+?)(?=\s*(?:due|by|before|till|until|tak|in \d|,|\.|;|$|\(|@|\bka\b|\bke\b|\bbhejo\b|\bdena\b))/i);
  if (forM && forM[1] && !/^\s*\d/.test(forM[1])) s = forM[1];
  s = s.replace(new RegExp(AMOUNT_RE.source, 'gi'), ' ')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, ' ')
    .replace(/\b(invoice|bill|bhejo|bana do|banao|send|create|please|pls|kar do|ka|ki|ke|ko|due|by|on|till|until|tak|liye|charge|for|total|amount|and|aur|plus|the|bhai|hai|each|per|pe|par|wala|wale|kaam|work)\b/gi, ' ')
    .replace(/\b(today|tomorrow|next week|friday|monday|tuesday|wednesday|thursday|saturday|sunday)\b/gi, ' ');
  if (clientName) s = s.replace(new RegExp(clientName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
  s = s.replace(/[^\w\s&/()'-]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^[\s\-–:]+|[\s\-–:]+$/g, '');
  if (s.length < 3) return 'Professional services';
  return s.charAt(0).toUpperCase() + s.slice(1, 120);
}

function extractHeuristic(text, { defaultCurrency = 'USD', today = new Date() } = {}) {
  const email = (text.match(/[\w.+-]+@[\w-]+\.[\w.]+/) || [])[0] || '';
  const clientName = findClientName(text, email);
  const items = [];
  let currency = null;

  const segments = text.split(/\n|;|\.(?!\d)\s|,(?!\d{3})|\band\b|\baur\b|\bplus\b/i);
  for (const seg of segments) {
    const re = new RegExp(AMOUNT_RE.source, 'gi');
    let m;
    while ((m = re.exec(seg))) {
      const sym = m[1] || m[6] || '';
      const raw = (m[2] || m[4] || '0').replace(/,/g, '');
      const k = m[3] || m[5];
      let value = Number(raw) * (k ? 1000 : 1);
      if (!value) continue;
      currency = currency || curOf(sym);
      // "6 posts at $25 each" / "3 x $50"
      const qtyM = seg.match(/\b(\d{1,3})\s*(?:x|×|posts?|hours?|hrs?|pages?|reels?|videos?|logos?|designs?|units?|items?)\b/i);
      const qty = qtyM && /\b(each|per|x|at|@)\b|×|@|\//i.test(seg) ? Number(qtyM[1]) : 1;
      items.push({ name: describe(seg, clientName), quantity: qty, unit_amount: value });
    }
  }

  const due = resolveDueDate(text, today);
  const missing = [];
  const assumptions = [];
  if (!email) missing.push('client_email');
  if (!clientName) missing.push('client_name');
  if (!items.length) missing.push('amount');
  if (due.assumed) assumptions.push('No due date found, so I set it 14 days from today.');
  if (!currency) assumptions.push(`No currency found, so I used ${defaultCurrency}.`);

  return {
    client: { name: clientName || 'Client', email, business_name: '' },
    items: items.length ? items : [{ name: 'Professional services', quantity: 1, unit_amount: 0 }],
    currency: currency || defaultCurrency,
    due_date: due.date,
    note: 'Thank you for your business!',
    terms: '',
    missing,
    assumptions,
  };
}

module.exports = { extractHeuristic, resolveDueDate };
