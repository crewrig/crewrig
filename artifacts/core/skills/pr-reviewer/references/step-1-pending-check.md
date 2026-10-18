# Step 1: waiting on a pending check

## Waiting on a pending check

A `run_in_background` task or the `Monitor` tool's completion signal is
a hint, never proof. Both watch a process from outside the check
itself, and either can report "done" while the check the forge actually
tracks is still pending, still queued, or has since been re-triggered.
Treat either signal as a cue to look, not as the look itself.

Whenever a required check was observed `pending` at any point during
the current review pass, the last thing done before composing the
verdict — no matter how that wait was carried out — is one direct,
synchronous query of the check's live state: `gh pr checks <number>` or
the equivalent `gh api repos/<owner>/<repo>/commits/<sha>/check-runs`
call. A verdict is never written off a background or monitor signal
alone; the direct query is what the CI status section actually reports.

The recommended way to wait in the first place is a foreground bounded
retry loop — fixed attempt count, fixed inter-attempt delay, run
synchronously in the reviewer's own turn — rather than a background
task or a live monitor, because the loop's own exit condition already
*is* the direct query:

```bash
for i in $(seq 1 10); do
  gh pr checks <number> --repo <owner/repo>
  rc=$?
  [ "$rc" -ne 8 ] && break   # anything but "still pending" ends the wait
  sleep 30
done
```

`gh pr checks` exits `8` specifically for "checks pending"; any other
exit code — `0` (all passing) or a non-zero, non-`8` failure — means the
checks have already resolved, one way or the other, and the wait is
over. Whether the loop ends by resolving or by exhausting its attempts,
what happens next is unchanged: the R2 direct, synchronous query above
is what actually determines the check's bucket (`pass`, `fail`, or
`pending`). Never assume a bucket from the loop's exit alone — a
required check that failed throughout the wait window must not be
reported as still pending.

A non-`8` exit is not automatically a resolved-failing check, though:
`gh help exit-codes` documents that any command failure — network
hiccup, timeout, rate-limit — also returns the same generic exit `1`
as a genuine check failure, so the loop alone cannot tell the two
apart. The R2 direct, synchronous query is what disambiguates them,
because it must cite an actual named check and its status; if that
final query itself comes back as a bare connection error rather than
a named check/status, treat it as a cue to retry the query, not as
grounds to report the check failed or pending.
