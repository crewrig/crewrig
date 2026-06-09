---
name: crewrig-assembly-test-agent
description: Fixture agent used by the assembly verification test. Do not invoke in production.
metadata:
  provenance:
    version: "1.0.0"
    canonical: "https://github.com/crewrig/crewrig"
    feedback: "https://github.com/crewrig/crewrig"
---

# Assembly Test Agent

This agent is a minimal fixture used by `scripts/tests/test-assembly-verification.sh`.
It exists to verify that overlay agents are assembled into every supported CLI's
output directory during `bash scripts/build-components.sh`.
