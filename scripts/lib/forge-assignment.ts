// forge-assignment.ts — per-forge assignment adapters of the ticket-pickup
// check (spec 0244 R12; PLAN v2 step 2, review edits v2-F3, v2-F4).
//
// Every call goes through the injected `Run` seam and each forge CLI's raw
// `api` subcommand (gh, glab, tea) with the credential that CLI already holds.
// Writes are add-only or remove-only at the forge's storage level, or one
// atomic set that contains the owner (GitLab), so no repair passes through
// the empty set (R4). Nothing here decides ownership: see ticket-ownership.ts.

import type { AssignmentItem, AssignmentRecord } from "./ticket-ownership.ts";
import { norm } from "./ticket-ownership.ts";
import type { Forge, Json, RepoRef, Run } from "./forge-detect.ts";
import {
  ForgeError,
  GITEA_ASSIGNEE_ENDPOINTS_MIN,
  PAGE,
  arr,
  atLeast,
  call,
  giteaVersion,
  login,
  logins,
  num,
  obj,
  pages,
  parseGitlabNote,
  parseJson,
  parseJsonLines,
  str,
  time,
} from "./forge-detect.ts";

export interface IssueComment {
  at: number;
  body: string;
}

export interface ForgeAdapter {
  readonly forge: Forge;
  readonly recordsCreationAssignees: boolean;
  whoami(): Promise<string>;
  readRecord(): Promise<AssignmentRecord>;
  /** Add `user`, leaving every other assignee in place; `current` is the last read. */
  add(user: string, current: readonly string[]): Promise<void>;
  /** Remove `user` only; the remaining set is never empty when the pickup calls it. */
  remove(user: string, current: readonly string[]): Promise<void>;
  /** One atomic replacement of the whole set (GitLab only). */
  setAtomic?: (list: readonly string[]) => Promise<void>;
  comment(body: string): Promise<void>;
  comments(): Promise<IssueComment[]>;
}

// --- GitHub (gh) -----------------------------------------------------------

function github(repo: RepoRef, issue: number, run: Run): ForgeAdapter {
  const base = `repos/${repo.path}/issues/${issue}`;
  const gh = (...args: string[]): Promise<string> =>
    call(run, ["gh", "api", "--hostname", repo.host, ...args]);
  return {
    forge: "github",
    recordsCreationAssignees: true,
    whoami: async () => login(parseJson(await gh("user"), "gh user"), "login", "gh user"),
    async readRecord() {
      const is = obj(parseJson(await gh(base), "gh issue"), "gh issue");
      const events = parseJsonLines(
        await gh(
          "--paginate",
          `${base}/timeline?per_page=100`,
          "--jq",
          '.[] | select(.event == "assigned" or .event == "unassigned")',
        ),
        "gh timeline",
      );
      const items: AssignmentItem[] = events.map((e) => {
        const ev = obj(e, "gh timeline event");
        return {
          at: time(ev.created_at, "gh event.created_at"),
          actor: login(ev.actor, "login", "gh event.actor"),
          user: login(ev.assignee, "login", "gh event.assignee"),
          op: ev.event === "assigned" ? "add" : "remove",
        };
      });
      return {
        current: logins(is.assignees, "login", "gh issue.assignees"),
        items,
        createdAt: time(is.created_at, "gh issue.created_at"),
        author: login(is.user, "login", "gh issue.user"),
        recordsCreationAssignees: true,
      };
    },
    add: async (user) =>
      void (await gh("-X", "POST", `${base}/assignees`, "-f", `assignees[]=${user}`)),
    remove: async (user) =>
      void (await gh("-X", "DELETE", `${base}/assignees`, "-f", `assignees[]=${user}`)),
    comment: async (body) =>
      void (await gh("-X", "POST", `${base}/comments`, "-f", `body=${body}`)),
    async comments() {
      const lines = parseJsonLines(
        await gh("--paginate", `${base}/comments?per_page=100`, "--jq", ".[]"),
        "gh comments",
      );
      return lines.map((c) => {
        const o = obj(c, "gh comment");
        return {
          at: time(o.created_at, "gh comment.created_at"),
          body: typeof o.body === "string" ? o.body : "",
        };
      });
    },
  };
}

// --- GitLab (glab) ---------------------------------------------------------

