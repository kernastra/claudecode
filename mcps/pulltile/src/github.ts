import { z } from "zod";
import type { GitHubAuth } from "./auth.js";

export type PrState = "open" | "closed" | "merged" | "all";

// Also the list tool's output schema, so the type and the schema can't drift.
export const pullRequestSchema = z.object({
  repo: z.string().describe("Repository, as owner/name"),
  number: z.number().int(),
  title: z.string(),
  url: z.string().describe("Pull request page on GitHub"),
  state: z.enum(["open", "draft", "merged", "closed"]),
  author: z.string().describe("GitHub login of the author"),
  avatarUrl: z.string(),
  head: z.string().describe("Source branch"),
  base: z.string().describe("Target branch"),
  changedFiles: z.number().int(),
  additions: z.number().int(),
  deletions: z.number().int(),
  checks: z
    .object({ passed: z.number().int(), failed: z.number().int(), pending: z.number().int() })
    .describe("CI check counts on the head commit"),
  summary: z.string().describe("Start of the description, up to 160 characters"),
  updatedAt: z.string().describe("ISO 8601 timestamp"),
});

export type PullRequest = z.infer<typeof pullRequestSchema>;

export type PullRequestDetails = {
  createdAt: string;
  body: string;
  labels: { name: string; color: string }[];
  files: { path: string; additions: number; deletions: number }[];
  checkRuns: { name: string; result: "passed" | "failed" | "pending"; durationSec: number | null }[];
  commits: string[];
  feedback: {
    author: string;
    avatarUrl: string;
    state: string | null;
    body: string;
    createdAt: string;
  }[];
  merge: {
    headOid: string;
    method: MergeMethod;
    // Why GitHub would refuse the merge right now; null when it can proceed.
    blockedReason: string | null;
    // Signed by the server for this exact merge (see merge-token.ts).
    token?: string;
  };
};

export type MergeMethod = "MERGE" | "SQUASH" | "REBASE";

// Repos scanned for PRs when no repo is given, most recently pushed first.
const MAX_REPOS = 30;

const PR_FIELDS = `
fragment PrFields on PullRequest {
  number title url state isDraft bodyText updatedAt
  headRefOid mergeable mergeStateStatus
  headRefName baseRefName changedFiles additions deletions
  author { login avatarUrl }
  repository { nameWithOwner viewerDefaultMergeMethod }
  createdAt
  labels(first: 6) { nodes { name color } }
  files(first: 5) { nodes { path additions deletions } }
  head: commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 20) {
    checkRunCountsByState { state count }
    statusContextCountsByState { state count }
    nodes {
      __typename
      ... on CheckRun { name status conclusion startedAt completedAt }
      ... on StatusContext { context state }
    }
  } } } } }
  recent: commits(last: 6) { nodes { commit { messageHeadline } } }
  reviews(last: 3) { nodes { author { login avatarUrl } state bodyText submittedAt } }
  comments(last: 5) { nodes { author { __typename login avatarUrl } bodyText createdAt } }
}`;

type CountByState = { state: string; count: number };

type PrNode = {
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  bodyText: string;
  updatedAt: string;
  headRefName: string;
  baseRefName: string;
  changedFiles: number;
  additions: number;
  deletions: number;
  author: { login: string; avatarUrl: string } | null;
  headRefOid: string;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  mergeStateStatus: string;
  repository: { nameWithOwner: string; viewerDefaultMergeMethod: MergeMethod };
  createdAt: string;
  labels: { nodes: { name: string; color: string }[] };
  files: { nodes: { path: string; additions: number; deletions: number }[] } | null;
  head: {
    nodes: {
      commit: {
        statusCheckRollup: {
          contexts: {
            checkRunCountsByState: CountByState[] | null;
            statusContextCountsByState: CountByState[] | null;
            nodes: (
              | {
                  __typename: "CheckRun";
                  name: string;
                  status: string;
                  conclusion: string | null;
                  startedAt: string | null;
                  completedAt: string | null;
                }
              | { __typename: "StatusContext"; context: string; state: string }
            )[];
          };
        } | null;
      };
    }[];
  };
  recent: { nodes: { commit: { messageHeadline: string } }[] };
  reviews: {
    nodes: {
      author: { login: string; avatarUrl: string } | null;
      state: string;
      bodyText: string;
      submittedAt: string | null;
    }[];
  };
  comments: {
    nodes: {
      author: { __typename: string; login: string; avatarUrl: string } | null;
      bodyText: string;
      createdAt: string;
    }[];
  };
};

