# Pulltile

## Value Proposition
Any user connects their GitHub and browses and acts on pull requests from the repos they choose, as cards inside ChatGPT or Claude. Pain: checking PR status means opening GitHub tab by tab.

**Core actions**: List PRs (all repos or one), review a PR on GitHub or hand it to ChatGPT, merge it into its base.

## Why LLM?
**Conversational win**: "What's open on my-app?" or "show merged PRs this week" in one sentence.
**LLM adds**: Picks the repo and state filter from intent; reviews a PR on request.
**What LLM lacks**: Live GitHub data.

## UI Overview
**Collapsed card** (four left-aligned rows; `src/assets/pr-card-bg.jpg` covers the right 40% and fades into the solid background):
1. GitHub mark | PULL REQUEST #n, state badge
2. Title, wrapping at 60% of the card width
3. head → base, author | checks | files changed
**Expanded (chevron)**: the header stays as is; the dropdown adds the repo name (links to the repo), Summary (full description + labels), CI checks, Changed files (top 5 + link), Key changes (recent commit headlines + link), Review feedback (latest 2 reviews/human comments); then Review in GitHub, Merge into {base}, Ask ChatGPT to review.
**Merge**: two clicks (Merge into {base} → Confirm {method} merge / Cancel). Disabled with the reason when GitHub would refuse (conflicts, branch protection, behind base, draft). On success the badge turns Merged.

## Product Context
- **API**: GitHub GraphQL; two queries per list call (scan each connected repo's recent PRs, then full card data for the top `limit`)
- **Auth (multi-user)**: Clerk is the OAuth server that ChatGPT and Claude register with (Dynamic Client Registration, JWT access tokens), verified by Skybridge's `clerkProvider`. Users sign in with GitHub through a **GitHub App**; each request reads that user's GitHub token from Clerk (`users.getUserOauthAccessToken(sub, "github")`), so GitHub enforces their own access and merge rights. No database.
- **Verified 2026-10-13** (first sign-in): Clerk accepts GitHub App credentials; Clerk OAuth JWTs carry `client_id`, `sub`, `scope` (no `aud`); DCR works. Dynamic clients only get Clerk's "default scopes for dynamic clients" (`email profile offline_access`), so `clerkProvider` advertises exactly those; requesting `openid` fails with `invalid_scope`. Clerk's Cloudflare front blocks Python's default urllib user agent (error 1010).
- **Why Clerk** (decided 2026-10-13): considered running the server as its own OAuth proxy to GitHub (FastMCP / Cloudflare pattern), which needs non-Alpic hosting since Alpic only routes `/mcp`, plus owned OAuth code. Chose Clerk to stay on Alpic with no auth code to maintain.
- **Repo scope**: only repos the user installed the GitHub App on (`/user/installations`), capped at the 30 most recently pushed. The empty state (no connected repos) links to `github.com/apps/<slug>/installations/new`; afterwards users change repos in GitHub's app settings, and `installUrl` stays in the tool output so the model can share the link on request.
- **Token check**: Skybridge verifies Clerk issuer + signature only; the server also requires `client_id` on the token (OAuth access tokens issued to an MCP client), so Clerk session JWTs are rejected. Use a Clerk instance dedicated to this app, since tokens from any OAuth client on the instance pass.
- **Local dev**: single-user on the `gh` login only with `SKYBRIDGE_SINGLE_USER=1` (refused when `NODE_ENV=production`). With neither Clerk nor the opt-in, the server refuses to start. Never tunnel single-user mode.
- **Env**: see `.env.example` (`CLERK_FRONTEND_API`, `CLERK_SECRET_KEY`, `GITHUB_APP_SLUG`, optional `MERGE_TOKEN_SECRET`, dev-only `SKYBRIDGE_SINGLE_USER`).

## Setup (one-time, in dashboards)
1. **GitHub App** (github.com/settings/apps/new):
   - Callback URL: Clerk's GitHub callback URL (Clerk Dashboard → SSO connections → GitHub → Use custom credentials).
   - Turn **off** "Expire user authorization tokens" (Clerk refreshing GitHub App tokens is unverified). Tradeoff: tokens then never expire, so a leaked `CLERK_SECRET_KEY` exposes write access to every user's installed repos until revoked. Revisit once refresh is confirmed.
   - Webhook: inactive.
   - Repository permissions: Pull requests R/W, Contents R/W (merge), Checks R, Commit statuses R, Metadata R.
   - Account permissions: Email addresses R (Clerk reads the email).
   - Installable by any account; note the slug, client ID and secret.
2. **Clerk** (a dedicated instance): enable GitHub sign-in with custom credentials (the GitHub App client ID/secret); make GitHub the only sign-in method; Configure → OAuth Applications: enable Dynamic Client Registration and JWT access tokens, and confirm the consent screen is shown to users for dynamically registered clients (anyone can register one).
3. **Deploy** (Alpic) with the env vars set, then add `https://<host>/mcp` as a connector in ChatGPT and Claude.

## Tools and Views

**View: list-pull-requests**
- **Input**: `{ repo?: "owner/name", state: open|closed|merged|all = open, limit: 1-20 = 5 }`
- **Output**: `{ pullRequests[], installUrl? }` (lean, for the model); `_meta.details[url]` holds expanded-card data for the view only. No connected repos → empty card with a Choose repositories button.
- **Behavior**: no `repo` scans the caller's connected repos; a `repo` the caller can't access returns an error. Dropdown state is local to the view.

**Tool: merge-pull-request** (`destructiveHint: true`; `ui.visibility: ["app"]` hides it from the model where hosts honor it)
- **Input**: `{ repo, number, expectedHeadOid, expectedBase, method, mergeToken }`
- **Confirmation token**: the list tool signs (user, repo, number, head, base, method) with an HMAC, 30-minute expiry, and puts it in `_meta` (view-only). The merge tool refuses without a matching token, so a prompt-injected model can't merge.
- **Output**: `{ merged, method, mergeCommit }`
- **Behavior**: runs as the signed-in user's GitHub token, re-reads the PR server-side, refuses if its base branch changed, merges with the confirmed method, and passes `expectedHeadOid` so GitHub refuses if the branch moved after the card loaded. Branch protection is enforced by GitHub.
