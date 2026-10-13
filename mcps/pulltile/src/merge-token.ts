import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// The list tool hands each card a signed token for exactly what the card shows
// (user, PR, head commit, base branch, method). The merge tool only runs with a
// matching token, and tokens travel in `_meta`, which hosts give to the view
// but not the model, so a prompt-injected model can't trigger a merge.

// A per-process secret invalidates tokens on restart (the card just needs a
// reload). Set MERGE_TOKEN_SECRET when running more than one instance.
const secret = process.env.MERGE_TOKEN_SECRET ?? randomBytes(32).toString("hex");

const TTL_MS = 30 * 60 * 1000;

export type MergeIntent = {
  user: string;
  repo: string;
  number: number;
  headOid: string;
  base: string;
  method: string;
};

function mac(intent: MergeIntent, expires: number): string {
  const payload = [
    intent.user,
    intent.repo.toLowerCase(),
    intent.number,
    intent.headOid,
    intent.base,
    intent.method,
    expires,
  ].join("\n");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signMergeIntent(intent: MergeIntent): string {
  const expires = Date.now() + TTL_MS;
  return `${expires}.${mac(intent, expires)}`;
}

export function verifyMergeIntent(token: string, intent: MergeIntent): boolean {
  const [expiresRaw, sig] = token.split(".");
  const expires = Number(expiresRaw);
  if (!sig || !Number.isFinite(expires) || expires < Date.now()) return false;
  const expected = Buffer.from(mac(intent, expires));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
