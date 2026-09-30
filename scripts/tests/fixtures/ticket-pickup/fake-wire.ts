// fake-wire.ts — the three wire front-ends of the fake forge: each answers
// the argv of `gh api`, `glab api` or `tea api` from `FakeForge` state in
// that forge's JSON shape (GitHub REST issues/timeline, GitLab issues/notes
// with assignment system notes, Gitea issues/timeline with `assignees`
// entries). Writes follow each forge's storage semantics: GitHub adds and
// removes, GitLab replaces the whole set in one PUT (one system note), Gitea
// has dedicated add/remove endpoints from 1.27 and otherwise a PATCH that
// deletes the unlisted assignees then adds the listed ones, one transaction
// per toggle (so a replacing PATCH exposes a transient empty set).

import type { RunResult } from "../../../lib/forge-detect.ts";
import type { FakeForge, Mutation, Step } from "./fake-forge.ts";

const ok = (v: unknown): RunResult => ({ status: 0, stdout: JSON.stringify(v), stderr: "" });
const ndjson = (vs: unknown[]): RunResult => ({
  status: 0,
  stdout: vs.map((v) => JSON.stringify(v)).join("\n"),
  stderr: "",
});
const fail = (msg: string): RunResult => ({ status: 1, stdout: "", stderr: msg });

/** GitHub and Gitea render timestamps at one-second resolution; GitLab keeps milliseconds. */
const sec = (at: number): string =>
  new Date(Math.floor(at / 1000) * 1000).toISOString().replace(".000Z", "Z");
const ms = (at: number): string => new Date(at).toISOString();

interface Parsed {
  method: string;
  path: string;
  fields: Map<string, string[]>;
  data: unknown;
  jq: string | null;
}

function parse(rest: readonly string[]): Parsed {
  const p: Parsed = { method: "GET", path: "", fields: new Map(), data: null, jq: null };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] ?? "";
    const v = rest[i + 1] ?? "";
    if (a === "-X") [p.method, i] = [v, i + 1];
    else if (a === "--hostname" || a === "--remote" || a === "--login") i++;
    else if (a === "--jq") [p.jq, i] = [v, i + 1];
    else if (a === "-d") [p.data, i] = [JSON.parse(v) as unknown, i + 1];
    else if (a === "-f") {
      const eq = v.indexOf("=");
      const k = v.slice(0, eq);
      p.fields.set(k, [...(p.fields.get(k) ?? []), v.slice(eq + 1)]);
      i++;
    } else if (a === "--paginate") continue;
    else p.path = a;
  }
  return p;
}

function listOf(data: unknown, key: string): string[] {
  const v = (data as Record<string, unknown> | null)?.[key];
  return Array.isArray(v) ? v.map(String) : [];
}

/** An agent (tool-issued) write: additive, or replacing when the knob says so (R4). */
function agentAdd(f: FakeForge, n: number, actor: string, users: string[]): void {
  const cur = f.assignees(n);
  for (const user of users) {
    if (f.knobs.cannotAssign.has(user) || cur.includes(user)) continue;
    const steps: Step[] = f.knobs.replaceOnAdd
      ? [...cur.map((u) => ({ user: u, op: "remove" as const })), { user, op: "add" }]
      : [{ user, op: "add" }];
    f.mutate(n, actor, steps, { agent: true });
  }
}

function agentRemove(f: FakeForge, n: number, actor: string, users: string[]): void {
  const cur = f.assignees(n);
  const steps = users
    .filter((u) => cur.includes(u))
    .map((user) => ({ user, op: "remove" as const }));
  f.mutate(n, actor, steps, { agent: true });
}

