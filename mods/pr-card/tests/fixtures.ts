// GraphQL-shaped responses as `gh api graphql` prints them, built per case.

type Node = Record<string, unknown>

export type Fixture = {
  state?: 'OPEN' | 'CLOSED' | 'MERGED'
  isDraft?: boolean
  mergeable?: string
  mergeStateStatus?: string
  reviewDecision?: string | null
  rollup?: string | null
  checks?: Node[]
  checksTotal?: number
  reviews?: Node[]
  reviewRequests?: Node[]
  threads?: Node[]
  viewerPermission?: string
  viewer?: string
  isCrossRepository?: boolean
  headOwner?: string
  title?: string
  number?: number
  owner?: string
  repo?: string
}

export const checkRun = (name: string, status: string, conclusion: string | null, isRequired: boolean | null = false): Node => ({
  __typename: 'CheckRun',
  name,
  status,
  conclusion,
  detailsUrl: `https://github.com/acme/app/actions/runs/1/job/${name.length}`,
  isRequired,
  checkSuite: { workflowRun: { workflow: { name: 'CI' } } },
})

export const statusContext = (context: string, state: string): Node => ({
  __typename: 'StatusContext',
  context,
  state,
  targetUrl: 'https://ci.example.com/build/1',
  isRequired: false,
})

export const thread = (id: string, body: string, opts: Partial<{ path: string; line: number | null; isResolved: boolean; isOutdated: boolean; author: string; diffHunk: string }> = {}): Node => ({
  id,
  isResolved: opts.isResolved ?? false,
  isOutdated: opts.isOutdated ?? false,
  path: opts.path ?? 'src/app.ts',
  line: opts.line === undefined ? 12 : opts.line,
  originalLine: 12,
  startLine: null,
  comments: {
    totalCount: 1,
    nodes: [
      {
        id: `${id}-c1`,
        author: { login: opts.author ?? 'reviewer' },
        body,
        url: `https://github.com/acme/app/pull/42#discussion_r${id.length}`,
        createdAt: '2026-10-01T10:00:00Z',
        diffHunk: opts.diffHunk ?? '@@ -10,3 +10,4 @@ export function main() {\n   const a = 1\n-  const b = 2\n+  const b = compute()\n+  return a + b',
      },
    ],
  },
})

export function prResponse(f: Fixture = {}): unknown {
  const checks = f.checks ?? [checkRun('build', 'COMPLETED', 'SUCCESS', true), checkRun('lint', 'COMPLETED', 'SUCCESS')]
  return {
    data: {
      viewer: { login: f.viewer ?? 'me' },
      repository: {
        nameWithOwner: `${f.owner ?? 'acme'}/${f.repo ?? 'app'}`,
        viewerPermission: f.viewerPermission ?? 'WRITE',
        pullRequest: {
          number: f.number ?? 42,
          title: f.title ?? 'Add compute step to main',
          url: `https://github.com/${f.owner ?? 'acme'}/${f.repo ?? 'app'}/pull/${f.number ?? 42}`,
          state: f.state ?? 'OPEN',
          isDraft: f.isDraft ?? false,
          updatedAt: '2026-10-02T10:00:00Z',
          maintainerCanModify: false,
          author: { login: 'me' },
          headRefName: 'feature/compute',
          baseRefName: 'main',
          headRefOid: 'abcdef1234567890abcdef1234567890abcdef12',
          isCrossRepository: f.isCrossRepository ?? false,
          headRepositoryOwner: { login: f.headOwner ?? 'acme' },
          additions: 40,
          deletions: 3,
          changedFiles: 2,
          mergeable: f.mergeable ?? 'MERGEABLE',
          mergeStateStatus: f.mergeStateStatus ?? 'CLEAN',
          reviewDecision: f.reviewDecision === undefined ? 'REVIEW_REQUIRED' : f.reviewDecision,
          files: {
            totalCount: 2,
            nodes: [
              { path: 'src/app.ts', additions: 30, deletions: 3 },
              { path: 'src/app.test.ts', additions: 10, deletions: 0 },
            ],
          },
          commits: {
            totalCount: 1,
            nodes: [
              {
                commit: {
                  oid: 'abcdef1234567890abcdef1234567890abcdef12',
                  messageHeadline: 'Add compute step',
                  committedDate: '2026-10-02T09:00:00Z',
                  url: 'https://github.com/acme/app/commit/abcdef1',
                  statusCheckRollup:
                    f.rollup === null && f.checks?.length === 0
                      ? null
                      : { state: 'rollup' in f ? f.rollup : 'SUCCESS', contexts: { totalCount: f.checksTotal ?? checks.length, nodes: checks } },
                },
              },
            ],
          },
          latestOpinionatedReviews: { nodes: f.reviews ?? [] },
          reviewRequests: { nodes: f.reviewRequests ?? [] },
          reviewThreads: { totalCount: (f.threads ?? []).length, nodes: f.threads ?? [] },
        },
      },
    },
  }
}
