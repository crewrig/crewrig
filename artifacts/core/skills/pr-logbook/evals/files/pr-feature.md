`WidgetClient.getWidget` now retries HTTP 429 and 5xx responses with
exponential backoff, so a brief outage of the widgets service no longer fails
the caller. Fixes #12.

## How to read this PR?

Start with `src/backoff.ts`, then `src/client.ts`, then the two new tests in
`test/client.test.ts`.

## How to test this PR?

Run the client test suite. The two new tests cover a 503 that recovers and a
503 that exhausts `maxRetries`.

## Detailed description (for agents)

- Added `src/backoff.ts` with `backoffDelay(attempt)`.
- Changed `WidgetClient.getWidget` to loop over attempts and added the
  optional `maxRetries` option (default 3). Other errors, such as a 404,
  still fail on the first attempt.
- Added two tests in `test/client.test.ts`.

Folded bugs: not applicable.