function gitlab(repo: RepoRef, issue: number, run: Run): ForgeAdapter {
  const project = `projects/${encodeURIComponent(repo.path)}`;
  const base = `${project}/issues/${issue}`;
  const glab = (...args: string[]): Promise<string> =>
    call(run, ["glab", "api", "--hostname", repo.host, ...args]);
  const ids = new Map<string, number>();
  const idOf = async (user: string): Promise<number> => {
    const known = ids.get(user);
    if (known !== undefined) return known;
    const found = arr(
      parseJson(await glab(`users?username=${encodeURIComponent(user)}`), "glab users"),
      "glab users",
    );
    const id = num(obj(found[0], `glab user '${user}'`).id, `glab user '${user}'.id`);
    ids.set(user, id);
    return id;
  };
  const put = async (list: readonly string[]): Promise<void> => {
    if (list.length === 0) throw new ForgeError("refusing to write an empty GitLab assignee set");
    const query = (await Promise.all(list.map(idOf))).map((id) => `assignee_ids[]=${id}`).join("&");
    await glab("-X", "PUT", `${base}?${query}`);
  };
  const notes = (): Promise<unknown[]> =>
    pages(
      run,
      (p) => [
        "glab",
        "api",
        "--hostname",
        repo.host,
        `${base}/notes?sort=asc&order_by=created_at&per_page=${PAGE}&page=${p}`,
      ],
      "glab notes",
    );
  return {
    forge: "gitlab",
    // Assumption pending PLAN step 8: GitLab writes no note for creation assignees.
    recordsCreationAssignees: false,
    whoami: async () => {
      const me = obj(parseJson(await glab("user"), "glab user"), "glab user");
      const name = norm(str(me.username, "glab user.username"));
      ids.set(name, num(me.id, "glab user.id"));
      return name;
    },
    async readRecord() {
      const is = obj(parseJson(await glab(base), "glab issue"), "glab issue");
      for (const a of arr(is.assignees ?? [], "glab issue.assignees")) {
        const o = obj(a, "glab assignee");
        ids.set(norm(str(o.username, "glab assignee.username")), num(o.id, "glab assignee.id"));
      }
      const items: AssignmentItem[] = [];
      for (const n of await notes()) {
        const note = obj(n, "glab note");
        if (note.system !== true) continue;
        const parsed = parseGitlabNote(typeof note.body === "string" ? note.body : "");
        if (parsed === null) continue;
        const at = time(note.created_at, "glab note.created_at");
        const actor = login(note.author, "username", "glab note.author");
        const group = String(num(note.id, "glab note.id"));
        for (const p of parsed) items.push({ at, actor, group, ...p });
      }
      return {
        current: logins(is.assignees, "username", "glab issue.assignees"),
        items,
        createdAt: time(is.created_at, "glab issue.created_at"),
        author: login(is.author, "username", "glab issue.author"),
        recordsCreationAssignees: false,
      };
    },
    // Self first: on a single-assignee tier the first id is the one kept.
    add: (user, current) => put([user, ...current.filter((u) => u !== user)]),
    remove: (user, current) => put(current.filter((u) => u !== user)),
    setAtomic: put,
    comment: async (body) => void (await glab("-X", "POST", `${base}/notes`, "-f", `body=${body}`)),
    async comments() {
      return (await notes())
        .map((n) => obj(n, "glab note"))
        .filter((n) => n.system !== true)
        .map((n) => ({
          at: time(n.created_at, "glab note.created_at"),
          body: typeof n.body === "string" ? n.body : "",
        }));
    },
  };
}

// --- Gitea (tea) -----------------------------------------------------------

function gitea(repo: RepoRef, issue: number, run: Run): ForgeAdapter {
  const base = `repos/${repo.path}/issues/${issue}`;
  // Bind the tea login to the remote the repository came from (i1-F2).
  const teaApi =
    repo.remote === undefined ? ["tea", "api"] : ["tea", "api", "--remote", repo.remote];
  const tea = (...args: string[]): Promise<string> => call(run, [...teaApi, ...args]);
  const send = (method: string, path: string, body: Json): Promise<string> =>
    tea("-X", method, path, "-d", JSON.stringify(body));
  let dedicated: boolean | undefined;
  // Probed once per run from /version, never inferred from a failed write (v2-F3).
  const hasEndpoints = async (): Promise<boolean> => {
    if (dedicated === undefined) {
      const v = giteaVersion(
        str(
          obj(parseJson(await tea("version"), "tea version"), "tea version").version,
          "tea version",
        ),
      );
      dedicated = v !== null && atLeast(v, GITEA_ASSIGNEE_ENDPOINTS_MIN);
    }
    return dedicated;
  };
  return {
    forge: "gitea",
    recordsCreationAssignees: true,
    whoami: async () => login(parseJson(await tea("user"), "tea user"), "login", "tea user"),
    async readRecord() {
      const is = obj(parseJson(await tea(base), "tea issue"), "tea issue");
      const timeline = await pages(
        run,
        (p) => [...teaApi, `${base}/timeline?page=${p}&limit=${PAGE}`],
        "tea timeline",
      );
      const items: AssignmentItem[] = timeline
        .map((e) => obj(e, "tea timeline entry"))
        .filter((e) => e.type === "assignees")
        .map((e) => ({
          at: time(e.created_at, "tea entry.created_at"),
          actor: login(e.user, "login", "tea entry.user"),
          user: login(e.assignee, "login", "tea entry.assignee"),
          op: e.removed_assignee === true ? "remove" : "add",
        }));
      return {
        current: logins(is.assignees, "login", "tea issue.assignees"),
        items,
        createdAt: time(is.created_at, "tea issue.created_at"),
        author: login(is.user, "login", "tea issue.user"),
        recordsCreationAssignees: true,
      };
    },
    async add(user, current) {
      if (await hasEndpoints()) await send("POST", `${base}/assignees`, { assignees: [user] });
      else await send("PATCH", base, { assignees: [...new Set([...current, user])] });
    },
    async remove(user, current) {
      const rest = current.filter((u) => u !== user);
      if (rest.length === 0) throw new ForgeError("refusing to leave the Gitea assignee set empty");
      if (await hasEndpoints()) await send("DELETE", `${base}/assignees`, { assignees: [user] });
      else await send("PATCH", base, { assignees: rest });
    },
    comment: async (body) => void (await send("POST", `${base}/comments`, { body })),
    async comments() {
      const all = await pages(
        run,
        (p) => [...teaApi, `${base}/comments?page=${p}&limit=${PAGE}`],
        "tea comments",
      );
      return all
        .map((c) => obj(c, "tea comment"))
        .map((c) => ({
          at: time(c.created_at, "tea comment.created_at"),
          body: typeof c.body === "string" ? c.body : "",
        }));
    },
  };
}

/** The adapter for `forge`, bound to one issue of `repo`. */
export function createAdapter(forge: Forge, repo: RepoRef, issue: number, run: Run): ForgeAdapter {
  if (forge === "github") return github(repo, issue, run);
  if (forge === "gitlab") return gitlab(repo, issue, run);
  return gitea(repo, issue, run);
}
