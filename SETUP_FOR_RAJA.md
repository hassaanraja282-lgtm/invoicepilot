# Setup checklist for Raja (no coding needed)

Deadline: **Thu Nov 12, 2026, 12:00 PM Pacific = 20:00 UTC = Fri Nov 13, 01:30 AM IST.** Plan to submit by **Nov 11 evening IST**.

Every account below is **free**. You don't need a credit card anywhere. If any site asks for one, stop: you're on the wrong plan.

| # | Account | Why | Time |
|---|---|---|---|
| 1 | **GitHub** (github.com) | Public code repo (required) | 5 min |
| 2 | **PayPal Developer** (developer.paypal.com) | Sandbox API keys (required) | 15 min |
| 3 | **Google AI Studio** (aistudio.google.com) | Free Gemini AI key | 3 min |
| 4 | **Render** (render.com) | Free hosting + live demo URL (also qualifies for the Render sponsor prize) | 10 min |
| 5 | **YouTube** (your Google account) | Public demo video (required) | 5 min |
| 6 | **Devpost** (devpost.com) | Register for the hackathon and submit | 10 min |

---

## 1) GitHub: put the code online
1. Sign up at https://github.com/signup (free).
2. Click **+** (top right) → **New repository**. Name it `invoicepilot`, choose **Public**, and don't tick "Add a README" (we already have one). Click **Create repository**.
3. On the empty repo page, click **uploading an existing file**. Unzip `invoicepilot.zip` on your computer, then drag **everything inside the `invoicepilot` folder** into the browser. Include the `public`, `src` and `test` folders and the hidden-looking files like `.gitignore`. If your file browser hides dot-files, it's fine to skip them. Click **Commit changes**.
4. On the repo home page, click the ⚙️ next to **About** and add a description: *AI billing agent: paste a client chat, get paid with PayPal.* GitHub detects the **MIT License** from the `LICENSE` file and shows it in About automatically (the rules require this).
5. Edit `README.md` (pencil icon): replace `hassaanraja282-lgtm` with your GitHub username in the Deploy-to-Render link, then commit.

## 2) PayPal Developer: sandbox keys
1. Go to https://developer.paypal.com and click **Log in to Dashboard**. Use your normal PayPal account or sign up free. Sandbox never moves real money.
2. **Important for India:** your default sandbox test accounts may be created as India accounts, and PayPal doesn't support India-to-India payments. Create two US test accounts:
   - Left menu → **Testing Tools → Sandbox Accounts → Create account** → **Business (Merchant)**, Country/Region **United States** → Create. This is *you*, the freelancer.
   - **Create account** again → **Personal (Buyer)**, Country/Region **United States** → Create. This is *your test client*.
   - For each one, click **⋯ → View/Edit account** and write down the **email** and **password** (System Generated Password).
3. Left menu → **Apps & Credentials**. Check that the toggle at the top says **Sandbox**. Click **Create App**, name it `InvoicePilot`, type **Merchant**, and pick your **US Business** sandbox account. Click **Create App**.
4. Copy the **Client ID** and the **Secret** (click "Show"). These are your `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`. Keep the secret private: never paste it into GitHub, chat, or the README.
5. On the app page, scroll to the features list and make sure **Invoicing** is ticked (it usually is by default). Save if you changed anything.

## 3) Google AI Studio: free Gemini key
1. Go to https://aistudio.google.com/apikey and sign in with Google.
2. Click **Create API key** (pick or create any project) and copy it. This is your `GEMINI_API_KEY`.
3. Don't turn on billing. The free tier is enough for the demo.

## 4) Render: deploy the live app
1. Sign up at https://render.com with **"Sign up with GitHub"**.
2. Click **New +** → **Blueprint** → connect your GitHub → pick the `invoicepilot` repo.
3. Render reads `render.yaml` and asks for values:
   - `PAYPAL_CLIENT_ID` → paste from step 2
   - `PAYPAL_CLIENT_SECRET` → paste from step 2
   - `GEMINI_API_KEY` → paste from step 3
   - `OPENAI_API_KEY` → **leave blank**
4. Click **Apply** and wait about 2 to 3 minutes. Open the URL Render gives you (like `https://invoicepilot-xxxx.onrender.com`).
5. Check the top-right badges: **PayPal sandbox** and **AI: gemini** should have green dots. Yellow "demo" means a key is missing or mistyped. Fix it in Render → your service → **Environment** → **Save changes**.
6. Optional: set `BUSINESS_NAME` in Environment to your studio name. It shows on invoices.

> The free plan sleeps after 15 minutes idle. Open the URL about a minute before recording or judging so it's awake.

## 5) Quick test (5 min)
1. **New invoice** → **📧 Client email** chip → **✨ Build invoice with AI** → **📨 Send PayPal invoice** → **Open**.
2. On PayPal's page, pay using your **US Personal sandbox** email and password.
3. Back in the app → **📊 Dashboard** → **↻ Refresh from PayPal**. The invoice should show **PAID**.
4. Try **🔗 Create checkout link** → **Open** → pay with the same sandbox Personal account. The status becomes **COMPLETED**.
5. **💬 Agent** → "Who hasn't paid?".

If something shows a red error, copy the full message. It includes PayPal's reason and a `debug_id`.

## 6) Record and upload the video
- Follow the click-by-click script in `SUBMISSION.md` and keep it **under 3 minutes**.
- Free recorders: **OBS Studio** (obsproject.com) or **Loom** (loom.com).
- Upload to YouTube → visibility **Public** → copy the link.

## 7) Submit on Devpost
1. Go to https://paypalaihackathon.devpost.com → **Join hackathon** (if you haven't yet) → **Enter a submission**.
2. Paste the sections from `SUBMISSION.md` (Inspiration, What it does, etc.).
3. Add the **GitHub repo URL**, the **Render URL** and the **YouTube URL**.
4. In the testing instructions, add: *"Live demo: <Render URL>. To pay a test invoice, log in on the PayPal sandbox page with: <US Personal sandbox email> / <password>."* (That is a sandbox test login, not your real PayPal.)
5. Add screenshots: the draft card, the PayPal invoice page, the agent chat, the dashboard.
6. Click **Submit**, and check it says *Submitted*, not *Draft*.

## Keys summary
| Variable | Where it comes from | Required? |
|---|---|---|
| `PAYPAL_CLIENT_ID` | PayPal Developer → Apps & Credentials (Sandbox) | Yes, for real PayPal |
| `PAYPAL_CLIENT_SECRET` | same place, "Show" | Yes, for real PayPal |
| `GEMINI_API_KEY` | aistudio.google.com/apikey | Yes, for real AI (free) |
| `BUSINESS_NAME` | your choice | Optional |
| `APP_PASSWORD` | your choice | Optional. If you set it, add it to the Devpost testing instructions. |

Never commit `.env` or paste keys into GitHub. Keys only go into Render → Environment.
