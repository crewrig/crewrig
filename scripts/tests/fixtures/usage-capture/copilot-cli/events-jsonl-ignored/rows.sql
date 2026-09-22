-- rows.sql — one row whose token columns are the ONLY legitimate source of
-- token values. The sibling home/.copilot/session-state/<session_id>/events.jsonl
-- fixture carries a "session.start" line (legitimately read, for
-- copilotVersion ONLY) and a decoy "usage.poison" line carrying an
-- obviously-wrong token value (999999999). scripts/tests/test-usage-capture.sh
-- asserts the derived record's tokens equal THIS file's own columns, never the
-- poison value — proving events.jsonl is never opened for a token value.

INSERT INTO schema_version (version) VALUES (8);

INSERT INTO sessions (id, cwd, summary) VALUES
  ('copilot-poison-fixture-001', '/home/agent/workspaces/example', 'fixture summary text, never read by the adapter');

INSERT INTO assistant_usage_events (
  id, session_id, turn_index, agent_id, parent_tool_call_id, model,
  input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
  total_nano_aiu, request_multiplier, duration_ms, time_to_first_token_ms, inter_token_latency_ms,
  initiator, api_endpoint, reasoning_effort, finish_reason, content_filter_triggered,
  token_details_json, created_at, output_ttft_ms, copilot_usage_model
) VALUES
  (1, 'copilot-poison-fixture-001', 0, NULL, NULL, 'gpt-5-copilot',
   321, 45, 12, 3, 1,
   400, 1.0, 1800, 260, 11,
   'user', '/chat', NULL, 'stop', 0,
   '{}', '2026-09-15T09:10:00.000Z', 240, 'gpt-5-copilot');
