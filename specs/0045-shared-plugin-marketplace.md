---
id: "0045"
slug: shared-plugin-marketplace
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 360
version: 1.0.0
---

# Shared plugin marketplace for installed Claude extensions

## Intent

A user who installs Claude Code plugins built from more than one crewrig
extension sees every installed plugin listed together and resolvable at
once, and each plugin keeps working after the user switches the
repository to a different branch. Today, installing a second extension's
plugin silently unregisters the first, and any installed plugin can go
stale or empty the moment the working tree changes branch; this spec
makes multi-extension installs coexist in one durable registry that
survives branch switches.

## Requirements

1. **Coexistence.** Installing the plugin for a second extension SHALL
   NOT remove or unregister the plugin previously installed for any
   other extension.
2. **Shared listing.** Plugins built from multiple extensions SHALL
   coexist in a single shared local registry and SHALL be listed
   together.
3. **Branch-switch durability.** An installed plugin SHALL remain
   registered and resolvable across repository branch switches; its
   registration MUST NOT depend on the state of the repository working
   tree.
4. **Registry location.** The installed marketplace registry SHALL
   reside outside the repository working tree, under the user's Claude
   configuration root, as a single shared registry common to every
   installed extension.
5. **Idempotent re-install.** Re-installing the same extension SHALL
   update that extension's entry in place and SHALL NOT create a
   duplicate entry for it.
6. **Claude-only fix.** The fix SHALL apply to the Claude install path
   only; no equivalent script SHALL be required for Gemini CLI or
   GitHub Copilot CLI, since Gemini consumes extensions in place and
   Copilot has no extension surface.
7. **Parity-matrix update.** The CLI parity matrix SHALL be updated to
   record the new location of the Claude install output, so that the
   documented integration surface stays coherent with the implemented
   behavior.

## Scenarios

**Scenario:** Two extensions coexist after sequential installs

Given the user has installed the Claude plugin for extension A
When the user installs the Claude plugin for extension B
Then the plugin for extension A SHALL still be registered and resolvable
And the plugin for extension B SHALL also be registered and resolvable
And both plugins SHALL appear together in the single shared registry.

**Scenario:** Installed plugin survives a branch switch

Given the user has installed the Claude plugin for an extension
When the user switches the repository to a different branch
Then the previously installed plugin SHALL remain registered and
  resolvable
And its registration SHALL NOT have become stale or empty as a result
  of the working-tree change.

**Scenario:** Re-installing the same extension is idempotent

Given the user has already installed the Claude plugin for an extension
When the user installs the Claude plugin for that same extension again
Then the registry SHALL contain exactly one entry for that extension
And that entry SHALL reflect the latest install
And no other extension's entry SHALL be affected.

**Scenario:** Failed install leaves the shared registry intact

Given the user has installed the Claude plugins for one or more extensions
When the user attempts to install a plugin for a name that resolves to no
  extension
Then the install SHALL fail without modifying the shared registry
And every previously installed plugin SHALL remain registered and
  resolvable.

## Out of scope

- Garbage-collection or pruning of registry entries for extensions that
  were later deleted or renamed: the shared registry upserts entries but
  does not remove orphaned ones; reclaiming stale entries is deliberately
  excluded from this spec.
- Any change to the Gemini CLI or GitHub Copilot CLI install or
  discovery paths; their extension-consumption locations are unchanged.
- Any change to the contract of the Claude plugin *build* step, which
  still accepts an explicit output directory; only the location the
  *install* step chooses for the shared registry changes.

## Open questions

(none — the registry location was resolved at qualification time: the
shared registry lives outside the working tree under the user's Claude
configuration root, concretely `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/local-marketplace/`,
recorded here for traceability only; the concrete path is a HOW detail
for the PLAN stage and is intentionally absent from the requirements.)
