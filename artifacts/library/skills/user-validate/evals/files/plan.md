# Plan: retry budget for the sync worker

1. Add a retry budget of 3 attempts to the sync worker.
2. Back off exponentially with full jitter between attempts.
3. Emit a `sync_retry_exhausted` metric when the budget runs out.
