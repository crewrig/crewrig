// attribution.js — resolveAttribution(record, ctx), the whole of spec 0208
// R1 and R5-R12 (PLAN v3 step 4). Pure: every effect is a read, every input
// arrives through ctx = { now, env, cwd, declarations, memo }.
//
// Channel order (R1, R5): (1) the session's declaration record when its
// declaringChannel is 'explicit'; (2) ctx.env.CREWRIG_TASK; (3) the
// worktree-or-branch derivation; (4) that same declaration record when its
// declaringChannel is 'protocol'. Resolution stops at the FIRST PRESENT
// channel and never consults a lower one, whether or not that channel's own
// value validates.
//
// ctx.declarations === false disables channels 1 and 4 (no declaration read
// at all); ctx.cwd falsy disables channel 3 — the historical backfill
// context sets both, plus env: {}, so every channel is structurally absent
// (backfill.js). This is deliberate: the checkout state read today does not
// correspond to the branch checked out when a historical record was
// captured (rejected alternative, PLAN v3).
//
// Branch grammar grounding (PLAN v3 pass-3 named edit 1): the
// <prefix>/<NNNN>-<slug> ticket-branch shape and the <NNNN>-<slug> spec-id
// pairing it is disambiguated against are AGENTS.md's own conventions —
// l. 148 (`<prefix>/<NNNN>-<slug>` over ticket ids), l. 179 and l. 184
// (`spec/<NNNN>-<slug>` and its `-delta-<NN>` form over spec ids), and
// l. 180-181 ("Both values MUST match the spec file's frontmatter `id` and
// `slug` fields" — the grounding of the slug-matching rule deriveTicket()
// below implements). Verify these line numbers against `crewrig/main` at
// the head this ticket reads; AGENTS.md is not restated here.
//
// Fork-remote residue (pass-3 named edit 2): R8 selects the checked-out
// branch's own tracked upstream remote, else the remote named `origin`. A
// fork clone (e.g. `hcross/crewrig`, upstream-tracking `hcross`) and a
// canonical clone (upstream-tracking `crewrig`, or falling to `origin`)
// therefore derive DIFFERENT owner/repo pairs — and so different
// `forge-issue` refs — for the textually identical task-handoff key of one
// macro task. This is the one case R9's cross-CLI textual identity does not
// reach by construction; the documented recourse is an explicit
// declaration (`bash scripts/usage-task.sh set --task-key <key> --channel
// explicit`), which resolves at channel 1 and never reaches this
// derivation. See docs/usage-attribution.md (doc-writer, issue #1171) for
// the adopter-facing explanation.

'use strict';

const fs = require('fs');
const path = require('path');

const checkout = require('../usage-store/checkout');
const declaration = require('../usage-store/declaration');

const TASK_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._#/-]{0,127}$/;

const ASSET_VALIDATORS = {
  'forge-issue': (ref) => /^[^\s/]+\/[^\s/]+#\d+$/.test(ref),
  'jira-key': (ref) => /^[A-Z][A-Z0-9]+-\d+$/.test(ref),
  'shared-file': (ref) => /^(https?:\/\/\S+|\/\S+)$/.test(ref),
};

const RECOGNIZED_HOSTS = ['github.com', 'gitlab.com'];

function validateTaskKey(value) {
  return typeof value === 'string' && TASK_KEY_RE.test(value);
}

function validateAsset(asset) {
  if (!asset || typeof asset !== 'object') return false;
  const validator = ASSET_VALIDATORS[asset.kind];
  if (!validator) return false;
  return typeof asset.ref === 'string' && validator(asset.ref);
}

// --- Channel 1/4: the declaration record ------------------------------------

function readDeclaration(record, ctx) {
  const sessionId = record.identity && record.identity.sessionId;
  let root = record.identity && record.identity.projectRoot;
  if (!root || root === 'unknown') root = ctx.cwd;
  let checkoutRoot = null;
  if (root) {
    checkoutRoot = checkout.checkoutRootFor(root) || checkout.realpathOrSelf(root);
  }
  return declaration.read({ sessionId, checkoutRoot, now: ctx.now });
}

