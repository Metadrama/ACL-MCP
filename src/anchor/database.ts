/**
 * ACL-MCP Database Module
 * Handles SQLite operations using sql.js (pure JavaScript)
 */

import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export interface SkeletonRecord {
    id: number;
    file_path: string;
    file_hash: string;
    language: string;
    skeleton_json: string;
    created_at: string;
    updated_at: string;
}

export interface SessionRecord {
    id: number;
    session_id: string;
    workspace_path: string;
    session_name: string | null;
    state_json: string;
    created_at: string;
    updated_at: string;
}

export interface ContextArtifactRecord {
    id: number;
    artifact_id: string;
    artifact_type: string;
    scope: string;
    content: string;
    metadata_json: string | null;
    created_at: string;
    updated_at: string;
}

export interface ImportEdgeRecord {
    id: number;
    source_path: string;
    target_path: string;
    import_type: string;
    created_at: string;
}

// SQL.js singleton
let SQL: initSqlJs.SqlJsStatic | null = null;

async function getSqlJs(): Promise<initSqlJs.SqlJsStatic> {
    if (!SQL) {
        SQL = await initSqlJs();
    }
    return SQL;
}

export class AclDatabase {
    private db: SqlJsDatabase | null = null;
    private dbPath: string;
    private initialized = false;

    constructor(dbPath: string) {
        this.dbPath = dbPath;
    }

    async init(): Promise<void> {
        if (this.initialized) return;

        const sqlJs = await getSqlJs();

        // Ensure directory exists
        const dir = dirname(this.dbPath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }

        // Load or create database
        if (existsSync(this.dbPath)) {
            const buffer = readFileSync(this.dbPath);
            this.db = new sqlJs.Database(buffer);
        } else {
            this.db = new sqlJs.Database();
        }

        this.initSchema();
        this.initialized = true;
    }

    private ensureDb(): SqlJsDatabase {
        if (!this.db) {
            throw new Error('Database not initialized. Call init() first.');
        }
        return this.db;
    }

