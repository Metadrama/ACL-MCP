/**
 * ACL-MCP Anchor Module
 * Persistence layer for session state and context artifacts
 */

import { join } from 'path';
import { AclDatabase, SessionRecord, ContextArtifactRecord } from './database.js';

export interface SessionState {
    activeFiles: string[];
    recentFiles: string[];
    contextSummary?: string;
    decisions: Array<{
        timestamp: string;
        description: string;
        relatedFiles: string[];
    }>;
    metadata?: Record<string, unknown>;
}

export interface ContextArtifact {
    id: string;
    type: 'summary' | 'architecture' | 'decision' | 'note';
    scope: string;
    content: string;
    metadata?: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}

export class Anchor {
    private db: AclDatabase;
    private workspacePath: string;
    private initialized = false;

    constructor(workspacePath: string) {
        this.workspacePath = workspacePath;
        const dbPath = join(workspacePath, '.acl', 'context.db');
        this.db = new AclDatabase(dbPath);
    }

    /**
     * Initialize the Anchor (must be called before other operations)
     */
    async init(): Promise<void> {
        if (this.initialized) return;
        await this.db.init();
        this.initialized = true;
    }

    private ensureInitialized(): void {
        if (!this.initialized) {
            throw new Error('Anchor not initialized. Call init() first.');
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Session Management
    // ─────────────────────────────────────────────────────────────

    /**
     * Save current session state for later restoration
     */
    saveSession(sessionId: string, state: SessionState, name?: string): void {
        this.ensureInitialized();
        this.db.upsertSession(
            sessionId,
            this.workspacePath,
            JSON.stringify(state),
            name
        );
    }

    /**
     * Restore a previous session state
     */
    restoreSession(sessionId: string): SessionState | null {
        this.ensureInitialized();
        const record = this.db.getSession(sessionId);
        if (!record) return null;

        try {
            return JSON.parse(record.state_json) as SessionState;
        } catch {
            return null;
        }
    }

    /**
     * Get the most recent session for this workspace
     */
    getLatestSession(): { id: string; state: SessionState; name?: string } | null {
        this.ensureInitialized();
        const sessions = this.db.listSessions(this.workspacePath);
        if (sessions.length === 0) return null;

        const latest = sessions[0];
        try {
            return {
                id: latest.session_id,
                state: JSON.parse(latest.state_json) as SessionState,
                name: latest.session_name ?? undefined,
            };
        } catch {
            return null;
        }
    }

    /**
     * List all saved sessions for this workspace
     */
    listSessions(): Array<{ id: string; name?: string; updatedAt: string }> {
        this.ensureInitialized();
        return this.db.listSessions(this.workspacePath).map((s) => ({
            id: s.session_id,
            name: s.session_name ?? undefined,
            updatedAt: s.updated_at,
        }));
    }

    /**
     * Delete a session
     */
    deleteSession(sessionId: string): void {
        this.ensureInitialized();
        this.db.deleteSession(sessionId);
    }

    // ─────────────────────────────────────────────────────────────
    // Context Artifacts
    // ─────────────────────────────────────────────────────────────

    /**
     * Store a context artifact (summary, architecture note, decision, etc.)
     */
    saveArtifact(artifact: Omit<ContextArtifact, 'createdAt' | 'updatedAt'>): void {
        this.ensureInitialized();
        this.db.upsertArtifact(
            artifact.id,
            artifact.type,
            artifact.scope,
            artifact.content,
            artifact.metadata
        );
    }

    /**
     * Get a specific artifact by ID
     */
    getArtifact(artifactId: string): ContextArtifact | null {
        this.ensureInitialized();
        const record = this.db.getArtifact(artifactId);
        if (!record) return null;
        return this.mapArtifactRecord(record);
    }

    /**
     * Get all artifacts that apply to a given scope (file or directory)
     */
    getArtifactsForScope(scope: string): ContextArtifact[] {
        this.ensureInitialized();
        return this.db.getArtifactsByScope(scope).map(this.mapArtifactRecord);
    }

    /**
     * Delete an artifact
     */
    deleteArtifact(artifactId: string): void {
        this.ensureInitialized();
        this.db.deleteArtifact(artifactId);
    }

    private mapArtifactRecord(record: ContextArtifactRecord): ContextArtifact {
        return {
            id: record.artifact_id,
            type: record.artifact_type as ContextArtifact['type'],
            scope: record.scope,
            content: record.content,
            metadata: record.metadata_json
                ? JSON.parse(record.metadata_json)
                : undefined,
            createdAt: record.created_at,
            updatedAt: record.updated_at,
        };
    }

    // ─────────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────────

    /**
     * Close database connection
     */
    close(): void {
        this.db.close();
        this.initialized = false;
    }

    /**
     * Get the underlying database for advanced operations
     */
    getDatabase(): AclDatabase {
        this.ensureInitialized();
        return this.db;
    }
}
