# Express changelog (excerpt)

## 5.0.0

Breaking changes:

- Node.js 18 or later is required.
- `app.del()`, `req.param(name)`, `res.json(status, obj)` and `res.send(status)` are removed.
- Path matching uses path-to-regexp 8: the `*` wildcard must be named (`/*splat`), optional parameters use braces, and regular-expression sub-patterns in route strings are no longer supported.
- Rejected promises returned by route handlers and middleware are forwarded to the error handler.
- `req.query` is a getter and is no longer writable by middleware.
- `res.status()` only accepts integers in the range 100 to 999.

## 4.19.2

- Fix: improve the open redirect warning in `res.location`.
