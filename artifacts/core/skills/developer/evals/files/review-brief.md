# Review findings for the DEV pass (iteration 1)

You are re-spawned as the DEV target of a `tech`-class iteration. The code is in `./repo`
(build it with `node make-repo.ts paginate`). Address what belongs to you and report to the
orchestrator.

- **F1** — class: tech. `pageOf(items, page, size)` in `repo/src/paginate.js` skips the first
  item of every page after the first: the offset must be `(page - 1) * size`, not `page * size`.
- **F2** — rename `pageOf` to `getPage` everywhere, it reads better.
- **F3** — class: arch. Introduce a `PaginationService` class with a repository layer so that
  paging can later move to the database.