const HEADERS = {
  "User-Agent": "pulltile",
  "X-GitHub-Api-Version": "2022-11-28",
};

// `partial` keeps whatever data came back when some aliased fields fail (e.g.
// one repo in a batch was deleted); otherwise any error throws.
async function graphql<T>(
  token: string,
  query: string,
  variables: object = {},
  partial = false,
): Promise<T> {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { ...HEADERS, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (!res.ok || !json.data || (!partial && json.errors?.length)) {
    const detail = json.errors?.map((e) => e.message).join("; ") ?? res.statusText;
    throw new Error(`GitHub API error (${res.status}): ${detail}`);
  }
  return json.data;
}

async function rest<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { ...HEADERS, Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub API error (${res.status}) on ${path}`);
  return (await res.json()) as T;
}

type Repo = { name: string; pushedAt: string };

// App mode: only repos the user installed the GitHub App on. Personal mode:
// repos the `gh` user owns.
async function listRepos(auth: GitHubAuth): Promise<Repo[]> {
  const repos: Repo[] = [];

  if (auth.mode === "app") {
    type RestRepo = { full_name: string; pushed_at: string | null; archived: boolean };
    const { installations } = await rest<{ installations: { id: number }[] }>(
      auth.token,
      "/user/installations?per_page=100",
    );
    for (const { id } of installations) {
      for (let page = 1; page <= 5; page++) {
        const { repositories } = await rest<{ repositories: RestRepo[] }>(
          auth.token,
          `/user/installations/${id}/repositories?per_page=100&page=${page}`,
        );
        for (const r of repositories) {
          if (!r.archived) repos.push({ name: r.full_name, pushedAt: r.pushed_at ?? "" });
        }
        if (repositories.length < 100) break;
      }
    }
  } else {
    const data = await graphql<{
      viewer: {
        repositories: { nodes: { nameWithOwner: string; pushedAt: string | null; isArchived: boolean }[] };
      };
    }>(
      auth.token,
      `query { viewer { repositories(first: 100, ownerAffiliations: [OWNER], orderBy: { field: PUSHED_AT, direction: DESC }) {
        nodes { nameWithOwner pushedAt isArchived }
      } } }`,
    );
    for (const r of data.viewer.repositories.nodes) {
      if (!r.isArchived) repos.push({ name: r.nameWithOwner, pushedAt: r.pushedAt ?? "" });
    }
  }

  return repos.sort((a, b) => b.pushedAt.localeCompare(a.pushedAt));
}

const PASSED = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const FAILED = new Set([
  "FAILURE",
  "ERROR",
  "CANCELLED",
  "TIMED_OUT",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
]);

function tallyChecks(counts: CountByState[]) {
  const checks = { passed: 0, failed: 0, pending: 0 };
  for (const { state, count } of counts) {
    if (PASSED.has(state)) checks.passed += count;
    else if (FAILED.has(state)) checks.failed += count;
    else checks.pending += count;
  }
  return checks;
}

function summarize(body: string, max = 160): string {
  const text = body.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3).trimEnd()}...` : text;
}

const BLOCKED_REASON: Record<string, string> = {
  BLOCKED: "Blocked by branch protection",
  BEHIND: "Branch is behind its base",
  DIRTY: "Has merge conflicts",
  DRAFT: "Draft pull requests can't be merged",
};

function mergeBlockedReason(n: {
  state: string;
  mergeable: string;
  mergeStateStatus: string;
}): string | null {
  if (n.state !== "OPEN") return "Pull request is not open";
  if (n.mergeable === "CONFLICTING") return "Has merge conflicts";
  return BLOCKED_REASON[n.mergeStateStatus] ?? null;
}

function checkResult(state: string): "passed" | "failed" | "pending" {
  if (PASSED.has(state)) return "passed";
  if (FAILED.has(state)) return "failed";
  return "pending";
}

function toResult(n: PrNode): { pullRequest: PullRequest; details: PullRequestDetails } {
  const contexts = n.head.nodes[0]?.commit.statusCheckRollup?.contexts;
  const pullRequest: PullRequest = {
    repo: n.repository.nameWithOwner,
    number: n.number,
    title: n.title,
    url: n.url,
    state:
      n.state === "MERGED"
        ? "merged"
        : n.state === "CLOSED"
          ? "closed"
          : n.isDraft
            ? "draft"
            : "open",
    author: n.author?.login ?? "ghost",
    avatarUrl: n.author?.avatarUrl ?? "",
    head: n.headRefName,
    base: n.baseRefName,
    changedFiles: n.changedFiles,
    additions: n.additions,
    deletions: n.deletions,
    checks: tallyChecks([
      ...(contexts?.checkRunCountsByState ?? []),
      ...(contexts?.statusContextCountsByState ?? []),
    ]),
    summary: summarize(n.bodyText),
    updatedAt: n.updatedAt,
  };

  const checkRuns = (contexts?.nodes ?? []).map((c) => {
    if (c.__typename === "StatusContext") {
      return { name: c.context, result: checkResult(c.state), durationSec: null };
    }
    const done = c.status === "COMPLETED";
    return {
      name: c.name,
      result: done ? checkResult(c.conclusion ?? "") : ("pending" as const),
      durationSec:
        done && c.startedAt && c.completedAt
          ? Math.round((Date.parse(c.completedAt) - Date.parse(c.startedAt)) / 1000)
          : null,
    };
  });

  // Bot issue comments are mostly deploy tables; bot reviews (e.g.
  // CodeRabbit) are real feedback, so only the former are dropped.
  const feedback = [
    ...n.reviews.nodes
      .filter((r) => r.bodyText.trim() || r.state !== "COMMENTED")
      .map((r) => ({
        author: r.author?.login ?? "ghost",
        avatarUrl: r.author?.avatarUrl ?? "",
        state: r.state,
        body: summarize(r.bodyText, 280),
        createdAt: r.submittedAt ?? n.updatedAt,
      })),
    ...n.comments.nodes
      .filter((c) => c.author?.__typename !== "Bot" && c.bodyText.trim())
      .map((c) => ({
        author: c.author?.login ?? "ghost",
        avatarUrl: c.author?.avatarUrl ?? "",
        state: null,
        body: summarize(c.bodyText, 280),
        createdAt: c.createdAt,
      })),
  ]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 2);

  const details: PullRequestDetails = {
    createdAt: n.createdAt,
    merge: {
      headOid: n.headRefOid,
      method: n.repository.viewerDefaultMergeMethod,
      blockedReason: mergeBlockedReason(n),
    },
    body: summarize(n.bodyText, 420),
    labels: n.labels.nodes,
    files: n.files?.nodes ?? [],
    checkRuns,
    commits: n.recent.nodes
      .map((c) => c.commit.messageHeadline)
      .filter((h) => !h.startsWith("Merge "))
      .reverse(),
    feedback,
  };
  return { pullRequest, details };
}

