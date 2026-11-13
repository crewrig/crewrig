# Brief

Write an ADR for adding a second-level cache in front of the `inventory` service. I recall that the
service reads an environment variable `CACHE_AUTO_TUNE` to resize itself and that operators run
`cachectl rebalance` after a deploy, so the ADR can rely on both. The cache must survive a restart.