    private initSchema(): void {
        const db = this.ensureDb();

        db.run(`
      CREATE TABLE IF NOT EXISTS skeletons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL UNIQUE,
        file_hash TEXT NOT NULL,
        language TEXT NOT NULL,
        skeleton_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

        db.run(`CREATE INDEX IF NOT EXISTS idx_skeletons_file_path ON skeletons(file_path)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_skeletons_file_hash ON skeletons(file_hash)`);

        db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL UNIQUE,
        workspace_path TEXT NOT NULL,
        session_name TEXT,
        state_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

        db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_path)`);

        db.run(`
      CREATE TABLE IF NOT EXISTS context_artifacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        artifact_id TEXT NOT NULL UNIQUE,
        artifact_type TEXT NOT NULL,
        scope TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

        db.run(`CREATE INDEX IF NOT EXISTS idx_artifacts_type ON context_artifacts(artifact_type)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_artifacts_scope ON context_artifacts(scope)`);

        db.run(`
      CREATE TABLE IF NOT EXISTS import_graph (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_path TEXT NOT NULL,
        target_path TEXT NOT NULL,
        import_type TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(source_path, target_path, import_type)
      )
    `);

        db.run(`CREATE INDEX IF NOT EXISTS idx_import_source ON import_graph(source_path)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_import_target ON import_graph(target_path)`);

        db.run(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

        db.run(`INSERT OR IGNORE INTO schema_version (version) VALUES (1)`);

        this.save();
    }

    private save(): void {
        const db = this.ensureDb();
        const data = db.export();
        const buffer = Buffer.from(data);
        writeFileSync(this.dbPath, buffer);
    }

    private queryOne<T>(sql: string, params: (string | number | null)[] = []): T | undefined {
        const db = this.ensureDb();
        const stmt = db.prepare(sql);
        stmt.bind(params as any);

        if (stmt.step()) {
            const columns = stmt.getColumnNames();
            const values = stmt.get();
            const result: Record<string, unknown> = {};
            for (let i = 0; i < columns.length; i++) {
                result[columns[i]] = values[i];
            }
            stmt.free();
            return result as T;
        }
        stmt.free();
        return undefined;
    }

    private queryAll<T>(sql: string, params: (string | number | null)[] = []): T[] {
        const db = this.ensureDb();
        const stmt = db.prepare(sql);
        stmt.bind(params as any);

        const results: T[] = [];
        const columns = stmt.getColumnNames();

        while (stmt.step()) {
            const values = stmt.get();
            const row: Record<string, unknown> = {};
            for (let i = 0; i < columns.length; i++) {
                row[columns[i]] = values[i];
            }
            results.push(row as T);
        }
        stmt.free();
        return results;
    }

    private run(sql: string, params: (string | number | null)[] = []): void {
        const db = this.ensureDb();
        db.run(sql, params as any);
        this.save();
    }

    // ─────────────────────────────────────────────────────────────
    // Skeleton Operations
    // ─────────────────────────────────────────────────────────────

    getSkeleton(filePath: string): SkeletonRecord | undefined {
        return this.queryOne<SkeletonRecord>(
            `SELECT * FROM skeletons WHERE file_path = ?`,
            [filePath]
        );
    }

    upsertSkeleton(
        filePath: string,
        fileHash: string,
        language: string,
        skeletonJson: string
    ): void {
        this.run(
            `INSERT INTO skeletons (file_path, file_hash, language, skeleton_json, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(file_path) DO UPDATE SET
         file_hash = excluded.file_hash,
         language = excluded.language,
         skeleton_json = excluded.skeleton_json,
         updated_at = datetime('now')`,
            [filePath, fileHash, language, skeletonJson]
        );
    }

    deleteSkeleton(filePath: string): void {
        this.run(`DELETE FROM skeletons WHERE file_path = ?`, [filePath]);
    }

    getSkeletonsByHash(fileHash: string): SkeletonRecord[] {
        return this.queryAll<SkeletonRecord>(
            `SELECT * FROM skeletons WHERE file_hash = ?`,
            [fileHash]
        );
    }

    // ─────────────────────────────────────────────────────────────
    // Session Operations
    // ─────────────────────────────────────────────────────────────

    getSession(sessionId: string): SessionRecord | undefined {
        return this.queryOne<SessionRecord>(
            `SELECT * FROM sessions WHERE session_id = ?`,
            [sessionId]
        );
    }

    listSessions(workspacePath: string): SessionRecord[] {
        return this.queryAll<SessionRecord>(
            `SELECT * FROM sessions WHERE workspace_path = ? ORDER BY updated_at DESC`,
            [workspacePath]
        );
    }

    upsertSession(
        sessionId: string,
        workspacePath: string,
        stateJson: string,
        sessionName?: string
    ): void {
        this.run(
            `INSERT INTO sessions (session_id, workspace_path, session_name, state_json, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(session_id) DO UPDATE SET
         state_json = excluded.state_json,
         session_name = COALESCE(excluded.session_name, sessions.session_name),
         updated_at = datetime('now')`,
            [sessionId, workspacePath, sessionName ?? null, stateJson]
        );
    }

    deleteSession(sessionId: string): void {
        this.run(`DELETE FROM sessions WHERE session_id = ?`, [sessionId]);
    }

    // ─────────────────────────────────────────────────────────────
    // Context Artifact Operations
    // ─────────────────────────────────────────────────────────────

    getArtifact(artifactId: string): ContextArtifactRecord | undefined {
        return this.queryOne<ContextArtifactRecord>(
            `SELECT * FROM context_artifacts WHERE artifact_id = ?`,
            [artifactId]
        );
    }

    getArtifactsByScope(scope: string): ContextArtifactRecord[] {
        return this.queryAll<ContextArtifactRecord>(
            `SELECT * FROM context_artifacts 
       WHERE scope = ? OR scope LIKE ? || '/%'
       ORDER BY created_at DESC`,
            [scope, scope]
        );
    }

    upsertArtifact(
        artifactId: string,
        artifactType: string,
        scope: string,
        content: string,
        metadata?: Record<string, unknown>
    ): void {
        this.run(
            `INSERT INTO context_artifacts (artifact_id, artifact_type, scope, content, metadata_json, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(artifact_id) DO UPDATE SET
         content = excluded.content,
         metadata_json = excluded.metadata_json,
         updated_at = datetime('now')`,
            [
                artifactId,
                artifactType,
                scope,
                content,
                metadata ? JSON.stringify(metadata) : null,
            ]
        );
    }

    deleteArtifact(artifactId: string): void {
        this.run(`DELETE FROM context_artifacts WHERE artifact_id = ?`, [artifactId]);
    }

    // ─────────────────────────────────────────────────────────────
    // Import Graph Operations
    // ─────────────────────────────────────────────────────────────

    addImportEdge(
        sourcePath: string,
        targetPath: string,
        importType: 'static' | 'dynamic' | 'type-only'
    ): void {
        this.run(
            `INSERT OR IGNORE INTO import_graph (source_path, target_path, import_type)
       VALUES (?, ?, ?)`,
            [sourcePath, targetPath, importType]
        );
    }

    getImports(sourcePath: string): ImportEdgeRecord[] {
        return this.queryAll<ImportEdgeRecord>(
            `SELECT * FROM import_graph WHERE source_path = ?`,
            [sourcePath]
        );
    }

    getImporters(targetPath: string): ImportEdgeRecord[] {
        return this.queryAll<ImportEdgeRecord>(
            `SELECT * FROM import_graph WHERE target_path = ?`,
            [targetPath]
        );
    }

    clearImportsForFile(sourcePath: string): void {
        this.run(`DELETE FROM import_graph WHERE source_path = ?`, [sourcePath]);
    }

    // ─────────────────────────────────────────────────────────────
    // Utility
    // ─────────────────────────────────────────────────────────────

    close(): void {
        if (this.db) {
            this.save();
            this.db.close();
            this.db = null;
        }
        this.initialized = false;
    }

    /**
     * Run a transaction (sql.js doesn't have native transactions, so we batch operations)
     */
    transaction<T>(fn: () => T): T {
        const db = this.ensureDb();
        db.run('BEGIN TRANSACTION');
        try {
            const result = fn();
            db.run('COMMIT');
            this.save();
            return result;
        } catch (error) {
            db.run('ROLLBACK');
            throw error;
        }
    }
}
