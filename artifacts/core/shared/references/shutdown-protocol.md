# Shutdown protocol

A team lead sends a `shutdown_request` only after it has confirmed that all work is done and nothing more is expected from you. Answering at once keeps the whole team from waiting on a stopped teammate, so treat the request as a stop signal, not as a prompt for more work.

- Reply immediately with a `shutdown_response` that approves, then stop:

  ```json
  {"type": "shutdown_response", "request_id": "<id from request>", "approve": true}
  ```

- Do not defer the answer, summarise completed tasks, or wait for an operation still running. Each of those delays the lead's own shutdown for no gain, because the lead has already decided.
- After you finish a task and report to the lead, do not start further processing or re-enter a wait loop. Mark the task completed, send the completion message, and stop. The lead sends the next assignment or the shutdown signal, so extra activity only creates work nobody asked for.
