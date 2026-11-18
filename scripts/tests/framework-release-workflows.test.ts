// Spec 0310 R6, R7, R9: the triggers, permissions, environment, secrets and build/publish split of the two
// framework release workflows. Each pin runs against the real file and against a mutated copy, so a pin that
// always passes is caught. The action pins and the built-ins-only closure are in
// framework-release-workflow-pins.test.ts.

import {
  COMMON,
  PRE,
  prereleaseDefects,
  replace,
  STABLE,
  stableDefects,
  suite,
} from "./lib/framework-release-workflows-kit.ts";

suite("prerelease workflow", PRE, prereleaseDefects, [
  ...COMMON("release-framework-prerelease-build", "release-framework-prerelease"),
  [
    "a branch trigger",
    replace("on:\n  push:\n", "on:\n  push:\n    branches: [main]\n"),
    "push is not the single tag filter",
  ],
  [
    "a dispatch trigger",
    replace("\npermissions:", "\n  workflow_dispatch:\n\npermissions:"),
    "triggers other than push",
  ],
  [
    "an environment on the publish job",
    replace(
      "    needs: release-framework-prerelease-build\n",
      "    needs: release-framework-prerelease-build\n    environment: framework-release\n",
    ),
    "declares an environment",
  ],
  [
    "an app secret",
    replace("${{ github.token }}", "${{ secrets.FRAMEWORK_RELEASE_APP_KEY }}"),
    "reads a secret",
  ],
]);

suite("stable workflow", STABLE, stableDefects, [
  ...COMMON("release-framework-stable-build", "release-framework-stable"),
  [
    "a tag trigger",
    replace(
      "on:\n  workflow_dispatch:",
      "on:\n  push:\n    tags: ['crewrig-v*']\n  workflow_dispatch:",
    ),
    "triggers other than workflow_dispatch",
  ],
  [
    "no environment",
    replace("    environment: framework-release\n", ""),
    "the environment is not on the publish job alone",
  ],
  [
    "the environment on the build job",
    replace(
      "  release-framework-stable-build: # ci-capability: release-framework-stable\n    runs-on: ubuntu-latest\n",
      "  release-framework-stable-build: # ci-capability: release-framework-stable\n    environment: framework-release\n    runs-on: ubuntu-latest\n",
    ),
    "the environment is not on the publish job alone",
  ],
  [
    "a secret in an early step",
    replace(
      "      - name: Floor guard accepts Node.js 24\n        run: node scripts/lib/node-floor-guard.js\n\n      - name: Download",
      "      - name: Floor guard accepts Node.js 24\n        env:\n          K: ${{ secrets.FRAMEWORK_RELEASE_APP_KEY }}\n        run: node scripts/lib/node-floor-guard.js\n\n      - name: Download",
    ),
    "a secret is used before the guard passes",
  ],
  ["no read duty", replace("APPROVER READ DUTY", "NOTE"), "header states no approver read duty"],
  [
    "write permission on contents",
    replace(
      "    permissions:\n      contents: read\n      id-token: write",
      "    permissions:\n      contents: write\n      id-token: write",
    ),
    "job permissions",
  ],
]);