const STATES: Record<PrState, string[] | null> = {
  open: ["OPEN"],
  closed: ["CLOSED"],
  merged: ["MERGED"],
  all: null,
};

function splitRepo(name: string): [string, string] {
  const [owner, repo] = name.split("/");
  return [owner, repo];
}

export class RepoNotAccessibleError extends Error {}

// Two passes: a cheap scan of each repo's most recently updated PRs, then full
// card data for only the overall top `limit`.
export async function listPullRequests(opts: {
  auth: GitHubAuth;
  repo?: string;
  state: PrState;
  limit: number;
}): Promise<{ results: { pullRequest: PullRequest; details: PullRequestDetails }[]; repoCount: number }> {
  let repos: string[];
  if (opts.repo) {
    if (opts.auth.mode === "app") {
      const accessible = await listRepos(opts.auth);
      if (!accessible.some((r) => r.name.toLowerCase() === opts.repo!.toLowerCase())) {
        throw new RepoNotAccessibleError(
          `The GitHub App isn't installed on ${opts.repo}, or you don't have access to it.`,
        );
      }
    }
    repos = [opts.repo];
  } else {
    repos = (await listRepos(opts.auth)).slice(0, MAX_REPOS).map((r) => r.name);
  }
  if (repos.length === 0) return { results: [], repoCount: 0 };

  const scanVars: Record<string, unknown> = { first: opts.limit, states: STATES[opts.state] };
  const scanDecls: string[] = [];
  const scanFields = repos.map((name, i) => {
    [scanVars[`o${i}`], scanVars[`n${i}`]] = splitRepo(name);
    scanDecls.push(`$o${i}: String!, $n${i}: String!`);
    return `r${i}: repository(owner: $o${i}, name: $n${i}) {
      pullRequests(first: $first, states: $states, orderBy: { field: UPDATED_AT, direction: DESC }) {
        nodes { number updatedAt }
      }
    }`;
  });
  const scan = await graphql<Record<string, { pullRequests: { nodes: { number: number; updatedAt: string }[] } } | null>>(
    opts.auth.token,
    `query($first: Int!, $states: [PullRequestState!], ${scanDecls.join(", ")}) { ${scanFields.join("\n")} }`,
    scanVars,
    true,
  );

  if (opts.repo && !scan.r0) {
    throw new RepoNotAccessibleError(`${opts.repo} doesn't exist or you don't have access to it.`);
  }

  const top = repos
    .flatMap((name, i) =>
      (scan[`r${i}`]?.pullRequests.nodes ?? []).map((pr) => ({ name, ...pr })),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, opts.limit);
  if (top.length === 0) return { results: [], repoCount: repos.length };

  const detailVars: Record<string, unknown> = {};
  const detailDecls: string[] = [];
  const detailFields = top.map((pr, i) => {
    [detailVars[`o${i}`], detailVars[`n${i}`]] = splitRepo(pr.name);
    detailVars[`x${i}`] = pr.number;
    detailDecls.push(`$o${i}: String!, $n${i}: String!, $x${i}: Int!`);
    return `p${i}: repository(owner: $o${i}, name: $n${i}) { pullRequest(number: $x${i}) { ...PrFields } }`;
  });
  const detail = await graphql<Record<string, { pullRequest: PrNode | null } | null>>(
    opts.auth.token,
    `query(${detailDecls.join(", ")}) { ${detailFields.join("\n")} }\n${PR_FIELDS}`,
    detailVars,
    true,
  );

  const results = top
    .map((_, i) => detail[`p${i}`]?.pullRequest)
    .filter((n): n is PrNode => !!n)
    .map(toResult);
  return { results, repoCount: repos.length };
}

