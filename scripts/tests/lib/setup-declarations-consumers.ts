// setup-declarations-consumers.ts — which declaration keys each suite that reads setup text will
// read once it is retargeted (plan v2 step B3b.5; the enumeration of plan-r3-static-reads.md, rows
// 1-20 of section A and the TS suites of section B). setup-declarations.test.ts asserts every key
// below exists in the printed declaration of every CLI the entry names, so a later retarget cannot
// reference a missing key. A key `step:<id>` means "a `step N: <id>` line is present".

import type { Cli } from "../../lib/setup/context.ts";

export interface Consumer {
  /** The suite, as plan-r3 names it. */
  readonly suite: string;
  readonly keys: readonly string[];
  /** The CLIs whose declaration carries the keys (default: all four). */
  readonly clis?: readonly Cli[];
}

const TRANSCRIPT_KEYS = [
  "step:hooks-rewrite-installed",
  "step:session-recording",
  "prompts.session-recording",
  "prompt.transcripts.options",
  "prompt.transcripts.header",
  "prompt.transcripts-confirm.header",
  "hooks.channel",
  "hooks.file",
  "hooks.src",
] as const;

export const CONSUMERS: readonly Consumer[] = [
  {
    suite: "scripts/tests/test-setup-mcp-merge.sh (r3 #1)",
    keys: ["step:mcp", "substeps.mcp", "mcp.target"],
  },
  {
    suite: "scripts/tests/test-setup-catalogue-picker.sh (r3 #2)",
    keys: [
      "step:rules-selection",
      "rules.pick-order",
      "rules.selection.team",
      "rules.selection.expertise",
      "rules.selection.level",
      "rules.marker.team",
      "rules.marker.expertise",
      "rules.marker.level",
      "prompt.catalogue.team.options",
    ],
  },
  {
    suite: "scripts/tests/test-setup-usage-capture-optin.sh (r3 #3, #20)",
    keys: [
      "step:session-recording",
      "step:usage-capture",
      "prompts.usage-capture",
      "prompt.usage-capture.options",
      "prompt.usage-capture-keep.options",
      "prompt.usage-capture.header",
      "usage-capture.strategy",
      "usage-capture.target",
    ],
  },
  {
    suite: "test-setup-claude-transcript.sh (r3 #4)",
    keys: [...TRANSCRIPT_KEYS, "hooks.env-patch"],
    clis: ["claude"],
  },
  { suite: "test-setup-gemini-transcript.sh (r3 #4)", keys: TRANSCRIPT_KEYS, clis: ["gemini"] },
  { suite: "test-setup-copilot-transcript.sh (r3 #4)", keys: TRANSCRIPT_KEYS, clis: ["copilot"] },
  {
    suite: "test-setup-antigravity-transcript.sh (r3 #4)",
    keys: [...TRANSCRIPT_KEYS, "hooks.unused-copy", "home.cli"],
    clis: ["antigravity"],
  },
  {
    suite: "scripts/tests/test-artifact-build-install-scope.sh (r3 #5)",
    keys: [
      "step:tiers",
      "tiers.automatic",
      "tiers.overlay",
      "tiers.overlay-prompts",
      "tiers.staging",
      "prompt.overlay.community.options",
      "prompt.overlay.org.options",
    ],
  },
  {
    suite: "scripts/tests/test-mcp-daemon.sh (r3 #6)",
    keys: ["step:mcp", "substeps.mcp", "mcp.handler"],
  },
  {
    suite: "scripts/tests/test-setup-mempalace-rc-guard.sh (r3 #7)",
    keys: ["step:mcp", "substeps.mcp"],
  },
  { suite: "scripts/tests/test-setup-org-mcp.sh (r3 #8)", keys: ["substeps.mcp", "mcp.target"] },
  {
    suite: "scripts/tests/test-setup-ensure-tier-built.sh (r3 #9)",
    keys: ["tiers.build-target", "tiers.library-staging", "tiers.gate"],
  },
  {
    suite: "scripts/tests/test-setup-validation-backend.sh (r3 #10)",
    keys: ["step:rules-shared", "prompts.rules-shared", "prompt.validation.backend.options"],
  },
  {
    suite: "scripts/tests/test-tls-delegation.sh (r3 #11, #20)",
    keys: [
      "step:tls-offer",
      "step:deps-install",
      "prompts.tls-offer",
      "prompt.tls-delegation.header",
    ],
  },
  {
    suite: "scripts/tests/test-system-context-store.sh (r3 #12)",
    keys: ["store-guidance", "rules.store", "home.rules"],
  },
  {
    suite: "scripts/tests/test-mempalace-doctor.sh (r3 #13)",
    keys: ["mcp.wrapper-script", "mcp.trust-wrapper", "mcp.wrapper-carrier"],
  },
  {
    suite: "scripts/tests/test-antigravity-component-install.sh (r3 #14)",
    keys: [
      "home.cli",
      "home.skills",
      "home.agents",
      "tiers.strategy",
      "tiers.migrates-superseded",
      "step:tiers",
      "step:migrate-superseded",
    ],
    clis: ["antigravity"],
  },
  {
    suite: "scripts/tests/test-setup-gemini-md-cleanup.sh (r3 #15, gemini)",
    keys: ["step:legacy-context-cleanup", "legacy.gemini-md", "legacy.marker"],
    clis: ["gemini"],
  },
  {
    suite: "scripts/tests/test-setup-gemini-md-cleanup.sh (r3 #15, antigravity)",
    keys: [
      "step:system-context-file",
      "system-context-file.target",
      "legacy.gemini-md",
      "legacy.marker",
    ],
    clis: ["antigravity"],
  },
  {
    suite: "scripts/tests/test-setup-gemini-settings-merge.sh (r3 #16)",
    keys: [
      "step:mcp",
      "substeps.mcp",
      "home.settings",
      "step:usage-capture",
      "step:hooks-rewrite-installed",
    ],
    clis: ["gemini"],
  },
  {
    suite: "scripts/tests/test-setup-init-command-instructions.sh (r3 #17)",
    keys: ["init.soul", "init.profile"],
  },
  {
    suite: "scripts/check-gemini-overlay-enrollment.sh (r3 #18)",
    keys: [
      "rules.shared.1",
      "rules.selection.team",
      "rules.selection.expertise",
      "rules.selection.level",
      "rules.profile",
    ],
    clis: ["gemini"],
  },
  {
    suite: "scripts/tests/test-component-tier-resolution.sh (r3 #19)",
    keys: ["home.skills", "tiers.staging"],
  },
  {
    suite: "scripts/tests/test-component-tier-resolution.sh (r3 #19, agents)",
    keys: ["home.agents"],
    clis: ["claude", "gemini", "antigravity"],
  },
  {
    suite: "scripts/tests/hook-transcript-floor.test.ts (r3 B)",
    keys: ["step:session-recording", "hooks.env-patch", "hooks.leading-blank"],
  },
  {
    suite: "scripts/tests/hook-guard-setup.test.ts (r3 B)",
    keys: [
      "step:hooks-rewrite-installed",
      "step:session-recording",
      "substeps.hooks-rewrite-installed",
    ],
  },
  {
    suite: "scripts/tests/setup-dependency-step.test.ts (r3 B)",
    keys: ["step:tls-offer", "step:deps-install", "step:tiers"],
  },
];