/** GitLab PUT assignee_ids: one atomic replacement, one system note. */
function gitlabSet(f: FakeForge, n: number, actor: string, wanted: string[]): void {
  let list = wanted.filter((u) => !f.knobs.cannotAssign.has(u));
  if (f.knobs.singleAssignee) list = list.slice(0, 1);
  const cur = f.assignees(n);
  f.mutate(
    n,
    actor,
    [
      ...cur.filter((u) => !list.includes(u)).map((user) => ({ user, op: "remove" as const })),
      ...list.filter((u) => !cur.includes(u)).map((user) => ({ user, op: "add" as const })),
    ],
    { agent: true },
  );
}

/** Gitea PATCH assignees: DeleteNotPassedAssignee, then one toggle per added user. */
function giteaPatch(f: FakeForge, n: number, actor: string, wanted: string[]): void {
  const list = wanted.filter((u) => !f.knobs.cannotAssign.has(u));
  for (const user of f.assignees(n).filter((u) => !list.includes(u)))
    f.mutate(n, actor, [{ user, op: "remove" }], { agent: true });
  for (const user of list.filter((u) => !f.assignees(n).includes(u)))
    f.mutate(n, actor, [{ user, op: "add" }], { agent: true });
}

function after(f: FakeForge, actor: string, n: number): void {
  f.afterWrite?.(actor, n);
}

function writeComment(f: FakeForge, actor: string, n: number, body: string): RunResult {
  if (f.writeFails(actor, `comment #${n}`)) return fail("HTTP 502: Bad Gateway");
  f.say(actor, n, body);
  return ok({ id: f.comments.length, body });
}

function gitlabNote(m: Mutation): string {
  const list = (us: string[]): string => us.map((u) => `@${u}`).join(" and ");
  const add = m.steps.filter((s) => s.op === "add").map((s) => s.user);
  const rm = m.steps.filter((s) => s.op === "remove").map((s) => s.user);
  if (add.length > 0 && rm.length > 0) return `assigned to ${list(add)} and unassigned ${list(rm)}`;
  return add.length > 0 ? `assigned to ${list(add)}` : `unassigned ${list(rm)}`;
}

function page<T>(all: T[], path: string, size: string, cap = Number.POSITIVE_INFINITY): T[] {
  const q = new URLSearchParams(path.split("?")[1] ?? "");
  const per = Math.min(Number(q.get(size) ?? "30"), cap);
  const p = Number(q.get("page") ?? "1");
  return all.slice((p - 1) * per, p * per);
}

function github(f: FakeForge, actor: string, p: Parsed): RunResult {
  if (p.path === "user")
    return f.knobs.identityFails
      ? fail("HTTP 401: Bad credentials")
      : ok({ login: actor, id: f.userId(actor) });
  const m = /^repos\/acme\/widgets\/issues\/(\d+)(\/[a-z]+)?/.exec(p.path);
  const issue = f.issues.get(Number(m?.[1]));
  if (m === null || issue === undefined) return fail("gh: Not Found (HTTP 404)");
  const n = issue.n;
  const sub = m[2] ?? "";
  const users = p.fields.get("assignees[]") ?? [];
  if (sub === "" && p.method === "GET") {
    const as = f.assignees(n, true).map((login) => ({ login, id: f.userId(login) }));
    return ok({
      number: n,
      state: "open",
      assignee: as[0] ?? null,
      assignees: as,
      created_at: sec(issue.createdAt),
      user: { login: issue.author },
    });
  }
  if (sub === "/assignees" && (p.method === "POST" || p.method === "DELETE")) {
    if (f.writeFails(actor, `${p.method} assignees ${users.join(",")}`))
      return fail("HTTP 502: Bad Gateway");
    // A user without push access is silently ignored by POST (201, unchanged set).
    if (p.method === "POST") agentAdd(f, n, actor, users);
    else agentRemove(f, n, actor, users);
    after(f, actor, n);
    return ok({ number: n });
  }
  if (sub === "/timeline") {
    const events: unknown[] = [
      {
        event: "labeled",
        actor: { login: issue.author },
        created_at: sec(issue.createdAt),
        label: { name: "bug" },
      },
    ];
    for (const mu of f.visibleMutations(n))
      for (const s of mu.steps)
        events.push({
          id: mu.id,
          event: s.op === "add" ? "assigned" : "unassigned",
          actor: { login: mu.actor },
          assignee: { login: s.user },
          created_at: sec(mu.at),
        });
    for (const c of f.comments.filter((x) => x.issue === n))
      events.push({
        event: "commented",
        actor: { login: c.author },
        created_at: sec(c.at),
        body: c.body,
      });
    const assignment = p.jq?.includes('"assigned"') === true;
    return ndjson(
      assignment ? events.filter((e) => /"event":"(un)?assigned"/.test(JSON.stringify(e))) : events,
    );
  }
  if (sub === "/comments" && p.method === "POST")
    return writeComment(f, actor, n, p.fields.get("body")?.[0] ?? "");
  if (sub === "/comments")
    return ndjson(
      f.comments
        .filter((c) => c.issue === n)
        .map((c) => ({ id: c.id, body: c.body, user: { login: c.author }, created_at: sec(c.at) })),
    );
  return fail(`gh: unexpected ${p.method} ${p.path}`);
}

