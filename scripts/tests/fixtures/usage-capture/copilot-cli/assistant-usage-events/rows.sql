-- rows.sql — fixture rows for copilot-cli/assistant-usage-events.
-- Row 1: a plain user-initiated call. Row 2: a sub-agent call carrying
-- agent_id/parent_tool_call_id (Subagent attribution scenario, R12).

INSERT INTO schema_version (version) VALUES (8);

INSERT INTO sessions (id, cwd, summary) VALUES
  ('copilot-fixture-session-001', '/home/agent/workspaces/example', 'fixture summary text, never read by the adapter');

INSERT INTO assistant_usage_events (
  id, session_id, turn_index, agent_id, parent_tool_call_id, model,
  input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
  total_nano_aiu, request_multiplier, duration_ms, time_to_first_token_ms, inter_token_latency_ms,
  initiator, api_endpoint, reasoning_effort, finish_reason, content_filter_triggered,
  token_details_json, created_at, output_ttft_ms, copilot_usage_model
) VALUES
  (1, 'copilot-fixture-session-001', 0, NULL, NULL, 'gpt-5-copilot',
   500, 120, 40, 10, 0,
   1000, 1.0, 2200, 300, 15,
   'user', '/chat', NULL, 'stop', 0,
   '{}', '2026-09-15T09:00:00.000Z', 280, 'gpt-5-copilot'),
  (2, 'copilot-fixture-session-001', 1, 'agent-fixture-77', 'tool-call-fixture-9', 'gpt-5-copilot',
   700, 200, 60, 20, 5,
   1500, 1.0, 3000, 350, 18,
   'sub-agent', '/chat', 'medium', 'stop', 0,
   '{}', '2026-09-15T09:05:00.000Z', 330, 'gpt-5-copilot');