function explicitChannel(declResult) {
  if (declResult && declResult.record.declaringChannel === 'explicit') {
    return {
      channel: 'explicit',
      taskHandoffKey: declResult.record.taskHandoffKey,
      externalAsset: declResult.record.externalAsset,
    };
  }
  return null;
}

function protocolChannel(declResult) {
  if (declResult && declResult.record.declaringChannel === 'protocol') {
    return {
      channel: 'protocol',
      taskHandoffKey: declResult.record.taskHandoffKey,
      externalAsset: declResult.record.externalAsset,
    };
  }
  return null;
}

// --- Channel 2: CREWRIG_TASK -------------------------------------------------

function envChannel(env) {
  const value = env && env.CREWRIG_TASK;
  if (!value) return null;
  return { channel: 'env', taskHandoffKey: value };
}

// --- Channel 3: worktree-or-branch, entirely from files (R8, R9) ------------

function parseGitDir(checkoutRoot) {
  const gitPath = path.join(checkoutRoot, '.git');
  let stat;
  try {
    stat = fs.statSync(gitPath);
  } catch (err) {
    return null;
  }
  if (stat.isDirectory()) return gitPath;

  let content;
  try {
    content = fs.readFileSync(gitPath, 'utf8');
  } catch (err) {
    return null;
  }
  const m = content.match(/^gitdir:\s*(.+?)\s*$/m);
  if (!m) return null;
  return path.isAbsolute(m[1]) ? m[1] : path.resolve(checkoutRoot, m[1]);
}

function resolveCommonDir(gitdir) {
  try {
    const raw = fs.readFileSync(path.join(gitdir, 'commondir'), 'utf8').trim();
    return path.isAbsolute(raw) ? raw : path.resolve(gitdir, raw);
  } catch (err) {
    return gitdir; // main checkout — its own gitdir IS the common dir
  }
}

function readBranch(gitdir) {
  let content;
  try {
    content = fs.readFileSync(path.join(gitdir, 'HEAD'), 'utf8');
  } catch (err) {
    return null;
  }
  const m = content.match(/^ref:\s*refs\/heads\/(.+?)\s*$/m);
  return m ? m[1] : null;
}

function parseGitConfig(content) {
  const sections = {};
  let current = null;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const sectionMatch = line.match(/^\[([^\]"\s]+)(?:\s+"([^"]*)")?\]$/);
    if (sectionMatch) {
      current = sectionMatch[2] !== undefined ? `${sectionMatch[1]} "${sectionMatch[2]}"` : sectionMatch[1];
      if (!sections[current]) sections[current] = {};
      continue;
    }
    if (!current) continue;
    const kvMatch = line.match(/^([A-Za-z0-9-]+)\s*=\s*(.*)$/);
    if (kvMatch) {
      sections[current][kvMatch[1].toLowerCase()] = kvMatch[2].trim().replace(/^"(.*)"$/, '$1');
    }
  }
  return sections;
}

function readGitConfig(commonDir) {
  try {
    return parseGitConfig(fs.readFileSync(path.join(commonDir, 'config'), 'utf8'));
  } catch (err) {
    return {};
  }
}

// resolveRemote(config, branch) — R8's fixed order: the checked-out branch's
// own configured upstream, else the remote named 'origin'.
function resolveRemote(config, branch) {
  const branchSection = config[`branch "${branch}"`];
  if (branchSection && branchSection.remote) {
    const remoteSection = config[`remote "${branchSection.remote}"`];
    if (remoteSection && remoteSection.url) {
      return { step: 'upstream', remote: branchSection.remote, url: remoteSection.url };
    }
  }
  const originSection = config['remote "origin"'];
  if (originSection && originSection.url) {
    return { step: 'origin', remote: 'origin', url: originSection.url };
  }
  return null;
}

// parseRemoteUrl(url) — the scp-like SSH form (git@host:owner/repo.git) and
// an "https" URL of the form host/owner/repo[.git], entirely offline.
function parseRemoteUrl(url) {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    const m = url.match(/^(?:[^@\s]+@)?([^:\s]+):(.+?)(?:\.git)?\/?$/);
    if (m) return { host: m[1], ownerRepo: m[2].replace(/^\/+/, '') };
    return null;
  }
  const m = url.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/\s]+@)?([^/\s]+)\/(.+?)(?:\.git)?\/?$/i);
  return m ? { host: m[1], ownerRepo: m[2] } : null;
}

