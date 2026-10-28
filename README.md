# ✈︎ InvoicePilot: paste a client chat, get paid with PayPal

**InvoicePilot is an AI billing agent for solo freelancers.** You paste a WhatsApp chat or a client email, or just type *"invoice Acme $300 for logo design due Friday"* in English or Hinglish. The AI pulls out the client, line items, amounts, currency, due date and terms. Then **one click creates and sends a real PayPal invoice** (Invoicing v2 API) or a **PayPal checkout link** (Orders v2 API + PayPal JS SDK Smart Buttons) you can drop into WhatsApp. After that, the agent tracks who has paid and **drafts polite reminders that PayPal sends for you**.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/). Uses the free PayPal **sandbox**, so no real money moves.

> **No keys? It still runs.** With no keys set, InvoicePilot starts in **demo mode**: a mock PayPal and a built-in rule-based parser, so you can click through the whole product in 30 seconds. Add keys later to switch to the real PayPal sandbox and a real AI model.

---

## Why

Freelancers in India and elsewhere lose hours, and often money, to the admin around getting paid by overseas clients. The agreement lives in a chat ("₹ / $, 50% advance, rest by Friday"). Turning that into a proper invoice, sending it, and then awkwardly chasing late payers is the part everyone puts off. InvoicePilot turns the chat into the invoice and does the chasing, while **you stay in control: nothing goes to a client until you click**.

## Features

| | What it does | PayPal / AI used |
|---|---|---|
| ✨ **Chat → invoice** | Paste any message (English / Hindi / Hinglish). The AI extracts client, email, line items, quantity × price, currency, due date ("Friday", "15 tarikh", "net 15"), terms and advance already paid. It flags what's missing and what it assumed. Every field is editable. | LLM (JSON mode) |
| 📨 **Send PayPal invoice** | Creates and sends a professional invoice. The client gets PayPal's hosted invoice page and pays there with PayPal (or a card, where PayPal offers it). | **Invoicing v2**: create, send |
| 🔗 **Checkout link** | Creates a PayPal order and a branded pay page with **PayPal Smart Buttons**. The payment is captured automatically. Comes with a one-tap "share on WhatsApp" link. | **Orders v2**: create, get, capture · **JS SDK** |
| 💬 **Agent chat** | "Who hasn't paid?", "Remind Northwind", "Is mahine kitna pending hai?", "Invoice Priya 6 posts at $25 each". An LLM with **tool calling** over live PayPal data. | LLM tools → Invoicing v2 list/get |
| ✉️ **AI payment reminders** | Writes a friendly or firm reminder based on how overdue the invoice is. You review it, then PayPal emails it with the pay link. | LLM + **Invoicing v2 remind** |
| 📊 **Dashboard** | Paid / outstanding / overdue per currency, invoice table with live status, remind and cancel actions, checkout links with capture status. | **Invoicing v2** list/cancel, **Orders v2** get |
| 🛟 **Never breaks on stage** | If the AI provider is down or rate-limited, the app falls back to the rule-based parser and says so in the UI. Without PayPal keys, a mock PayPal runs instead. | n/a |

**Human-in-the-loop by design:** the agent's tools only *prepare* actions (invoice drafts, reminder drafts). Anything that contacts a client or requests money needs your click.

## Architecture

```
Browser (public/: vanilla HTML/CSS/JS, no build step)
   │  /api/extract  /api/invoices  /api/payment-links  /api/chat ...
   ▼
Express server (server.js)
   ├── src/ai.js          OpenAI-compatible Chat Completions client (Gemini / OpenAI / Groq / OpenRouter / Ollama)
   │                      extraction prompt (JSON) + reminder writer, with fallback to src/heuristics.js
   ├── src/agent.js       tool-calling agent: prepare_invoice, list_invoices, find_invoice, draft_reminder, payment_summary
   ├── src/paypal.js      PayPal REST: OAuth2, Invoicing v2, Orders v2 (sandbox)
   ├── src/mockPaypal.js  same interface, in memory (demo mode)
   └── /pay/:id           hosted checkout page using the PayPal JS SDK Smart Buttons
```

Only two npm dependencies (`express`, `dotenv`). Node 18+ built-in `fetch` talks to PayPal and the AI provider.

---

## 🚀 Deploy in 5 minutes (no coding)

### Option A: One-click on Render (recommended, free)

1. Fork or upload this repo to your GitHub account.
2. Click the button below, **or** in Render go to **New → Blueprint** and pick your repo:

   [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/hassaanraja282-lgtm/new)

   *(Replace `hassaanraja282-lgtm` with your GitHub username in this README after you push.)*
3. Render asks for `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `GEMINI_API_KEY` and `OPENAI_API_KEY`. Paste the ones you have and leave the rest blank. Blank PayPal keys = demo PayPal; blank AI keys = demo AI.
4. Click **Apply**. In about 2 minutes you get a URL like `https://invoicepilot-xxxx.onrender.com`. Open it.

To change keys later: Render dashboard → your service → **Environment** → edit → **Save changes**. Render redeploys on its own.

> The free Render plan sleeps after 15 minutes idle, so the first visit after that takes about 30 to 50 seconds to wake. Open the URL once before you record or demo.

