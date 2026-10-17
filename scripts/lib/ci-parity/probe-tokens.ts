// probe-tokens.ts — command normalisation and the tool-install classifier (spec 0049 R4, R3).

/** `normalize_cmd`: whitespace runs to one space, trim, strip one leading `sudo `. */
export function normalizeCmd(s: string): string {
  let n = s.replace(/[\n\t]/g, " ").replace(/ {2,}/g, " ");
  if (n.startsWith(" ")) n = n.slice(1);
  if (n.endsWith(" ")) n = n.slice(0, -1);
  return n.startsWith("sudo ") ? n.slice(5) : n;
}

/** `install_recipe_tool`: the tool a normalised `run:` body installs, or "". */
export function installRecipeTool(c: string): string {
  const has = (...parts: string[]): boolean => {
    let from = 0;
    for (const p of parts) {
      const i = c.indexOf(p, from);
      if (i < 0) return false;
      from = i + p.length;
    }
    return true;
  };
  if (has("yq_linux_amd64") || has("mikefarah/yq")) return "yq";
  if (has("taskfile.dev")) return "task";
  if (has("markdownlint-cli")) return "markdownlint-cli";
  if (has("tesseract")) return "tesseract";
  if (has("python3")) return "python3";
  if (has("jq-linux-amd64") || has("jqlang/jq")) return "jq";
  if (has("apt-get", "install", "jq") || has("install", "-y", "jq")) return "jq";
  return "";
}

/** `self_installs_tool`: one of the command entries installs `want` itself. */
export function selfInstallsTool(cmds: string, want: string): boolean {
  return cmds.split("\n").some((line) => installRecipeTool(normalizeCmd(line)) === want);
}

/** `in_list_prefix`: some entry of the newline list starts with `prefix`. */
export function inListPrefix(prefix: string, list: readonly string[]): boolean {
  return `\n${list.join("\n")}`.includes(`\n${prefix}`);
}