function gitlab(f: FakeForge, actor: string, p: Parsed): RunResult {
  if (p.path === "user")
    return f.knobs.identityFails
      ? fail("401 Unauthorized")
      : ok({ id: f.userId(actor), username: actor });
  const u = /^users\?username=(.+)$/.exec(p.path);
  if (u !== null) {
    const name = decodeURIComponent(u[1] ?? "");
    return ok([{ id: f.userId(name), username: name }]);
  }
  const m = /^projects\/acme%2Ftools%2Fwidgets\/issues\/(\d+)(\/notes)?(\?.*)?$/.exec(p.path);
  const issue = f.issues.get(Number(m?.[1]));
  if (m === null || issue === undefined) return fail("404 Not Found");
  const n = issue.n;
  if (m[2] === undefined && p.method === "PUT") {
    const ids = new URLSearchParams(m[3]?.slice(1) ?? "").getAll("assignee_ids[]").map(Number);
    if (f.writeFails(actor, `PUT assignee_ids ${ids.join(",")}`)) return fail("502 Bad Gateway");
    gitlabSet(
      f,
      n,
      actor,
      ids.map((id) => f.loginOf(id) ?? `unknown-${id}`),
    );
    after(f, actor, n);
    return ok({ iid: n });
  }
  if (m[2] === undefined) {
    const as = f.assignees(n, true).map((username) => ({ id: f.userId(username), username }));
    return ok({
      iid: n,
      assignee: as[0] ?? null,
      assignees: as,
      created_at: ms(issue.createdAt),
      author: { username: issue.author },
    });
  }
  if (p.method === "POST") return writeComment(f, actor, n, p.fields.get("body")?.[0] ?? "");
  const notes: { at: number; v: unknown }[] = [
    {
      at: issue.createdAt,
      v: {
        id: 1,
        system: true,
        body: "changed the description",
        author: { username: issue.author },
        created_at: ms(issue.createdAt),
      },
    },
  ];
  for (const mu of f.visibleMutations(n))
    notes.push({
      at: mu.at,
      v: {
        id: mu.id,
        system: true,
        body: gitlabNote(mu),
        author: { username: mu.actor },
        created_at: ms(mu.at),
      },
    });
  for (const r of f.rawNotes.filter((x) => x.issue === n))
    notes.push({
      at: r.at,
      v: {
        id: r.id,
        system: true,
        body: r.body,
        author: { username: r.author },
        created_at: ms(r.at),
      },
    });
  for (const c of f.comments.filter((x) => x.issue === n))
    notes.push({
      at: c.at,
      v: {
        id: c.id,
        system: false,
        body: c.body,
        author: { username: c.author },
        created_at: ms(c.at),
      },
    });
  notes.sort((a, b) => a.at - b.at);
  return ok(
    page(
      notes.map((x) => x.v),
      p.path,
      "per_page",
    ),
  );
}

