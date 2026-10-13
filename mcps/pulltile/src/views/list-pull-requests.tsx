import "../index.css";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { useOpenExternal, useRequestSize, useSendFollowUpMessage, useUser } from "skybridge/web";
import cardBg from "../assets/pr-card-bg.jpg";
import type { PullRequest, PullRequestDetails } from "../github.js";
import { useCallTool, useToolInfo } from "../helpers.js";

// Imported from JS so Skybridge resolves it against the server URL; a CSS
// url() resolves against the host's sandbox iframe origin in dev.
const heroStyle = { "--pr-bg": `url("${cardBg}")` } as CSSProperties;

const STATE_LABEL: Record<PullRequest["state"], string> = {
  open: "Open",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
};

const REVIEW_LABEL: Record<string, string> = {
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
  COMMENTED: "Commented",
  DISMISSED: "Dismissed",
  PENDING: "Pending",
};

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function duration(sec: number | null): string {
  if (!sec) return "";
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, "0")}s`;
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 98 96" width="22" height="22" aria-label="GitHub">
      <path
        fill="currentColor"
        d="M41.4395 69.3848C28.8066 67.8535 19.9062 58.7617 19.9062 46.9902C19.9062 42.2051 21.6289 37.0371 24.5 33.5918C23.2559 30.4336 23.4473 23.7344 24.8828 20.959C28.7109 20.4805 33.8789 22.4902 36.9414 25.2656C40.5781 24.1172 44.4062 23.543 49.0957 23.543C53.7852 23.543 57.6133 24.1172 61.0586 25.1699C64.0254 22.4902 69.2891 20.4805 73.1172 20.959C74.457 23.543 74.6484 30.2422 73.4043 33.4961C76.4668 37.1328 78.0937 42.0137 78.0937 46.9902C78.0937 58.7617 69.1934 67.6621 56.3691 69.2891C59.623 71.3945 61.8242 75.9883 61.8242 81.252L61.8242 91.2051C61.8242 94.0762 64.2168 95.7031 67.0879 94.5547C84.4102 87.9512 98 70.6289 98 49.1914C98 22.1074 75.9883 6.69539e-07 48.9043 4.309e-07C21.8203 1.92261e-07 -1.9479e-07 22.1074 -4.3343e-07 49.1914C-6.20631e-07 70.4375 13.4941 88.0469 31.6777 94.6504C34.2617 95.6074 36.75 93.8848 36.75 91.3008L36.75 83.6445C35.4102 84.2188 33.6875 84.6016 32.1562 84.6016C25.8398 84.6016 22.1074 81.1563 19.4277 74.7441C18.375 72.1602 17.2266 70.6289 15.0254 70.3418C13.877 70.2461 13.4941 69.7676 13.4941 69.1934C13.4941 68.0449 15.4082 67.1836 17.3223 67.1836C20.0977 67.1836 22.4902 68.9063 24.9785 72.4473C26.8926 75.2227 28.9023 76.4668 31.2949 76.4668C33.6875 76.4668 35.2187 75.6055 37.4199 73.4043C39.0469 71.7773 40.291 70.3418 41.4395 69.3848Z"
      />
    </svg>
  );
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function BranchIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <circle cx="4.5" cy="3.5" r="1.6" {...stroke} />
      <circle cx="4.5" cy="12.5" r="1.6" {...stroke} />
      <circle cx="11.5" cy="5" r="1.6" {...stroke} />
      <path d="M4.5 5.1v5.8M11.5 6.6c0 3-7 2-7 4.3" {...stroke} />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <circle cx="8" cy="5.5" r="2.75" {...stroke} />
      <path d="M2.75 14c.6-2.6 2.7-4 5.25-4s4.65 1.4 5.25 4" {...stroke} />
    </svg>
  );
}

function ChecksIcon({ result }: { result: "passed" | "failed" | "pending" }) {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" {...stroke} />
      {result === "passed" && <path d="M5.25 8.25 7.1 10l3.65-4" {...stroke} />}
      {result === "failed" && <path d="M5.75 5.75l4.5 4.5M10.25 5.75l-4.5 4.5" {...stroke} />}
      {result === "pending" && <path d="M8 4.75V8l2 1.5" {...stroke} />}
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path d="M4 1.75h5.25L12.5 5v8.25a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.75a1 1 0 0 1 1-1Z" {...stroke} />
      <path d="M9 1.75V5.25h3.5" {...stroke} />
    </svg>
  );
}

function RepoIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M3 13V3a1.25 1.25 0 0 1 1.25-1.25H13v9.5H4.25A1.25 1.25 0 0 0 3 12.5Zm0 0a1.25 1.25 0 0 0 1.25 1.25H6M13 11.25v3H10" {...stroke} />
      <path d="M6 12.75v2.5l1-.75 1 .75v-2.5" {...stroke} />
    </svg>
  );
}

function MergeIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <circle cx="4.5" cy="3.5" r="1.6" {...stroke} />
      <circle cx="4.5" cy="12.5" r="1.6" {...stroke} />
      <circle cx="11.5" cy="9" r="1.6" {...stroke} />
      <path d="M4.5 5.1v5.8M4.5 5.5c0 2.5 2.5 3.5 5.4 3.5" {...stroke} />
    </svg>
  );
}

function StatusDot({ result }: { result: "passed" | "failed" | "pending" }) {
  return <span className={`pr-dot pr-dot-${result}`} aria-label={result} />;
}

function checksSummary({ passed, failed, pending }: PullRequest["checks"]) {
  if (failed) return { result: "failed" as const, text: `${failed} of ${passed + failed + pending} checks failed` };
  if (pending) return { result: "pending" as const, text: `${pending} checks running` };
  return { result: "passed" as const, text: `${passed} checks passed` };
}

function MergeButton({
  pr,
  details,
  onMerged,
}: {
  pr: PullRequest;
  details: PullRequestDetails;
  onMerged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { callTool, isPending, isSuccess } = useCallTool("merge-pull-request");
  const { blockedReason, method, headOid, token } = details.merge;

  if (pr.state === "merged" || isSuccess) {
    return (
      <span className="pr-merge-note pr-merged-text">
        <MergeIcon /> Merged into {pr.base}
      </span>
    );
  }
  if (blockedReason || !token) {
    return (
      <>
        <button className="pr-btn" disabled title={blockedReason ?? undefined}>
          <MergeIcon /> Merge into {pr.base}
        </button>
        {blockedReason && <span className="pr-merge-note">{blockedReason}</span>}
      </>
    );
  }
  if (isPending) {
    return (
      <button className="pr-btn pr-btn-merge" disabled>
        <MergeIcon /> Merging…
      </button>
    );
  }
  if (confirming) {
    return (
      <>
        <button
          className="pr-btn pr-btn-merge"
          onClick={() => {
            setError(null);
            callTool(
              {
                repo: pr.repo,
                number: pr.number,
                expectedHeadOid: headOid,
                expectedBase: pr.base,
                method,
                mergeToken: token,
              },
              {
                onSuccess: (res) => {
                  setConfirming(false);
                  if (res.isError) {
                    const text = res.content.find((c) => c.type === "text");
                    setError(text?.type === "text" ? text.text : "Merge failed.");
                  } else {
                    onMerged();
                  }
                },
                onError: (e) => {
                  setConfirming(false);
                  setError(e instanceof Error ? e.message : "Merge failed.");
                },
              },
            );
          }}
        >
          <MergeIcon /> Confirm {method.toLowerCase()} merge
        </button>
        <button className="pr-btn" onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </>
    );
  }
  return (
    <>
      <button className="pr-btn pr-btn-merge" onClick={() => setConfirming(true)}>
        <MergeIcon /> Merge into {pr.base}
      </button>
      {error && <span className="pr-merge-note pr-failed">{error}</span>}
    </>
  );
}

function PrDetails({
  pr,
  details,
  onMerged,
}: {
  pr: PullRequest;
  details: PullRequestDetails;
  onMerged: () => void;
}) {
  const openExternal = useOpenExternal();
  const sendFollowUp = useSendFollowUpMessage();
  const open = (url: string) => openExternal(url, { redirectUrl: false });
  const total = pr.checks.passed + pr.checks.failed + pr.checks.pending;
  const checks = checksSummary(pr.checks);

  return (
    <div className="pr-details">
      <button className="pr-repo" onClick={() => open(`https://github.com/${pr.repo}`)}>
        <RepoIcon />
        {pr.repo}
      </button>

      <div className="pr-grid pr-grid-2">
        <section className="pr-panel">
          <h4>Summary</h4>
          <p className="pr-body-text">{details.body || "No description."}</p>
          {details.labels.length > 0 && (
            <div className="pr-labels">
              {details.labels.map((l) => (
                <span key={l.name} className="pr-label" style={{ "--label": `#${l.color}` } as CSSProperties}>
                  {l.name}
                </span>
              ))}
            </div>
          )}
        </section>

        <section className="pr-panel">
          <h4>
            CI checks
            {total > 0 && <span className={`pr-${checks.result}`}>{checks.text}</span>}
          </h4>
          {details.checkRuns.length === 0 ? (
            <p className="pr-muted">No checks reported.</p>
          ) : (
            <ul className="pr-rows">
              {details.checkRuns.slice(0, 5).map((c) => (
                <li key={c.name}>
                  <StatusDot result={c.result} />
                  <span className="pr-grow">{c.name}</span>
                  <span className="pr-muted">{duration(c.durationSec)}</span>
                </li>
              ))}
              {total > 5 && <li className="pr-muted">+{total - 5} more</li>}
            </ul>
          )}
        </section>

      </div>

      <div className="pr-grid pr-grid-3">
        <section className="pr-panel">
          <h4>
            Changed files <span className="pr-count">{pr.changedFiles}</span>
          </h4>
          <ul className="pr-rows">
            {details.files.map((f) => (
              <li key={f.path}>
                <span className="pr-grow pr-path" title={f.path}>{f.path}</span>
                <span className="pr-passed">+{f.additions}</span>
                <span className="pr-failed">−{f.deletions}</span>
              </li>
            ))}
          </ul>
          {pr.changedFiles > details.files.length && (
            <button className="pr-link" onClick={() => open(`${pr.url}/files`)}>
              View all {pr.changedFiles} files →
            </button>
          )}
        </section>

        <section className="pr-panel">
          <h4>Key changes</h4>
          <ul className="pr-bullets">
            {details.commits.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
          <button className="pr-link" onClick={() => open(`${pr.url}/commits`)}>
            View commits →
          </button>
        </section>

        <section className="pr-panel">
          <h4>Review feedback</h4>
          {details.feedback.length === 0 ? (
            <p className="pr-muted">No reviews yet.</p>
          ) : (
            details.feedback.map((f, i) => (
              <div key={i} className="pr-comment">
                <div className="pr-comment-head">
                  {f.avatarUrl && <img src={f.avatarUrl} alt="" className="pr-avatar" />}
                  <strong>{f.author}</strong>
                  <span className="pr-muted">{timeAgo(f.createdAt)}</span>
                  {f.state && <span className="pr-pill">{REVIEW_LABEL[f.state] ?? f.state}</span>}
                </div>
                {f.body && <p>{f.body}</p>}
              </div>
            ))
          )}
        </section>
      </div>

      <div className="pr-actions">
        <button className="pr-btn pr-btn-primary" onClick={() => open(`${pr.url}/files`)}>
          <GitHubMark /> Review in GitHub
        </button>
        <MergeButton pr={pr} details={details} onMerged={onMerged} />
        <button
          className="pr-btn pr-btn-end"
          onClick={() => sendFollowUp(`Review pull request ${pr.repo}#${pr.number}.`)}
        >
          Ask ChatGPT to review
        </button>
      </div>
    </div>
  );
}

