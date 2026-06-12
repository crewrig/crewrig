# `docs/org/` — Organization-owned documentation overlay

<!-- crewrig-doc: published=false -->

This directory is an **org-owned overlay** nested inside the upstream-owned
`docs/` tree (spec 0020). The adopting organization authors its own
documentation here.

The upstream synchronization (`scripts/sync-from-upstream.sh`) classifies
this path as **excluded**: it is never modified, deleted, or restored by a
sync, and its presence never aborts a sync. The sibling upstream `docs/`
files continue to receive upstream updates.

## Publication contract for overlay pages

Organization documentation pages under `docs/org/` use the **identical**
metadata-block contract as core pages (spec 0027). Each published overlay
page carries a `crewrig-doc` HTML comment immediately after its H1, declaring
`section`, `nav_order`, `published`, and `title` against the same eight-section
taxonomy. The full grammar lives in
[`docs/publication-contract.md`](../publication-contract.md).

Because `docs/org/` is `excluded` from upstream sync, overlay pages never flow
back to CrewRig — the upstream `docs/index.json` is generated over the core
`docs/**` tree only and contains no overlay entries. The organization builds
its **own** site by running its own index generation over `docs/org/**` and
**unioning** that overlay manifest with the upstream `docs/index.json`, so
core and overlay pages render under one navigation tree against the same
contract (spec 0027 R7, R8). The upstream generator deliberately does not scan
`docs/org/`; keeping the two manifests separate is what preserves the
no-propagation guarantee.
