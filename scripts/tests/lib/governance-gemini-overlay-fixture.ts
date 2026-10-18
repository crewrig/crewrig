// governance-gemini-overlay-fixture.ts — fixture builders of the Gemini overlay enrollment
// cases (spec 0265, row J2, P6). Ports of the Bash helpers declaration_fact, make_printer,
// make_printer_exiting_1 and make_settings of test-check-gemini-overlay-enrollment.sh.
//
// API:
//   MAIN_DEPLOYED                 the 9 overlays the current-main Gemini setup deploys
//   MAIN_ENROLLED                 MAIN_DEPLOYED plus the AGENTS.md exception
//   declarationFact(name, n)      the `"key": "value"` JSON member of one deployed overlay
//   makePrinter(repo, names)      stand-in declaration printer deploying exactly `names`
//   makePrinterExiting1(repo)     stand-in printer: exit 1, nothing on stdout
//   makePrinterFailingAfterDeclaring(repo)  declares MAIN_DEPLOYED, then exits 1
//   makeSettings(repo, names)     config/gemini/settings.json enrolling exactly `names`
// Every builder writes only below `repo`, which the caller created with makeSandbox().

import fs from "node:fs";
import path from "node:path";

export const MAIN_DEPLOYED: readonly string[] = [
  "00_SOUL.md",
  "10_USER_LEVEL.md",
  "20_ORGANIZATION.md",
  "30_USER_PROFILE.md",
  "40_USER_EXPERTISE.md",
  "50_USER_TEAM.md",
  "60_TOOLS.md",
  "65_TOOLS.md",
  "66_ORG_RULES.md",
];

export const MAIN_ENROLLED: readonly string[] = [...MAIN_DEPLOYED, "AGENTS.md"];

/** The JSON member the real declaration carries for one deployed overlay. */
export function declarationFact(name: string, n: number): string {
  switch (name) {
    case "30_USER_PROFILE.md":
      return `"rules.profile": "method config/PROFILE.md -> <HOME>/.gemini/${name}"`;
    case "10_USER_LEVEL.md":
      return `"rules.selection.level": "config/level/{name}.md -> <HOME>/.gemini/${name}"`;
    case "40_USER_EXPERTISE.md":
      return `"rules.selection.expertise": "config/expertise/{name}.md -> <HOME>/.gemini/${name}"`;
    case "50_USER_TEAM.md":
      return `"rules.selection.team": "config/teams/{name}.md -> <HOME>/.gemini/${name}"`;
    case "66_ORG_RULES.md":
      return `"rules.shared.${n}": "AGENTS.org.md -> <HOME>/.gemini/${name} (optional)"`;
    default:
      return `"rules.shared.${n}": "config/x.md -> <HOME>/.gemini/${name}"`;
  }
}

function writePrinter(repo: string, body: string): void {
  const dir = path.join(repo, "scripts", "tests", "lib");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "print-setup-declarations.ts"), body);
}

function declarationScript(names: readonly string[]): string {
  const members = [
    '"rules.store": "artifacts/core/system-context -> <HOME>/.crewrig/system-context"',
  ];
  names.forEach((name, i) => members.push(declarationFact(name, i + 1)));
  return (
    "// Fixture stand-in for scripts/tests/lib/print-setup-declarations.ts.\n" +
    `process.stdout.write(JSON.stringify({cli: 'gemini', banner: 'fixture', steps: ['banner'], facts: {${members.join(", ")}}}) + '\\n');\n`
  );
}

export function makePrinter(repo: string, names: readonly string[]): void {
  writePrinter(repo, declarationScript(names));
}

export function makePrinterExiting1(repo: string): void {
  writePrinter(
    repo,
    'process.stderr.write("the gemini descriptor is empty\\n"); process.exit(1);\n',
  );
}

export function makePrinterFailingAfterDeclaring(repo: string): void {
  writePrinter(repo, `${declarationScript(MAIN_DEPLOYED)}process.exitCode = 1;\n`);
}

export function makeSettings(repo: string, names: readonly string[]): void {
  fs.mkdirSync(path.join(repo, "config", "gemini"), { recursive: true });
  const list = names.map((n) => `      "${n}"`).join(",\n");
  fs.writeFileSync(
    path.join(repo, "config", "gemini", "settings.json"),
    `{\n  "context": {\n    "fileName": [\n${list}${names.length > 0 ? "\n" : ""}    ]\n  }\n}\n`,
  );
}
