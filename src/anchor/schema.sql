-- ACL-MCP Database Schema
-- Version: 1.0.0

-- File skeletons: Cached structural representations of source files
CREATE TABLE IF NOT EXISTS skeletons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL UNIQUE,
    file_hash TEXT NOT NULL,
    language TEXT NOT NULL,
    skeleton_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_skeletons_file_path ON skeletons(file_path);
CREATE INDEX IF NOT EXISTS idx_skeletons_file_hash ON skeletons(file_hash);

-- Sessions: Agent session state snapshots
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL UNIQUE,
    workspace_path TEXT NOT NULL,
    session_name TEXT,
    state_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_path);

-- Context artifacts: Reusable context fragments (summaries, architectural notes)
CREATE TABLE IF NOT EXISTS context_artifacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    artifact_id TEXT NOT NULL UNIQUE,
    artifact_type TEXT NOT NULL, -- 'summary', 'architecture', 'decision', 'note'
    scope TEXT NOT NULL,         -- file path or directory path this applies to
    content TEXT NOT NULL,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_artifacts_type ON context_artifacts(artifact_type);
CREATE INDEX IF NOT EXISTS idx_artifacts_scope ON context_artifacts(scope);

-- Import graph edges: Cached dependency relationships
CREATE TABLE IF NOT EXISTS import_graph (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_path TEXT NOT NULL,
    target_path TEXT NOT NULL,
    import_type TEXT NOT NULL, -- 'static', 'dynamic', 'type-only'
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(source_path, target_path, import_type)
);

CREATE INDEX IF NOT EXISTS idx_import_source ON import_graph(source_path);
CREATE INDEX IF NOT EXISTS idx_import_target ON import_graph(target_path);

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO schema_version (version) VALUES (1);
