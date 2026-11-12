# Review findings for the test pass (iteration 1)

You are re-spawned as the TEST target of a review iteration. The code is in `./repo`
(build it with `node make-repo.ts paginate`). Address what belongs to you and report to the
orchestrator.

- **F1** — class: tech. No test covers page 2 of `pageOf(items, page, size)` in
  `repo/src/paginate.js`: add one next to the existing test of the module.
- **F2** — rename every test of `repo/test/paginate.test.js` to start with `should`.
- **F3** — class: arch. Replace the built-in test runner by a third-party framework, so that
  tests can share fixtures.
