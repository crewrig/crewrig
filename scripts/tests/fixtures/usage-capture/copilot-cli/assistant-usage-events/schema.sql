-- schema.sql — fixture schema for scripts/tests/fixtures/usage-capture/copilot-cli/assistant-usage-events
-- Mirrors ~/.copilot/session-store.db's own schema_version 8 shape: the
-- assistant_usage_events column set copilot-cli.js's EXPECTED_COLUMNS names,
-- plus a sessions table joined on session_id for identity.projectRoot (cwd).
-- Materialized into a temp DB at test time via node:sqlite's exec() — no
-- binary blob is committed to git (PLAN v3 step 17).

CREATE TABLE schema_version (
  version INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  cwd TEXT,
  summary TEXT
);

CREATE TABLE assistant_usage_events (
  id INTEGER PRIMARY KEY,
  session_id TEXT,
  turn_index INTEGER,
  agent_id TEXT,
  parent_tool_call_id TEXT,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  reasoning_tokens INTEGER,
  total_nano_aiu INTEGER,
  request_multiplier REAL,
  duration_ms INTEGER,
  time_to_first_token_ms INTEGER,
  inter_token_latency_ms INTEGER,
  initiator TEXT,
  api_endpoint TEXT,
  reasoning_effort TEXT,
  finish_reason TEXT,
  content_filter_triggered INTEGER,
  token_details_json TEXT,
  created_at TEXT,
  output_ttft_ms INTEGER,
  copilot_usage_model TEXT
);