function isRecognizedHost(host, forgeHostsEnv) {
  const extra = (forgeHostsEnv || '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  return RECOGNIZED_HOSTS.includes(host) || extra.includes(host);
}

// deriveTicket(checkoutRoot, branch) — the fixed three-rule order (R8, R9,
// v2-F2's fix): the .worktrees/<NNNN> path segment; else, for a branch of
// shape <prefix>/<NNNN>-<slug>[-delta-<NN>], the checkout's own spec file
// and its related-issue field (never the prefix alone — spec/ stays the one
// special case where an absent file yields nothing rather than falling
// through); else the ticket-branch grammar. Every id normalized to its bare
// decimal form.
function deriveTicket(checkoutRoot, branch) {
  const worktreeMatch = checkoutRoot.match(/(?:^|\/)\.worktrees\/(\d{1,6})(?:\/|$)/);
  if (worktreeMatch) {
    return { ticket: String(Number(worktreeMatch[1])), via: 'worktree-path' };
  }

  if (!branch) return null;

  const specShape = branch.match(/^([a-z]+)\/(\d{4})-([a-z0-9][a-z0-9-]*?)(?:-delta-(\d{2}))?$/);
  if (specShape) {
    const [, prefix, nnnn, slug, deltaNn] = specShape;
    const specFileName = deltaNn ? `${nnnn}-${slug}.delta-${deltaNn}.md` : `${nnnn}-${slug}.md`;
    let firstLines = null;
    try {
      const content = fs.readFileSync(path.join(checkoutRoot, 'specs', specFileName), 'utf8');
      firstLines = content.split(/\r?\n/).slice(0, 20).join('\n');
    } catch (err) {
      firstLines = null;
    }
    if (firstLines !== null) {
      const relatedMatch = firstLines.match(/^related-issue:\s*"?(\d{1,6})"?\s*$/m);
      if (relatedMatch) {
        return { ticket: String(Number(relatedMatch[1])), via: 'spec-file:related-issue' };
      }
    }
    if (prefix === 'spec') {
      return null; // the prefix already says "spec" — no fallback to the number
    }
    // file or field absent, non-spec prefix — fall through to the
    // ticket-branch grammar below.
  }

  const ticketMatch = branch.match(/^(?!spec\/)[a-z]+\/(\d{1,6})-[a-z0-9]/);
  if (ticketMatch) {
    return { ticket: String(Number(ticketMatch[1])), via: 'ticket-branch' };
  }

  return null;
}

function deriveForgeAsset(checkoutRoot, branch, ticket, env) {
  const config = readGitConfig(resolveCommonDir(parseGitDir(checkoutRoot) || checkoutRoot));
  const resolved = resolveRemote(config, branch);
  if (!resolved) {
    return { asset: null, assetReason: 'no upstream on the checked-out branch and no remote named origin' };
  }
  const parsed = parseRemoteUrl(resolved.url);
  if (!parsed) {
    return { asset: null, assetReason: `unrecognized remote URL form: ${resolved.url}` };
  }
  if (!isRecognizedHost(parsed.host, env && env.CREWRIG_FORGE_HOSTS)) {
    return { asset: null, assetReason: `no recognized forge host: ${parsed.host}` };
  }
  return { asset: { kind: 'forge-issue', ref: `${parsed.ownerRepo}#${ticket}` }, assetReason: null };
}

function worktreeChannel(record, ctx) {
  if (!ctx.cwd) return null; // historical ctx (backfill) — no live channel applies

  let root = record.identity && record.identity.projectRoot;
  if (!root || root === 'unknown') root = ctx.cwd;

  const checkoutRoot = checkout.checkoutRootFor(root);
  if (!checkoutRoot) return null; // no ancestor holds .git within 32 levels

  const memoKey = checkoutRoot;
  let cached;
  if (ctx.memo.has(memoKey)) {
    cached = ctx.memo.get(memoKey);
  } else {
    const gitdir = parseGitDir(checkoutRoot);
    const branch = gitdir ? readBranch(gitdir) : null;
    const ticketResult = deriveTicket(checkoutRoot, branch);
    if (!ticketResult) {
      cached = null;
    } else {
      const { asset, assetReason } = deriveForgeAsset(checkoutRoot, branch, ticketResult.ticket, ctx.env);
      cached = { ticket: ticketResult.ticket, via: ticketResult.via, asset, assetReason };
    }
    ctx.memo.set(memoKey, cached);
  }

  if (!cached) return null;

  return {
    channel: 'worktree',
    taskHandoffKey: cached.ticket,
    externalAsset: cached.asset || undefined,
    via: cached.via,
    assetReason: cached.assetReason,
  };
}

// --- Validation and resolution ----------------------------------------------

function validateCandidate(candidate) {
  const reasons = [];

  if (candidate.taskHandoffKey !== undefined && !validateTaskKey(candidate.taskHandoffKey)) {
    reasons.push(`invalid taskHandoffKey: ${JSON.stringify(candidate.taskHandoffKey)}`);
  }
  if (candidate.externalAsset !== undefined && !validateAsset(candidate.externalAsset)) {
    reasons.push(`invalid externalAsset: ${JSON.stringify(candidate.externalAsset)}`);
  }

  if (reasons.length > 0) {
    return {
      attribution: null,
      channel: candidate.channel,
      outcome: 'unattributed',
      reason: reasons.join('; '),
      assetReason: null,
    };
  }

  const attribution = {};
  if (candidate.taskHandoffKey !== undefined) attribution.taskHandoffKey = candidate.taskHandoffKey;
  if (candidate.externalAsset !== undefined) attribution.externalAsset = candidate.externalAsset;

  return {
    attribution,
    channel: candidate.channel,
    outcome: 'attributed',
    reason: null,
    assetReason: candidate.assetReason || null,
  };
}

function unattributedReason(ctx) {
  if (ctx.declarations === false && !ctx.cwd) {
    return 'backfill: no live channel applies to a historical record';
  }
  return 'no channel present';
}

function resolveAttribution(record, ctx) {
  ctx = ctx || {};
  const resolved = {
    now: ctx.now === undefined ? Date.now() : ctx.now,
    env: ctx.env || {},
    cwd: ctx.cwd,
    declarations: ctx.declarations !== false,
    memo: ctx.memo || new Map(),
  };

  let declResult = null;
  if (resolved.declarations) {
    try {
      declResult = readDeclaration(record, resolved);
    } catch (err) {
      declResult = null;
    }
  }

  const producers = [
    () => explicitChannel(declResult),
    () => envChannel(resolved.env),
    () => worktreeChannel(record, resolved),
    () => protocolChannel(declResult),
  ];

  for (const produce of producers) {
    const candidate = produce();
    if (candidate !== null) {
      return validateCandidate(candidate);
    }
  }

  return {
    attribution: null,
    channel: null,
    outcome: 'unattributed',
    reason: unattributedReason(resolved),
    assetReason: null,
  };
}

module.exports = { resolveAttribution, validateTaskKey, validateAsset };
