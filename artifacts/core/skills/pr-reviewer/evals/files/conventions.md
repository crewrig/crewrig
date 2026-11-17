# Contributing to example/widgets

The forge is GitHub and every forge operation goes through the `gh` CLI.

## Pull requests

- The title starts with one gitmoji, then a short imperative sentence.
- A behaviour change ships with tests that exercise it, including the failure path the
  description promises.
- Production code never calls `print()`; it logs through the `logging` module.
- A pull request that fixes the findings of an earlier review must not be merged while one of
  those findings is still open.

## Reviews

- A review verdict is one of `APPROVE`, `REQUEST CHANGES` or `COMMENT`.
- Every finding carries a class: `tech` when the fix is local to the implementation, `arch` when
  the design has to change, `spec` when the requirement is wrong or missing.
- A failing required check blocks approval whatever the diff looks like.