function PrCard({ pr, details }: { pr: PullRequest; details?: PullRequestDetails }) {
  const [expanded, setExpanded] = useState(false);
  const [merged, setMerged] = useState(false);
  const state = merged ? "merged" : pr.state;
  const total = pr.checks.passed + pr.checks.failed + pr.checks.pending;
  const checks = checksSummary(pr.checks);

  return (
    <article className={`pr-card pr-${state}`}>
      <div className="pr-hero" style={heroStyle}>
        {/* Row 1: logo | PULL REQUEST #n  state */}
        <div className="pr-eyebrow">
          <span className="pr-logo">
            <GitHubMark />
          </span>
          <span className="pr-divider" />
          <span className="pr-kicker" title={pr.repo}>
            Pull request #{pr.number}
          </span>
          <span className="pr-badge">{STATE_LABEL[state]}</span>
        </div>

        {/* Row 2 */}
        <h3 className="pr-title">{pr.title}</h3>

        {/* Row 3 */}
        <div className="pr-meta">
          <span className="pr-branch">
            <BranchIcon />
            {pr.head}
          </span>
          <span className="pr-muted">→</span>
          <span className="pr-branch">
            <BranchIcon />
            {pr.base}
          </span>
          <span className="pr-author">
            <PersonIcon />
            {pr.author}
          </span>
          {total > 0 && (
            <>
              <span className="pr-divider" />
              <span className={`pr-${checks.result}`}>
                <ChecksIcon result={checks.result} />
                {checks.text}
              </span>
            </>
          )}
          <span className="pr-divider" />
          <span>
            <FileIcon />
            {pr.changedFiles} files changed
          </span>
        </div>

        {details && (
          <button
            className="pr-toggle"
            aria-label={expanded ? "Hide details" : "Show details"}
            aria-expanded={expanded}
            onClick={() => setExpanded((e) => !e)}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
      {expanded && details && (
        <PrDetails pr={{ ...pr, state }} details={details} onMerged={() => setMerged(true)} />
      )}
    </article>
  );
}

function RepoPicker({ url, label }: { url: string; label: string }) {
  const openExternal = useOpenExternal();
  return (
    <button className="pr-btn pr-btn-primary" onClick={() => openExternal(url, { redirectUrl: false })}>
      <GitHubMark /> {label}
    </button>
  );
}

// Hosts draw an opaque backdrop behind a frame whose color scheme differs from
// the page around it, so match the host's theme to keep the frame transparent.
function useHostColorScheme() {
  const { theme } = useUser();
  useEffect(() => {
    document.documentElement.style.colorScheme = theme;
  }, [theme]);
}

// Report the content height whenever it changes (cards expanding or
// collapsing) so the host frame shrinks back as well as grows.
function useFitHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const requestSize = useRequestSize();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last = 0;
    const observer = new ResizeObserver(() => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      if (height !== last) {
        last = height;
        requestSize({ height }).catch(() => {});
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [requestSize]);
  return ref;
}

export default function ListPullRequests() {
  const { isPending, output, input, responseMetadata } = useToolInfo<"list-pull-requests">();
  const listRef = useFitHeight();
  useHostColorScheme();

  if (isPending) {
    return (
      <div className="pr-list" ref={listRef}>
        <div className="pr-card pr-placeholder">
          Loading pull requests{input?.repo ? ` in ${input.repo}` : ""}…
        </div>
      </div>
    );
  }

  if (output.pullRequests.length === 0) {
    return (
      <div className="pr-list" ref={listRef}>
        <div className="pr-card pr-placeholder">
          {output.installUrl ? (
            <>
              <p>Pick the repositories whose pull requests should show here.</p>
              <RepoPicker url={output.installUrl} label="Choose repositories" />
            </>
          ) : (
            "No pull requests found."
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="pr-list" ref={listRef}>
      {output.pullRequests.map((pr) => (
        <PrCard key={pr.url} pr={pr} details={responseMetadata?.details?.[pr.url]} />
      ))}
    </div>
  );
}
