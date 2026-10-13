import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createClerkClient } from "@clerk/backend";

const execFileAsync = promisify(execFile);

// Local dev reads ./.env; deployed environments set real env vars instead.
try {
  process.loadEnvFile();
} catch {}

// With CLERK_FRONTEND_API set, every MCP request carries a Clerk access token
// and each user's GitHub App token is read from their Clerk account. Running
// single-user on the local `gh` login is an explicit opt-in, so a missing
// Clerk config fails closed instead of serving one token to every caller.
export const clerkDomain = process.env.CLERK_FRONTEND_API;
const singleUser = !clerkDomain && process.env.SKYBRIDGE_SINGLE_USER === "1";

if (!clerkDomain && !singleUser) {
  throw new Error(
    "Set CLERK_FRONTEND_API and CLERK_SECRET_KEY for multi-user mode, or SKYBRIDGE_SINGLE_USER=1 for local single-user dev on your `gh` login.",
  );
}
if (singleUser && process.env.NODE_ENV === "production") {
  throw new Error("SKYBRIDGE_SINGLE_USER is for local dev only; configure Clerk in production.");
}

const clerk = clerkDomain
  ? createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  : undefined;

export type GitHubAuth = {
  token: string;
  // Who the token belongs to: the Clerk user id, or "local" in single-user mode.
  user: string;
  // "app": a GitHub App user token, limited to repos the app is installed on.
  // "personal": the local `gh` login, for single-user dev.
  mode: "app" | "personal";
};

export class GitHubNotConnectedError extends Error {}

let personalToken: Promise<string> | undefined;

function getPersonalToken(): Promise<string> {
  personalToken ??= (async () => {
    if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
    try {
      const { stdout } = await execFileAsync("gh", ["auth", "token"]);
      return stdout.trim();
    } catch {
      throw new Error("No GitHub token: set GITHUB_TOKEN or run `gh auth login`.");
    }
  })();
  personalToken.catch(() => {
    personalToken = undefined;
  });
  return personalToken;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Single-user mode acts as the machine owner, so it only answers requests made
// on this machine. Tunnels and proxies add forwarding headers or a public Host.
function isLocalRequest(req: Request | undefined): boolean {
  if (!req) return true; // stdio / in-process
  const h = req.headers;
  if (h.get("forwarded") || h.get("x-forwarded-for") || h.get("x-forwarded-host")) return false;
  const host = h.get("host");
  if (!host) return false;
  return LOCAL_HOSTS.has(new URL(`http://${host}`).hostname);
}

export async function githubAuthFor(
  authInfo: { clientId?: string; extra?: { subject?: string } } | undefined,
  req: Request | undefined,
): Promise<GitHubAuth> {
  if (!clerk) {
    if (!isLocalRequest(req)) {
      throw new GitHubNotConnectedError(
        "This app isn't available to remote clients yet. Try again once sign-in is set up.",
      );
    }
    return { token: await getPersonalToken(), user: "local", mode: "personal" };
  }

  const clerkUserId = authInfo?.extra?.subject;
  if (!clerkUserId) throw new GitHubNotConnectedError("Sign in to continue.");
  // Skybridge checks only issuer + signature, so Clerk session tokens would
  // also pass. OAuth access tokens issued to an MCP client carry client_id.
  if (!authInfo.clientId) {
    throw new GitHubNotConnectedError("Only OAuth access tokens issued to an MCP client are accepted.");
  }

  const { data } = await clerk.users.getUserOauthAccessToken(clerkUserId, "github");
  const token = data[0]?.token;
  if (!token) {
    throw new GitHubNotConnectedError(
      "Your account has no GitHub connection. Sign in with GitHub to load your pull requests.",
    );
  }
  return { token, user: clerkUserId, mode: "app" };
}
