/**
 * ACL-MCP Shadow Watcher
 * Filesystem watcher for proactive context preparation
 */

import { watch, FSWatcher } from 'chokidar';
import { EventEmitter } from 'events';
import { resolve, relative } from 'path';
import { AclConfig } from '../config.js';

export interface WatcherEvents {
    fileOpened: (filePath: string) => void;
    fileChanged: (filePath: string) => void;
    fileDeleted: (filePath: string) => void;
    directoryChanged: (dirPath: string) => void;
}

export class ShadowWatcher extends EventEmitter {
    private config: AclConfig;
    private watcher: FSWatcher | null = null;
    private isRunning = false;

    constructor(config: AclConfig) {
        super();
        this.config = config;
    }

    /**
     * Start watching the workspace
     */
    start(): void {
        if (this.isRunning) return;

        const watchPaths = this.config.includeZones.length > 0
            ? this.config.includeZones.map((zone) =>
                resolve(this.config.workspacePath, zone)
            )
            : [this.config.workspacePath];

        this.watcher = watch(watchPaths, {
            ignored: (path) => this.shouldIgnore(path),
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 300,
                pollInterval: 100,
            },
        });

        this.watcher
            .on('add', (path) => this.onFileAdded(path))
            .on('change', (path) => this.onFileChanged(path))
            .on('unlink', (path) => this.onFileDeleted(path))
            .on('addDir', (path) => this.onDirAdded(path))
            .on('unlinkDir', (path) => this.onDirDeleted(path))
            .on('error', (error: unknown) => this.onError(error as Error));

        this.isRunning = true;
        console.log('[ACL Shadow] Watcher started');
    }

    /**
     * Stop watching
     */
    async stop(): Promise<void> {
        if (!this.isRunning || !this.watcher) return;

        await this.watcher.close();
        this.watcher = null;
        this.isRunning = false;
        console.log('[ACL Shadow] Watcher stopped');
    }

    /**
     * Check if watcher is running
     */
    running(): boolean {
        return this.isRunning;
    }

    private shouldIgnore(path: string): boolean {
        const relativePath = relative(this.config.workspacePath, path);

        // Always ignore common non-source directories
        const alwaysIgnore = [
            'node_modules',
            '.git',
            '.acl', // Our own data directory
            'dist',
            'build',
            '__pycache__',
        ];

        for (const ignore of alwaysIgnore) {
            if (
                relativePath === ignore ||
                relativePath.startsWith(ignore + '/') ||
                relativePath.startsWith(ignore + '\\')
            ) {
                return true;
            }
        }

        // Check configured exclude zones
        for (const zone of this.config.excludeZones) {
            if (
                relativePath === zone ||
                relativePath.startsWith(zone + '/') ||
                relativePath.startsWith(zone + '\\')
            ) {
                return true;
            }
        }

        return false;
    }

    private onFileAdded(path: string): void {
        console.log(`[ACL Shadow] File added: ${path}`);
        this.emit('fileChanged', path);
    }

    private onFileChanged(path: string): void {
        console.log(`[ACL Shadow] File changed: ${path}`);
        this.emit('fileChanged', path);
    }

    private onFileDeleted(path: string): void {
        console.log(`[ACL Shadow] File deleted: ${path}`);
        this.emit('fileDeleted', path);
    }

    private onDirAdded(path: string): void {
        console.log(`[ACL Shadow] Directory added: ${path}`);
        this.emit('directoryChanged', path);
    }

    private onDirDeleted(path: string): void {
        console.log(`[ACL Shadow] Directory deleted: ${path}`);
        this.emit('directoryChanged', path);
    }

    private onError(error: Error): void {
        console.error('[ACL Shadow] Watcher error:', error);
    }
}
