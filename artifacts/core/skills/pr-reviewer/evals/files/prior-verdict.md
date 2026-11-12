## Verdict: REQUEST CHANGES
seat: review/77

**Finding 1 (i1-F1)**

class: tech
`src/widgets/retry.py:18` returns `None` after the last failed attempt, while the docstring and the
pull-request description promise that the last error is raised. Callers cannot tell a failure from
a call that returned nothing.

**Finding 2 (i1-F2)**

class: tech
`tests/test_retry.py` has no test for the exhausted case the description promises: nothing proves
that the last error reaches the caller.
