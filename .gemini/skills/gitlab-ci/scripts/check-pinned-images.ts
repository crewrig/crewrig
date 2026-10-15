// check-pinned-images.ts — flag GitLab CI container references that are not pinned to an immutable
// @sha256: digest (the TypeScript entry of check-pinned-images.sh; same text scan, same output).
//
// Usage: node check-pinned-images.ts <pipeline-file-or-directory>
//
// Scanned surface (text scan; no registry call, no Docker, no live GitLab):
//   - `image: <ref>` (job-level, global, and default:)
//   - `image:` long form, its `name: <ref>`
//   - `services:` list entries: `- <ref>` and `- name: <ref>` / `name: <ref>`
// Directory mode scans `<dir>/.gitlab-ci.yml` plus any YAML under `<dir>/.gitlab/`. A bare variable
// reference with no tag (for example a registry-image variable) is skipped.
//
// Exit: 0 all pinned or nothing to scan, 1 a finding or a bad target, 2 usage.
//
// Self-contained on purpose: one file, no import, runs under any package type (spec 0258).

process.removeAllListeners("warning");

void (async () => {
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");
  await Promise.resolve();

  const tty = process.stdout.isTTY === true;
  const RED = tty ? "\u001b[0;31m" : "";
  const GREEN = tty ? "\u001b[0;32m" : "";
  const RESET = tty ? "\u001b[0m" : "";

  // Output is collected as latin1 text (file content is read as latin1) and written as bytes; a
  // path is re-expressed as its UTF-8 bytes so it survives the round trip.
  const out: string[] = [];
  const err: string[] = [];
  const bytes = (s: string): string => Buffer.from(s, "utf8").toString("latin1");
  const flush = (): void => {
    if (out.length > 0) process.stdout.write(Buffer.from(out.join(""), "latin1"));
    if (err.length > 0) process.stderr.write(Buffer.from(err.join(""), "latin1"));
  };

  const name = path.basename(process.argv[1] ?? "check-pinned-images.ts");
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    err.push(`Usage: ${name} <pipeline-file-or-directory>\n`);
    process.exitCode = 2;
    flush();
    return;
  }
  const target = args[0] ?? "";

  const kindOf = (p: string): "dir" | "file" | "none" => {
    try {
      const st = fs.statSync(p);
      return st.isDirectory() ? "dir" : st.isFile() ? "file" : "none";
    } catch {
      return "none";
    }
  };

  // find -type f under a directory: lstat enumeration, symlinked files and directories skipped.
  const walk = (dir: string, acc: string[]): void => {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names) {
      const p = `${dir}/${n}`;
      const st = fs.lstatSync(p, { throwIfNoEntry: false });
      if (st === undefined) continue;
      if (st.isDirectory()) walk(p, acc);
      else if (st.isFile() && (n.endsWith(".yml") || n.endsWith(".yaml"))) acc.push(p);
    }
  };

  const files: string[] = [];
  const targetKind = kindOf(target);
  if (targetKind === "dir") {
    if (kindOf(`${target}/.gitlab-ci.yml`) === "file") files.push(`${target}/.gitlab-ci.yml`);
    const sub = `${target}/.gitlab`;
    if (kindOf(sub) === "dir" && !fs.lstatSync(sub).isSymbolicLink()) {
      const found: string[] = [];
      walk(sub, found);
      found.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
      files.push(...found);
    }
  } else if (targetKind === "file") {
    files.push(target);
  } else {
    err.push(`${RED}[FAIL] not a file or directory: ${bytes(target)}${RESET}\n`);
    process.exitCode = 1;
    flush();
    return;
  }
  if (files.length === 0) {
    out.push(`no GitLab pipeline file found under: ${bytes(target)}\n`);
    flush();
    return;
  }

  const DIGEST = /@sha256:[0-9a-fA-F]{64}$/;
  const IMAGE = /^[ \t\n\v\f\r]*image:[ \t\n\v\f\r]*([^]*)$/;
  const SERVICES = /^[ \t\n\v\f\r]*services:[ \t\n\v\f\r]*$/;
  const NAME = /^[ \t\n\v\f\r]*-?[ \t\n\v\f\r]*name:[ \t\n\v\f\r]*([^ \t\n\v\f\r#]+)/;
  const ITEM = /^[ \t\n\v\f\r]*-[ \t\n\v\f\r]+([^ \t\n\v\f\r#]+)/;
  const TRIM = /^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g;
  const LTRIM = /^[ \t\n\v\f\r]+/;

  // Each quote kind is stripped independently: trailing then leading double, then single.
  const unquote = (s: string): string => {
    let v = s;
    if (v.endsWith('"')) v = v.slice(0, -1);
    if (v.startsWith('"')) v = v.slice(1);
    if (v.endsWith("'")) v = v.slice(0, -1);
    if (v.startsWith("'")) v = v.slice(1);
    return v;
  };

  let violations = 0;
  // A finding is counted and printed; an empty value and a bare `$VAR` (no tag, no digest) are
  // not applicable.
  const checkRef = (raw: string, file: string, lineno: number): void => {
    const value = unquote(raw);
    if (value === "") return;
    if (value.startsWith("$") && !value.includes(":") && !value.includes("@")) return;
    if (DIGEST.test(value)) return;
    out.push(`${RED}[UNPINNED]${RESET} ${bytes(file)}:${String(lineno)}: ${value}\n`);
    violations += 1;
  };

  for (const f of files) {
    let text: string;
    try {
      text = fs.readFileSync(f, "latin1").replaceAll("\0", "");
    } catch {
      err.push(`${name}: ${bytes(f)}: cannot read the file\n`);
      process.exitCode = 1;
      flush();
      return;
    }
    const lines = text.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    let inImage = false;
    let inServices = false;
    let blockIndent = -1;
    lines.forEach((line, i) => {
      const lineno = i + 1;
      const stripped = line.replace(LTRIM, "");
      const indent = line.length - stripped.length;
      if ((inImage || inServices) && stripped !== "" && indent <= blockIndent) {
        inImage = false;
        inServices = false;
        blockIndent = -1;
      }
      const image = IMAGE.exec(line);
      if (image !== null) {
        const cut = (image[1] ?? "").split("#")[0] ?? "";
        const val = cut.replace(TRIM, "");
        if (val !== "") {
          checkRef(val, f, lineno);
        } else {
          inImage = true;
          inServices = false;
          blockIndent = indent;
        }
        return;
      }
      if (SERVICES.test(line)) {
        inServices = true;
        inImage = false;
        blockIndent = indent;
        return;
      }
      if (inImage || inServices) {
        const named = NAME.exec(line);
        if (named !== null) {
          checkRef(named[1] ?? "", f, lineno);
          return;
        }
      }
      if (inServices) {
        const item = ITEM.exec(line);
        if (item !== null) checkRef(item[1] ?? "", f, lineno);
      }
    });
  }

  if (violations === 0) {
    out.push(`${GREEN}[OK]${RESET} all image/service references are pinned to a @sha256: digest\n`);
  } else {
    err.push(`${RED}${String(violations)} unpinned image/service reference(s) found${RESET}\n`);
    process.exitCode = 1;
  }
  flush();
})();
