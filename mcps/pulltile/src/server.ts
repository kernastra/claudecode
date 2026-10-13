import { clerkProvider, Skybridge } from "skybridge/server";
import { z } from "zod";
import { clerkDomain, githubAuthFor } from "./auth.js";
import { listPullRequests, mergePullRequest, pullRequestSchema } from "./github.js";
import { signMergeIntent, verifyMergeIntent } from "./merge-token.js";

// Where users pick which repos the GitHub App (and so the card) can see.
const installUrl = process.env.GITHUB_APP_SLUG
  ? `https://github.com/apps/${process.env.GITHUB_APP_SLUG}/installations/new`
  : undefined;

export const app = new Skybridge({
  name: "pulltile",
  version: "0.0.1",
  // Every /mcp request must carry a Clerk access token when Clerk is
  // configured; without it the server is single-user local dev (see auth.ts).
  // Clerk only grants dynamically registered (DCR/CIMD) clients its "default
  // scopes for dynamic clients", so advertise exactly those; asking for more
  // (e.g. openid) fails with invalid_scope.
  ...(clerkDomain
    ? { oauth: clerkProvider({ domain: clerkDomain, scopes: ["email", "profile", "offline_access"] }) }
    : {}),
  handler: (server) =>
    server.registerTool(
      {
        name: "list-pull-requests",
        description:
          "List GitHub pull requests from the user's repositories, most recently updated first. Omit `repo` to scan every repository the user connected.",
        inputSchema: {
          repo: z
            .string()
            .regex(/^[\w.-]+\/[\w.-]+$/, "Use owner/name")
            .optional()
            .describe("Limit to one repository, as owner/name"),
          state: z
            .enum(["open", "closed", "merged", "all"])
            .default("open")
            .describe("PR state filter"),
          limit: z
            .number()
            .int()
            .min(1)
            .max(20)
            .default(5)
            .describe("Maximum number of pull requests to return"),
        },
        outputSchema: {
          pullRequests: z.array(pullRequestSchema).describe("Most recently updated first"),
          installUrl: z
            .string()
            .optional()
            .describe("Where the user picks which repositories the app can see"),
        },
        annotations: {
          readOnlyHint: true,
          openWorldHint: false,
          destructiveHint: false,
        },
        view: {
          component: "list-pull-requests",
          description: "Pull request cards",
          csp: {
            resourceDomains: ["https://avatars.githubusercontent.com"],
            redirectDomains: ["https://github.com"],
          },
        },
        _meta: {
          "openai/toolInvocation/invoking": "Loading pull requests",
          "openai/toolInvocation/invoked": "Loaded pull requests",
        },
      },
      async ({ repo, state, limit }, extra) => {
        const auth = await githubAuthFor(extra.http?.authInfo, extra.http?.req);
        const { results, repoCount } = await listPullRequests({ auth, repo, state, limit });
        const pullRequests = results.map((r) => r.pullRequest);
        const where = repo ?? "your repositories";
        const appInstallUrl = auth.mode === "app" ? installUrl : undefined;

        if (repoCount === 0) {
          return {
            structuredContent: { pullRequests, installUrl: appInstallUrl },
            content: [
              {
                type: "text",
                text: appInstallUrl
                  ? `No repositories are connected yet. Install the GitHub App on the repositories to show: ${appInstallUrl}`
                  : "No repositories found.",
              },
            ],
          };
        }

        return {
          structuredContent: { pullRequests, installUrl: appInstallUrl },
          // Expanded-card detail is display-only, so it stays out of the
          // model's context.
          _meta: {
            details: Object.fromEntries(
              results.map(({ pullRequest: pr, details }) => [
                pr.url,
                {
                  ...details,
                  merge: {
                    ...details.merge,
                    token: signMergeIntent({
                      user: auth.user,
                      repo: pr.repo,
                      number: pr.number,
                      headOid: details.merge.headOid,
                      base: pr.base,
                      method: details.merge.method,
                    }),
                  },
                },
              ]),
            ),
          },
          content: [
            {
              type: "text",
              text: pullRequests.length
                ? `Found ${pullRequests.length} ${state === "all" ? "" : `${state} `}pull requests in ${where}.`
                : `No ${state === "all" ? "" : `${state} `}pull requests in ${where}.`,
            },
          ],
        };
      },
    )
    .registerTool(
      {
        name: "merge-pull-request",
        description:
          "Merge a pull request into its base branch. Only the pull request card can call this, with the confirmation token it received for that exact merge.",
        inputSchema: {
          repo: z
            .string()
            .regex(/^[\w.-]+\/[\w.-]+$/, "Use owner/name")
            .describe("Repository, as owner/name"),
          number: z.number().int().positive().describe("Pull request number"),
          expectedHeadOid: z
            .string()
            .regex(/^[0-9a-f]{40}$/, "Full commit SHA")
            .describe("Head commit the user reviewed; the merge fails if the branch moved"),
          expectedBase: z.string().min(1).max(255).describe("Base branch the user confirmed"),
          method: z.enum(["MERGE", "SQUASH", "REBASE"]).describe("Merge method the user confirmed"),
          mergeToken: z.string().max(200).describe("Confirmation token from the card"),
        },
        outputSchema: {
          merged: z.boolean(),
          method: z.enum(["MERGE", "SQUASH", "REBASE"]),
          mergeCommit: z.string().nullable().describe("SHA of the merge commit, if any"),
        },
        annotations: {
          readOnlyHint: false,
          openWorldHint: true,
          destructiveHint: true,
        },
        // Hidden from the model where hosts support it. The real control is
        // mergeToken, which only the card has (see merge-token.ts).
        _meta: {
          ui: { visibility: ["app"] },
          "openai/widgetAccessible": true,
          "openai/toolInvocation/invoking": "Merging pull request",
          "openai/toolInvocation/invoked": "Merge finished",
        },
      },
      async ({ repo, number, expectedHeadOid, expectedBase, method, mergeToken }, extra) => {
        const auth = await githubAuthFor(extra.http?.authInfo, extra.http?.req);
        const intent = { user: auth.user, repo, number, headOid: expectedHeadOid, base: expectedBase, method };
        if (!verifyMergeIntent(mergeToken, intent)) {
          throw new Error("This merge wasn't confirmed from the card, or the card is stale. Reload the card and confirm again.");
        }
        const result = await mergePullRequest({ auth, repo, number, expectedHeadOid, expectedBase, method });
        return {
          structuredContent: result,
          content: [
            {
              type: "text",
              text: result.merged
                ? `Merged ${repo}#${number} (${result.method.toLowerCase()}).`
                : `${repo}#${number} was not merged.`,
            },
          ],
        };
      },
    ),
});

export type AppType = typeof app;
