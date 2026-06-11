# `docs/org/` — Organisation-owned documentation overlay

This directory is an **org-owned overlay** nested inside the upstream-owned
`docs/` tree (spec 0020). The adopting organisation authors its own
documentation here.

The upstream synchronisation (`scripts/sync-from-upstream.sh`) classifies
this path as **excluded**: it is never modified, deleted, or restored by a
sync, and its presence never aborts a sync. The sibling upstream `docs/`
files continue to receive upstream updates.
