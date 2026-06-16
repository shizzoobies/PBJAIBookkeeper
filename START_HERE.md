# START HERE

This repo builds the **AI Bookkeeper (test build)**. The full build spec is in `CLAUDE.md`. This file is the front door: it gets you set up before any code is written.

You do not need to do anything now. When you are ready, open this folder in Claude Code and paste the kickoff prompt below. Claude Code will check your machine, walk you through the accounts and keys you need one at a time, and will not start building until everything is confirmed.

---

## Kickoff prompt (paste this into Claude Code when ready)

```
Read START_HERE.md and CLAUDE.md in this repo. Do not write any code yet.
Run the First-Session Protocol from START_HERE.md with me, step by step:
check my local tooling, then walk me through each account and key I need,
confirming each item before moving to the next. Only after every item on the
Prerequisites Checklist is confirmed, ask me whether to begin Phase 0.
```

---

## Prerequisites Checklist (what you will end up needing)

Nothing here costs money for the test. Cloudflare free tier, the Intuit sandbox, and a GitHub repo are all free; the only thing that needs funds is a small balance on an Anthropic API key for categorization (pennies during testing).

**Accounts**
- [ ] Intuit Developer account (developer.intuit.com) with an app on the QuickBooks Online Accounting API, and its **sandbox** Client ID + Secret
- [ ] Cloudflare account
- [ ] GitHub account and an empty repo for this project
- [ ] Anthropic API key with a small credit balance (console.anthropic.com). This is separate from your Claude subscription.

**Local tools**
- [ ] Node.js LTS (v20+) and npm
- [ ] Wrangler CLI (`npm i -g wrangler`, then `wrangler login`)
- [ ] Git
- [ ] Claude Code (you already have this)

**Keys and values you will gather along the way**
- [ ] QBO sandbox Client ID and Client Secret
- [ ] QBO redirect URI (set after first deploy: `https://<your-worker>.workers.dev/oauth/callback`)
- [ ] `TOKEN_ENC_KEY` (generate with `openssl rand -base64 32`)
- [ ] `ANTHROPIC_API_KEY`
- [ ] QBO webhook verifier token (later, not needed for first run)

**One decision to make**
- [ ] Who owns the Intuit app. Your own account is fine for the test. For production it should belong to the firm, since the client connections and billing terms attach to the owner.

---

## First-Session Protocol (Claude Code follows this)

> Claude Code: run these steps interactively with the user. Do not write application code until Step 7 is reached and the user says go. Confirm each item before advancing. Be plain and concrete; give exact commands and wait for results.

**Step 1 — Set expectations.** Confirm you are in setup mode, not build mode, and that nothing will be built until prerequisites are green. Briefly state the five things this session sets up: local tools, accounts, Cloudflare resources, secrets, and the redirect URI loop.

**Step 2 — Check local tooling.** Run and report results, with install guidance for anything missing:
- `node --version` (need v20+)
- `npm --version`
- `git --version`
- `wrangler --version` (if missing: `npm i -g wrangler`)
- Confirm `wrangler whoami` shows a logged-in Cloudflare account (if not: `wrangler login`).
Summarize what is present and what the user must install, then wait.

**Step 3 — Accounts walkthrough.** Take these one at a time, confirming each before moving on:
1. **Intuit:** Direct the user to create a developer account and an app on the QuickBooks Online Accounting API, then copy the **sandbox** Client ID and Secret. Confirm they have both in hand (do not ask them to paste secrets into chat; they will set them via wrangler later). Confirm a sandbox company exists under Sandboxes.
2. **GitHub:** Confirm an empty repo exists and this folder is connected to it (`git remote -v`). If not, help initialize and push.
3. **Anthropic:** Confirm an API key with a small credit balance exists at console.anthropic.com. Remind them it is separate from their Claude subscription.
4. **Ownership decision:** Ask who owns the Intuit app for now and note it. Personal is fine for the test.

**Step 4 — Create Cloudflare resources.** Have the user run each, then paste the returned binding/ID so you can write it into `wrangler.toml`:
- `wrangler d1 create ai-bookkeeper`
- `wrangler kv namespace create COA_CACHE`
- `wrangler queues create bookkeeper-jobs`
Write the bindings into `wrangler.toml` as you receive them. Do not invent IDs; use exactly what the commands return.

**Step 5 — Prepare secrets (set, do not print).** Walk the user through generating and setting each. Use `wrangler secret put <NAME>` so values never touch the repo or the chat:
- `TOKEN_ENC_KEY` (generate first: `openssl rand -base64 32`)
- `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`
- `ANTHROPIC_API_KEY`
Note that `QBO_REDIRECT_URI` and `QBO_WEBHOOK_VERIFIER` are set in Step 6 and later, respectively.

**Step 6 — Redirect URI loop.** Explain the chicken-and-egg: the Worker must deploy once to get its `*.workers.dev` URL, then that URL goes into both the Intuit app's redirect URI setting and the `QBO_REDIRECT_URI` secret. Flag that this happens right after the Phase 0 skeleton deploys, so the user expects it.

**Step 7 — Green-light check.** Re-read the Prerequisites Checklist with the user and confirm every item. List anything still outstanding. Only when all are confirmed, ask: "Ready to start Phase 0 (OAuth + token rotation + D1 schema)?" Begin building only on an explicit yes.

---

## What happens after setup

Once you green-light it, Claude Code builds against the phases and acceptance gates in `CLAUDE.md`: Phase 0 (foundation) first, proven by a sandbox connection that refreshes its own token, then Phase 1 (read, classify, reconcile prep, dashboard). The test stays on the QuickBooks **sandbox** the whole way. No real client data, no production keys, until the loop is proven.
