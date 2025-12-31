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
    async start(): Promise<void> {
        this.watcher.start();

        // perform initial scan in background
        this.initialScan().catch(err => {
            // Logging disabled for MCP
        });
    }

    /**
     * Stop the Shadow
     */
    async stop(): Promise<void> {
        await this.watcher.stop();
        this.lastContext = null;
    }

    /**
     * Perform an initial scan of the workspace to populate the context database
     */
    private async initialScan(): Promise<void> {
        const { appendFileSync } = await import('fs');
        const logPath = 'C:/Users/Local User/ACL-MCP/debug.log';

        try {
            appendFileSync(logPath, `[Shadow] Starting initial scan of ${this.config.workspacePath}\n`);

            // Map the entire workspace (depth 10 should cover most projects)
            const map = this.cartographer.mapDirectory('.', 10);

            appendFileSync(logPath, `[Shadow] Found ${map.files.length} files to scan\n`);

            // Flatten file list
            const filesToProcess: string[] = [];
            const processDir = (dirMap: any) => { // using any because DirectoryMap type is in cartographer
                if (dirMap.files) {
                    for (const f of dirMap.files) {
                        filesToProcess.push(f.path);
                    }
                }
                // mapDirectory returns a flat list of files in the current dir, 
                // but it recurses? 
                // Wait, mapDirectory output in Cartographer.ts structure:
                // It walks recursively but puts everything into one result structure?
                // Checking Cartographer.walkDirectory:
                // It puts files in result.files.
                // But it recurses for subdirectories.
                // actually mapDirectory uses walkDirectory which populates 'result' passed by reference.
                // So 'result.files' will contain ALL files found if mapped recursively?
                // Reviewing Cartographer.ts again:
                // walkDirectory: 
                //   if file: result.files.push(...)
                //   if dir: recurse
                // Yes, 'result' accumulates ALL files.
            };

            // Actually Cartographer.mapDirectory returns a DirectoryMap which contains 'files' array.
            // And walkDirectory appends to this single 'result' object.
            // So map.files contains ALL files found during the walk.

            for (const file of map.files) {
                // Queue for indexing (lazy)
                // We use getSkeleton to force parsing and caching if not exists
                const skel = await this.cartographer.getSkeleton(file.path);
                // appendFileSync(logPath, `[Shadow] Scanned ${file.relativePath}: ${!!skel}\n`);
            }

            appendFileSync(logPath, `[Shadow] Initial scan complete\n`);
        } catch (error: any) {
            appendFileSync(logPath, `[Shadow] Scan error: ${error.message}\n`);
        }
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
            this.prepareContext(filePath).catch((_err) => {
                // Logging disabled for MCP compatibility
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
export type { RelevanceScore, RelevanceOptions } from './relevance.js';

