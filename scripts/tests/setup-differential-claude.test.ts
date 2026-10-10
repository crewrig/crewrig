// setup-differential-claude.test.ts — the forwarding-parity proof (shim against TypeScript entry) of setup-claude-interactive (spec 0256 requirement 10).
import { defineDifferentialSuite } from "./lib/setup-differential-suite.ts";

defineDifferentialSuite("claude");