function gitea(f: FakeForge, actor: string, p: Parsed): RunResult {
  if (p.path === "user")
    return f.knobs.identityFails
      ? fail("401 Unauthorized")
      : ok({ id: f.userId(actor), login: actor });
  if (p.path === "version") return ok({ version: f.knobs.giteaVersion });
  const m = /^repos\/acme\/widgets\/issues\/(\d+)(\/[a-z]+)?(\?.*)?$/.exec(p.path);
  const issue = f.issues.get(Number(m?.[1]));
  if (m === null || issue === undefined) return fail("404 Not Found");
  const n = issue.n;
  const sub = m[2] ?? "";
  const dedicated = !/^1\.(2[0-6]|1\d)\./.test(f.knobs.giteaVersion);
  if (sub === "" && p.method === "PATCH") {
    const list = listOf(p.data, "assignees");
    if (f.writeFails(actor, `PATCH assignees ${list.join(",")}`)) return fail("502 Bad Gateway");
    giteaPatch(f, n, actor, list);
    after(f, actor, n);
    return ok({ number: n });
  }
  if (sub === "") {
    const as = f.assignees(n, true).map((login) => ({ id: f.userId(login), login }));
    // Gitea serialises an empty assignee list as null.
    return ok({
      number: n,
      assignees: as.length === 0 ? null : as,
      created_at: sec(issue.createdAt),
      user: { login: issue.author },
    });
  }
  if (sub === "/assignees") {
    if (!dedicated) return fail("404 Not Found");
    const users = listOf(p.data, "assignees");
    if (f.writeFails(actor, `${p.method} assignees ${users.join(",")}`))
      return fail("502 Bad Gateway");
    if (p.method === "POST") agentAdd(f, n, actor, users);
    else agentRemove(f, n, actor, users);
    after(f, actor, n);
    return ok({ number: n });
  }
  if (sub === "/comments" && p.method === "POST")
    return writeComment(f, actor, n, String((p.data as { body?: unknown } | null)?.body ?? ""));
  const comments = f.comments.filter((c) => c.issue === n);
  if (sub === "/comments")
    return ok(
      page(
        comments.map((c) => ({
          id: c.id,
          body: c.body,
          user: { login: c.author },
          created_at: sec(c.at),
        })),
        p.path,
        "limit",
        f.knobs.pageCap,
      ),
    );
  if (sub === "/timeline") {
    const entries: { at: number; v: unknown }[] = [];
    for (const mu of f.visibleMutations(n))
      for (const s of mu.steps)
        entries.push({
          at: mu.at,
          v: {
            id: mu.id,
            type: "assignees",
            user: { login: mu.actor },
            assignee: { login: s.user },
            removed_assignee: s.op === "remove",
            created_at: sec(mu.at),
          },
        });
    for (const c of comments)
      entries.push({
        at: c.at,
        v: {
          id: c.id,
          type: "comment",
          user: { login: c.author },
          body: c.body,
          created_at: sec(c.at),
        },
      });
    entries.sort((a, b) => a.at - b.at);
    return ok(
      page(
        entries.map((x) => x.v),
        p.path,
        "limit",
        f.knobs.pageCap,
      ),
    );
  }
  return fail(`tea: unexpected ${p.method} ${p.path}`);
}

/** Answer one forge CLI invocation made with `actor`'s credential. */
export function wire(f: FakeForge, actor: string, argv: readonly string[]): RunResult {
  const [cli, sub, ...rest] = argv;
  const expected = { github: "gh", gitlab: "glab", gitea: "tea" }[f.forge];
  if (cli !== expected || sub !== "api")
    return fail(`${cli ?? "?"}: not the ${f.forge} CLI's api subcommand`);
  const p = parse(rest);
  if (f.forge === "github") return github(f, actor, p);
  if (f.forge === "gitlab") return gitlab(f, actor, p);
  return gitea(f, actor, p);
}
