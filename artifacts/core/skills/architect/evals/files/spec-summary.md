# Spec 0042 (summary)

Complexity standard. The sync agent SHALL receive change notifications within 5 seconds instead of
polling every 60 seconds. The change touches `agent/poller.ts`, `agent/config.ts`, the deployment
manifest `deploy/agent.yaml` and the public configuration key `sync.interval`, which three teams
set in their own repositories. A rollback must be possible without a data migration.