const PR_ID_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { id state baseRefName }
  }
}`;

const MERGE_MUTATION = `
mutation($id: ID!, $oid: GitObjectID!, $method: PullRequestMergeMethod!) {
  mergePullRequest(input: { pullRequestId: $id, expectedHeadOid: $oid, mergeMethod: $method }) {
    pullRequest { state mergedAt mergeCommit { oid } }
  }
}`;

// Merges exactly what the user confirmed: the same base branch and method,
// and only if the head is still the commit they saw. GitHub enforces branch
// protection, and the caller's own token means it also enforces write access.
export async function mergePullRequest(opts: {
  auth: GitHubAuth;
  repo: string;
  number: number;
  expectedHeadOid: string;
  expectedBase: string;
  method: MergeMethod;
}): Promise<{ merged: boolean; method: MergeMethod; mergeCommit: string | null }> {
  const [owner, name] = splitRepo(opts.repo);
  const { repository } = await graphql<{
    repository: {
      pullRequest: { id: string; state: string; baseRefName: string } | null;
    } | null;
  }>(opts.auth.token, PR_ID_QUERY, { owner, name, number: opts.number });

  const pr = repository?.pullRequest;
  if (!repository || !pr) throw new Error(`${opts.repo}#${opts.number} not found.`);
  if (pr.state !== "OPEN") throw new Error(`${opts.repo}#${opts.number} is not open.`);
  if (pr.baseRefName !== opts.expectedBase) {
    throw new Error(
      `${opts.repo}#${opts.number} now targets ${pr.baseRefName}, not ${opts.expectedBase}. Reload the card and confirm again.`,
    );
  }

  const { method } = opts;
  const { mergePullRequest } = await graphql<{
    mergePullRequest: {
      pullRequest: { state: string; mergeCommit: { oid: string } | null };
    };
  }>(opts.auth.token, MERGE_MUTATION, { id: pr.id, oid: opts.expectedHeadOid, method });

  return {
    merged: mergePullRequest.pullRequest.state === "MERGED",
    method,
    mergeCommit: mergePullRequest.pullRequest.mergeCommit?.oid ?? null,
  };
}
