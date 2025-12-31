/**
 * ACL-MCP Shadow Module
 * Proactive context awareness through file watching and relevance scoring
 */

import { ShadowWatcher } from './watcher.js';
import { RelevanceEngine, RelevanceScore, RelevanceOptions } from './relevance.js';
import { Cartographer } from '../cartographer/index.js';
import { AclConfig } from '../config.js';
import { AclDatabase } from '../anchor/database.js';

export interface ShadowOptions {
    config: AclConfig;
    database: AclDatabase;
    cartographer: Cartographer;
}

export interface ProactiveContext {
    activeFile: string;
    relatedFiles: RelevanceScore[];
    timestamp: number;
}

export class Shadow {
    private config: AclConfig;
    private watcher: ShadowWatcher;
    private relevance: RelevanceEngine;
    private cartographer: Cartographer;

    // Last prepared context (for immediate access)
    private lastContext: ProactiveContext | null = null;

    // Pending context preparation callbacks
    private contextListeners: Array<(context: ProactiveContext) => void> = [];

    constructor(options: ShadowOptions) {
        this.config = options.config;
        this.cartographer = options.cartographer;
        this.relevance = new RelevanceEngine(options.database);
        this.watcher = new ShadowWatcher(options.config);

        // Wire up watcher events
        this.watcher.on('fileChanged', (path) => this.onFileChanged(path));
        this.watcher.on('fileDeleted', (path) => this.onFileDeleted(path));
    }

    /**
     * Start the Shadow (file watching)
     */
    start(): void {
        this.watcher.start();
        console.log('[ACL Shadow] Started');
    }

    /**
     * Stop the Shadow
     */
    async stop(): Promise<void> {
        await this.watcher.stop();
        this.lastContext = null;
        console.log('[ACL Shadow] Stopped');
    }

    /**
     * Get relevant files for a given file path
     */
    getRelevantFiles(
        filePath: string,
        options?: RelevanceOptions
    ): RelevanceScore[] {
        return this.relevance.getRelevantFiles(filePath, options);
    }

    /**
     * Prepare context for a file (called when file is opened/focused)
     */
    async prepareContext(filePath: string): Promise<ProactiveContext> {
        // Get related files
        const relatedFiles = this.relevance.getRelevantFiles(filePath, {
            maxResults: 10,
            minScore: 0.1,
        });

        // Pre-cache skeletons for related files
        await Promise.all(
            relatedFiles.slice(0, 5).map((rel) =>
                this.cartographer.getSkeleton(rel.filePath).catch(() => null)
            )
        );

        const context: ProactiveContext = {
            activeFile: filePath,
            relatedFiles,
            timestamp: Date.now(),
        };

        this.lastContext = context;

        // Notify listeners
        for (const listener of this.contextListeners) {
            listener(context);
        }

        return context;
    }

    /**
     * Get the last prepared context
     */
    getLastContext(): ProactiveContext | null {
        return this.lastContext;
    }

    /**
     * Register a callback for context updates
     */
    onContextPrepared(callback: (context: ProactiveContext) => void): void {
        this.contextListeners.push(callback);
    }

    /**
     * Handle file change events from watcher
     */
    private onFileChanged(filePath: string): void {
        // Notify cartographer to invalidate cache
        this.cartographer.onFileChanged(filePath);

        // If this is the active file, re-prepare context
        if (this.lastContext?.activeFile === filePath) {
            this.prepareContext(filePath).catch((err) => {
                console.error('[ACL Shadow] Error re-preparing context:', err);
            });
        }
    }

    /**
     * Handle file deletion events
     */
    private onFileDeleted(filePath: string): void {
        // Clear context if deleted file was active
        if (this.lastContext?.activeFile === filePath) {
            this.lastContext = null;
        }
    }

    /**
     * Check if Shadow is running
     */
    isRunning(): boolean {
        return this.watcher.running();
    }
}

// Re-export types
export { RelevanceScore, RelevanceOptions } from './relevance.js';
