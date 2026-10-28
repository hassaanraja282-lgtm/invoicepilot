# Devpost submission: InvoicePilot

**Tagline (short description field):** Paste a client chat, get paid with PayPal. An AI billing agent that turns WhatsApp/email conversations into PayPal invoices and checkout links, then politely chases late payers.

**Links to fill in:**
- Public repo: `https://github.com/<you>/invoicepilot` (MIT license shows in the repo's About section)
- Live demo: `https://<your-app>.onrender.com`
- Video: `https://youtu.be/<id>` (public, under 3:00)
- Testing instructions: see README → "Testing it end to end". Paste your **sandbox Personal account** email + password into the Devpost "testing instructions" field so judges can pay a sandbox invoice.

**Prize categories this fits:** Grand Prize · Best Use of PayPal + AI · Best Use of Agentic Commerce · Most Impactful · **Best Use of Render** (deployed as a Render Blueprint, `render.yaml`).

---

## Inspiration

I'm a solo freelancer in India, and most of my clients are abroad. The work agreement always lives in a chat: "logo + brand guide for $450, 50% advance, rest by Friday." Turning that chat into a proper invoice, sending it, and then chasing the client (awkwardly) when the due date passes is the part every freelancer puts off. It costs real money: invoices go out late, reminders never get sent, and payments slip by weeks.

PayPal already has everything needed to get paid internationally, including professional invoices, hosted checkout and reminders. The missing piece is the translation from *how freelancers actually talk to clients* to *a structured invoice*. That's exactly what modern AI is good at.

## What it does

InvoicePilot is an AI billing agent for freelancers:

1. **Chat → invoice.** Paste a WhatsApp chat, an email, or type "invoice Acme $300 for logo design due Friday", in English, Hindi or Hinglish. The AI extracts the client's name and email, every line item with quantity × price, currency, due date ("Friday", "15 tarikh", "net 15"), terms and any advance already paid. It shows what it assumed and what's missing, and every field stays editable.
2. **One click to PayPal.** Choose **Send PayPal invoice**, which creates and sends a real invoice through the **PayPal Invoicing v2 API**, or **Create checkout link**, which creates a **PayPal Orders v2** order and a branded pay page with **PayPal JS SDK Smart Buttons**, ready to share on WhatsApp. Payment is captured automatically.
3. **Agent chat.** Ask "Who hasn't paid?", "Remind Northwind" or "Is mahine kitna pending hai?". An LLM with tool calling reads live invoice status from PayPal and answers.
4. **AI reminders that PayPal sends.** The agent drafts a polite (or firmer) reminder based on how overdue the invoice is. You review it, and it goes out through PayPal's invoice-reminder API with the pay link attached.
5. **Dashboard** of paid / outstanding / overdue per currency, with remind and cancel actions.

It's **human-in-the-loop by design**: the agent prepares actions, and nothing reaches a client or requests money until the freelancer clicks.

## How we built it

- **Backend:** Node.js + Express, only two dependencies. Uses the built-in `fetch` to call the PayPal REST APIs directly:
  - OAuth 2.0 client-credentials token (cached)
  - **Invoicing v2:** create, send, list, get, remind, cancel
  - **Orders v2:** create (with an exact `item_total` breakdown computed in minor units), get, capture, plus the return-URL capture flow
  - **PayPal JS SDK** Smart Buttons on the hosted `/pay/:orderId` page
- **AI:** a provider-agnostic client for any OpenAI-compatible Chat Completions API. **Google Gemini** is the default (free tier); OpenAI, Groq, OpenRouter and local Ollama also work. Three AI jobs:
  - **Structured extraction** in JSON mode, with a prompt that resolves relative dates against today, handles "k" amounts, Hinglish, and advances already paid. Output is validated and sanitized before it touches PayPal. The model is never allowed to invent an email.
  - **A tool-calling agent** (`prepare_invoice`, `list_invoices`, `find_invoice`, `draft_reminder`, `payment_summary`) that runs a multi-step loop over live PayPal data.
  - **Reminder writing** that adapts tone to days overdue.
- **Resilience:** a rule-based English/Hinglish parser is the fallback when the AI is unavailable. A mock PayPal with the same interface powers **demo mode**, so anyone can run the app with zero keys.
- **Frontend:** plain HTML/CSS/JS with no build step, styled in PayPal's palette.
- **Deploy:** a Render Blueprint (`render.yaml`) for one-click deploy, plus a Dockerfile.
- **Tests:** an end-to-end smoke test of every route, and an integration test that runs the real PayPal and AI code paths against local fake PayPal and OpenAI-compatible servers. It checks request shapes, order totals and the tool-call loop.

## Challenges we ran into

- **Messy, mixed-language input.** Real client chats mix Hindi and English, use "k" for thousands, put the price per unit in one place and the quantity in another, and mention advances already paid. Getting reliable structured output meant a strict JSON contract, validation, and showing the AI's assumptions to the user instead of hiding them.
- **Money math PayPal accepts.** Orders v2 rejects an order if `item_total` doesn't exactly equal the sum of the line items, so all amounts are computed in minor units, with zero-decimal currencies handled.
- **Agent safety.** An agent that can send invoices and emails to clients is risky. I split tools into *prepare* (agent) and *execute* (human click), so the agent can never send money requests on its own.
- **Never failing in a demo.** AI providers rate-limit and models get renamed. The app degrades to the rule-based parser and says so in the UI instead of breaking.

## Accomplishments that we're proud of

- A complete loop: **chat → invoice → PayPal → paid → reminder**, all working against the real PayPal sandbox.
- It understands Hinglish, the way millions of Indian freelancers actually write to clients.
- Anyone, including non-developers, can deploy it in about 5 minutes on Render, and it runs with zero keys in demo mode.
- Two PayPal payment rails (Invoicing and Orders + JS SDK), one AI agent on top of both.

## What we learned

- PayPal's Invoicing API is a powerful agent "tool": create, send, remind and status make a natural action space for an AI.
- With LLMs, the best UX is to *show the work*: listing assumptions and missing fields builds more trust than a confident black box.
- Human-in-the-loop isn't a limitation for agentic commerce. It's what makes people comfortable letting an agent near their money.

## What's next for InvoicePilot

- PayPal **webhooks** (`INVOICING.INVOICE.PAID`) for instant "you got paid" notifications, plus scheduled auto-reminders the user pre-approves.
- A **WhatsApp / Telegram bot** front-end: forward the client chat and get the PayPal link back.
- **Recurring retainers** using PayPal Subscriptions, and partial payments / deposits.
- Multi-currency insights (which clients pay late, expected cash this month) and GST-ready invoice fields for Indian freelancers.
- Packaging the tools for the **PayPal Agent Toolkit / MCP** so InvoicePilot works inside any AI assistant.

## Built with

`paypal-invoicing-api` · `paypal-orders-api` · `paypal-js-sdk` · `paypal-sandbox` · `google-gemini` · `openai-compatible-api` · `llm-tool-calling` · `node.js` · `express` · `javascript` · `html` · `css` · `render` · `docker`

## AI tools used (required list)

- **Google Gemini** (`gemini-3.8-flash`, through Gemini's OpenAI-compatible API): runtime AI for extraction, the tool-calling agent and reminder drafting. The provider is configurable (OpenAI GPT, Groq Llama, any OpenAI-compatible model).
- **Hark** (AI assistant): helped generate code, tests and documentation during development.

---

# 🎬 Demo video script (target 2:30, hard limit < 3:00)

**Before recording**
- Deploy on Render with **real PayPal sandbox keys + Gemini key**. Open the URL once so the free server is awake.
- In a second browser window (or incognito), have https://www.sandbox.paypal.com ready, signed out. You'll log in there as the **sandbox Personal** account to pay.
- Browser zoom 110%, close other tabs, turn off notifications. Use OBS Studio or Loom (free). Record at 1080p.
- Check the header shows green badges: **PayPal sandbox** and **AI: gemini**.
- **Create one unpaid invoice ahead of time** so the agent has someone to chase: click the **⚡ One-liner** chip → **Build invoice with AI** → **Send PayPal invoice** (Acme Corp, $300). New sandbox invoices can't be overdue yet, so the agent will chase this unpaid one.
- No copyrighted music. Your own voice or no music is safest.

| Time | Screen / clicks | Voice-over (say this) |
|---|---|---|
| **0:00–0:15** | App open on **✨ New invoice**. Slowly scroll the hero line. | "I'm Raja, a freelancer in India with clients abroad. Every deal I make happens in a chat, and then I waste hours turning it into invoices and chasing payments. So I built InvoicePilot: an AI billing agent on top of PayPal." |
| **0:15–0:45** | Click the **📧 Client email** chip, which fills the box. Click **✨ Build invoice with AI**. Point the cursor at the client name, email, the two line items, the due date (15th of next month) and the purple **AI · gemini** pill. | "Here's a real-style client email. One click, and the AI pulls out the client, their billing email, both line items with prices, the currency, and resolves 'the 15th of next month' into a real due date. Anything it guessed is shown right here, and I can edit everything." |
| **0:45–1:05** | Click **📨 Send PayPal invoice**. When the green card appears, click **Open**. PayPal's sandbox invoice page loads. | "Send PayPal invoice calls PayPal's Invoicing API. It creates and sends a real invoice, and this is the page my client gets, hosted by PayPal." |
| **1:05–1:20** | On the PayPal invoice page, click **Pay**, log in with the **sandbox Personal** email/password, and complete the payment. *(If it's slow, cut this in editing.)* | "Paying as the client with a PayPal sandbox account... done." |
| **1:20–1:45** | Back in the app, click the **🇮🇳 Hinglish** chip, then **✨ Build invoice with AI**. Show "3 × $150" and the note about the 50% advance in Terms. Click **🔗 Create checkout link**. Click **Open** to show the branded pay page with yellow **PayPal Smart Buttons**. Go back and point at "share this link on WhatsApp". | "It understands Hinglish too: three pages at 150 each, plus hosting, with the advance already paid accounted for. This time I make a checkout link. That's PayPal Orders API plus the PayPal JS SDK buttons, and I can share it straight to WhatsApp." |
| **1:45–2:15** | Click the **💬 Agent** tab. Click the **Who hasn't paid?** chip, and the table appears. Then type: `Remind Acme about their invoice, keep it friendly` and press Enter. A reminder card appears. Edit one word, then click **Send reminder via PayPal**, and the green tick shows. | "Now the agent. 'Who hasn't paid?' It checks live invoice status from PayPal. 'Remind Acme.' The AI writes a polite reminder that fits how close or overdue the invoice is. Nothing goes out until I approve, and PayPal sends it with the pay link." |
| **2:15–2:30** | Click **📊 Dashboard** → **↻ Refresh from PayPal**. The invoice paid at 1:20 now shows **PAID**. Point at the Paid / Outstanding / Overdue tiles. | "And the invoice my client paid a minute ago now shows as paid, straight from PayPal." |
| **2:30–2:45** | Slowly scroll the README on GitHub (MIT badge, Deploy to Render button). End on the app's logo. | "InvoicePilot: paste a chat, get paid with PayPal. It's open source, deploys to Render in one click, and even runs in demo mode with zero keys. Thanks for watching!" |

**Upload:** YouTube → Create → Upload video → Visibility **Public** → copy the link into Devpost.

**Backup plan:** if the PayPal sandbox login is slow on the day, record the 1:05–1:20 payment separately and splice it in, or skip it and show the status changing after paying in another tab. Don't claim anything on screen that didn't happen.
