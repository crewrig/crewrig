---
name: deviation-merge-key
base: &base
  context: from-anchor
  enable_write_tools: true
claude:
  <<: *base
  agent: own-agent
antigravity:
  <<: *base
---
Body of the merge-key fixture.