### Option B: Run on your computer

1. Install **Node.js 18 or newer** from https://nodejs.org (the "LTS" button).
2. Download this repo (green **Code** button → **Download ZIP**) and unzip it.
3. Open a terminal in the folder and run:
   ```bash
   npm install
   npm start
   ```
4. Open http://localhost:3000. It runs in demo mode.
5. To use real keys, copy `.env.example` to `.env`, fill in your keys, and run `npm start` again.

### Option C: Docker
```bash
docker build -t invoicepilot .
docker run -p 3000:3000 --env-file .env invoicepilot
```

---

## 🔑 Getting the (free) keys

### PayPal sandbox (required for real PayPal calls)
1. Sign in at https://developer.paypal.com with any PayPal account (or create a free one).
2. Go to **Apps & Credentials**, make sure the toggle at the top says **Sandbox**, and open the **Default Application** (or click **Create App**, type *Merchant*).
3. Copy the **Client ID** and **Secret** into `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`.
4. Under **Testing Tools → Sandbox Accounts** you'll see a **Business** account (that's you, the freelancer) and a **Personal** account (use it as "the client" to pay invoices and checkout links). Click **⋯ → View/Edit account** to see its email and password.

### AI key (pick one)
- **Google Gemini (free tier, recommended):** https://aistudio.google.com/apikey → **Create API key** → set `GEMINI_API_KEY`. Default model `gemini-3.8-flash`; override with `AI_MODEL`.
- **OpenAI:** https://platform.openai.com/api-keys → set `OPENAI_API_KEY` (default model `gpt-4.1-mini`).
- **Groq (free tier):** `GROQ_API_KEY`. **Any other OpenAI-compatible API** (Ollama, OpenRouter...): `AI_PROVIDER=custom`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`.

### All settings
| Variable | Default | Meaning |
|---|---|---|
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | *(empty → demo)* | Sandbox REST app credentials |
| `PAYPAL_ENV` | `sandbox` | `sandbox` or `live` |
| `AI_PROVIDER` | `auto` | `auto`, `gemini`, `openai`, `groq`, `openrouter`, `custom`, `demo` |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` / `GROQ_API_KEY` / `AI_API_KEY` | *(empty → demo)* | AI key |
| `AI_MODEL`, `AI_BASE_URL` | per provider | Override model / endpoint |
| `BUSINESS_NAME` | `My Freelance Studio` | Shown on invoices and pay pages |
| `DEFAULT_CURRENCY` | `USD` | Used when a message has no currency |
| `APP_PASSWORD` | *(empty)* | If set, the dashboard asks for this password (any username). Client pay pages stay public. |
| `PUBLIC_URL` | auto | Force the base URL used in PayPal return links |

---

## 🧪 Testing it end to end (judges)

**Demo mode (no keys):** open the app, then:
1. **New invoice** → click **🇮🇳 Hinglish** → **✨ Build invoice with AI** → **📨 Send PayPal invoice** → **Open** → **Pay with PayPal (demo)**.
2. **🔗 Create checkout link** → **Open** → pay → status becomes `COMPLETED` in the Dashboard.
3. **Agent** → "Who hasn't paid?" → "Remind Northwind" → **Send reminder via PayPal**.

**Sandbox mode (with keys):** same steps. The invoice is created in the PayPal sandbox, and **Open** takes you to PayPal's real sandbox invoice page. Log in there with the **sandbox Personal account** to pay. In the Dashboard, **↻ Refresh from PayPal** then shows `PAID`. For checkout links, pay on the `/pay/...` page with the sandbox Personal account. The capture happens on our server through Orders v2.

> PayPal sandbox does not deliver real emails. Sent invoices and reminders show up in the sandbox account's notifications at https://developer.paypal.com → **Testing Tools → Sandbox Notifications**.

**Automated tests:**
```bash
npm test
```
- `test/smoke.js` boots the app and hits every route in demo mode: extraction for 3 sample messages, invoice create/list/get/remind/cancel, payment link create/capture, pay pages, and 4 agent conversations.
- `test/integration.js` runs the **real** PayPal and AI code paths against local fake PayPal and OpenAI-compatible servers. It checks OAuth, Invoicing v2 request shape, Orders v2 `item_total` math, return-URL capture, and the agent's tool-call loop.

## Notes & limits
- Sandbox business accounts are US accounts by default, so use **USD, EUR, GBP, AUD, CAD**, etc. INR billing generally isn't accepted on a US sandbox account. If PayPal rejects a currency, the app shows PayPal's exact error message.
- Checkout links are kept in memory (PayPal has no "list orders" API), so the list resets when the server restarts. The orders themselves stay in PayPal.
- Demo-mode data is in memory and resets on restart.

## AI tools used
- **Runtime AI (in the product):** Google Gemini (`gemini-3.8-flash`, through Gemini's OpenAI-compatible API) by default. Works with OpenAI GPT models, Groq Llama models, or any OpenAI-compatible model. Used for structured extraction (JSON mode), tool-calling agent, and reminder writing.
- **Development:** Built with help from Hark (an AI assistant) for code generation, test writing and documentation.

## License
[MIT](./LICENSE) © 2026 Raja Hassaan
