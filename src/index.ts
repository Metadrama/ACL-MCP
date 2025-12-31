/**
 * ACL-MCP Server
 * Agent Context Lifecycle - MCP Server Entry Point
 * 
 * Provides persistent, structured context management for AI coding agents
 * through the Model Context Protocol (MCP).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    Tool,
    ListRootsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { resolve, isAbsolute } from 'path';
import { existsSync } from 'fs';

import { loadConfig, AclConfig } from './config.js';
import { Anchor, SessionState } from './anchor/index.js';
import { AclDatabase } from './anchor/database.js';
import { Cartographer } from './cartographer/index.js';
import { FileSkeleton } from './cartographer/parser.js';
import { Shadow } from './shadow/index.js';
import type { RelevanceScore } from './shadow/index.js';

// ─────────────────────────────────────────────────────────────
// Tool Definitions
// ─────────────────────────────────────────────────────────────

const TOOLS: Tool[] = [
    {
        name: 'acl_get_context',
        description:
            'Get structural skeleton for a file or directory. Returns exports, imports, classes, and functions without full file contents. Use this to understand code structure efficiently.',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'File or directory path (relative to workspace root)',
                },
                depth: {
                    type: 'number',
                    description: 'For directories: max depth to traverse (default: 3)',
                },
            },
            required: ['path'],
        },
    },
    {
        name: 'acl_get_related',
        description:
            'Get files related to a given file based on import/export relationships. Use this to discover dependencies and dependents.',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'File path (relative to workspace root)',
                },
                depth: {
                    type: 'number',
                    description: 'Relationship depth to traverse (default: 1)',
                },
                maxResults: {
                    type: 'number',
                    description: 'Maximum number of related files to return (default: 10)',
                },
            },
            required: ['path'],
        },
    },
    {
        name: 'acl_refresh',
        description:
            'Force re-parse of specified files. Use after making changes to ensure context is up-to-date.',
        inputSchema: {
            type: 'object',
            properties: {
                paths: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Array of file paths to refresh',
                },
            },
            required: ['paths'],
        },
    },
    {
        name: 'acl_save_session',
        description:
            'Save current session state for later restoration. Persists active files, context summaries, and decisions.',
        inputSchema: {
            type: 'object',
            properties: {
                sessionId: {
                    type: 'string',
                    description: 'Unique session identifier',
                },
                name: {
                    type: 'string',
                    description: 'Optional human-readable session name',
                },
                state: {
                    type: 'object',
                    description: 'Session state to save',
                    properties: {
                        activeFiles: {
                            type: 'array',
                            items: { type: 'string' },
                        },
                        recentFiles: {
                            type: 'array',
                            items: { type: 'string' },
                        },
                        contextSummary: { type: 'string' },
                        decisions: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    timestamp: { type: 'string' },
                                    description: { type: 'string' },
                                    relatedFiles: {
                                        type: 'array',
                                        items: { type: 'string' },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            required: ['sessionId', 'state'],
        },
    },
    {
        name: 'acl_restore_session',
        description:
            'Restore a previously saved session state. Returns the saved context including active files and decisions.',
        inputSchema: {
            type: 'object',
            properties: {
                sessionId: {
                    type: 'string',
                    description: 'Session ID to restore (optional - uses latest if not provided)',
                },
            },
        },
    },
    {
        name: 'acl_list_sessions',
        description: 'List all saved sessions for the current workspace.',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'acl_get_stats',
        description: 'Get ACL server statistics including cache size and indexed files.',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
];

function normalizePath(p: string): string {
    return resolve(p).replace(/\\/g, '/');
}

// ─────────────────────────────────────────────────────────────
// ACL Server Class
// ─────────────────────────────────────────────────────────────

class AclServer {
    private server: Server;
    private config!: AclConfig;
    private database!: AclDatabase;
    private anchor!: Anchor;
    private cartographer!: Cartographer;
    private shadow!: Shadow;
    private workspacePath: string;
    private initialized = false;

    constructor(workspacePath: string) {
        this.workspacePath = workspacePath;

        // Force fallback if unexpanded variable remains
        if (!this.workspacePath || this.workspacePath.includes('${workspaceFolder}')) {
            this.workspacePath = process.cwd();
        }

        // Create MCP server with roots capability to receive workspace from client
        this.server = new Server(
            {
                name: 'acl-mcp',
                version: '0.1.3',
            },
            {
                capabilities: {
                    tools: {},
                },
            }
        );

        this.setupHandlers();
    }

    /**
     * Initialize with a specific workspace path
     */
    async initWithWorkspace(workspacePath: string): Promise<void> {
        // If changing workspace, clean up old resources
        if (this.initialized && this.workspacePath !== workspacePath) {
            await this.reset();
        } else if (this.initialized && this.workspacePath === workspacePath) {
            return;
        }

        this.workspacePath = workspacePath;

        const { appendFileSync } = await import('fs');
        try {
            // Load configuration
            this.config = loadConfig(workspacePath);

            // Initialize database
            const dbPath = resolve(workspacePath, '.acl', 'context.db');
            this.database = new AclDatabase(dbPath);
            await this.database.init();

            // Initialize anchor
            this.anchor = new Anchor(workspacePath);
            await this.anchor.init();

            // Initialize modules
            this.cartographer = new Cartographer({
                config: this.config,
                database: this.database,
            });
            this.shadow = new Shadow({
                config: this.config,
                database: this.database,
                cartographer: this.cartographer,
            });

            // Start Shadow watcher
            this.shadow.start();

            this.initialized = true;
            appendFileSync('C:/Users/Local User/ACL-MCP/debug.log', `[${new Date().toISOString()}] Initialized workspace: ${workspacePath}\n`);
        } catch (error) {
            appendFileSync('C:/Users/Local User/ACL-MCP/debug.log', `[${new Date().toISOString()}] Error initializing workspace: ${error}\n`);
            throw error;
        }
    }

    private async reset(): Promise<void> {
        if (this.shadow) await this.shadow.stop();
        if (this.anchor) this.anchor.close();
        if (this.database) this.database.close();
        this.initialized = false;
    }

    private setupHandlers(): void {
        // List tools
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: TOOLS,
        }));

        // Handle tool calls
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;

            try {
                // Smart workspace detection from first absolute path
                let detectedWorkspace = this.workspacePath;

                // Try to extract workspace from the path argument
                const pathArg = (args as any)?.path || (args as any)?.paths?.[0];
                if (pathArg && isAbsolute(pathArg)) {
                    // Heuristic: find common project markers
                    const markers = ['package.json', 'tsconfig.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', '.git'];
                    let checkPath = pathArg;

                    // Limit traversal to avoid infinite loops or going too high
                    let depth = 0;
                    while (checkPath && checkPath !== resolve(checkPath, '..') && depth < 10) {
                        const { dirname } = await import('path');
                        const parentDir = dirname(checkPath);

                        for (const marker of markers) {
                            const markerPath = resolve(parentDir, marker);
                            if (existsSync(markerPath)) {
                                detectedWorkspace = parentDir;
                                break;
                            }
                        }

                        if (detectedWorkspace !== this.workspacePath) break;
                        checkPath = parentDir;
                        depth++;
                    }

                    // Fallback: use parent of first path if it looks like a src file
                    if (detectedWorkspace === this.workspacePath && pathArg.includes('src')) {
                        const srcIndex = pathArg.indexOf('src');
                        if (srcIndex > 0) {
                            detectedWorkspace = pathArg.substring(0, srcIndex - 1);
                        }
                    }
                }

                if (detectedWorkspace !== this.workspacePath) {
                    await this.initWithWorkspace(detectedWorkspace);
                } else if (!this.initialized) {
                    await this.initWithWorkspace(this.workspacePath);
                }

                switch (name) {
                    case 'acl_get_context':
                        return await this.handleGetContext(args as { path: string; depth?: number });

                    case 'acl_get_related':
                        return await this.handleGetRelated(
                            args as { path: string; depth?: number; maxResults?: number }
                        );

                    case 'acl_refresh':
                        return await this.handleRefresh(args as { paths: string[] });

                    case 'acl_save_session':
                        return await this.handleSaveSession(
                            args as { sessionId: string; name?: string; state: SessionState }
                        );

                    case 'acl_restore_session':
                        return await this.handleRestoreSession(args as { sessionId?: string });

                    case 'acl_list_sessions':
                        return await this.handleListSessions();

                    case 'acl_get_stats':
                        return await this.handleGetStats();

                    default:
                        throw new Error(`Unknown tool: ${name}`);
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return {
                    content: [{ type: 'text', text: `Error: ${message}` }],
                    isError: true,
                };
            }
        });
    }

    // ─────────────────────────────────────────────────────────────
    // Tool Handlers
    // ─────────────────────────────────────────────────────────────

    private async handleGetContext(args: { path: string; depth?: number }) {
        const { path, depth = 3 } = args;

        // Handle both relative and absolute paths
        const absolutePath = isAbsolute(path)
            ? path
            : resolve(this.config.workspacePath, path);

        // Check if it's a file or directory
        const { statSync } = await import('fs');
        let stat;
        try {
            stat = statSync(absolutePath);
        } catch {
            return {
                content: [{ type: 'text', text: `Path not found: ${path}` }],
                isError: true,
            };
        }

        if (stat.isFile()) {
            const skeleton = await this.cartographer.getSkeleton(absolutePath);
            if (!skeleton) {
                return {
                    content: [{ type: 'text', text: `File not found: ${path}` }],
                    isError: true,
                };
            }

            // Debug: Write parse results to a file
            const { writeFileSync } = await import('fs');
            const debugInfo = {
                detectedWorkspace: this.workspacePath,
                pathUsed: absolutePath,
                classesFound: skeleton.classes.length,
                classes: skeleton.classes.map(c => ({ name: c.name, methods: c.methods.length }))
            };
            writeFileSync('c:/Users/Local User/ACL-MCP/parse_debug.json', JSON.stringify(debugInfo, null, 2));

            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(this.formatSkeleton(skeleton), null, 2),
                    },
                ],
            };
        } else if (stat.isDirectory()) {
            // Map directory structure
            const map = this.cartographer.mapDirectory(absolutePath, depth);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(
                            {
                                path: map.relativePath,
                                totalFiles: map.totalFiles,
                                subdirectories: map.subdirectories.length,
                                files: map.files.map((f) => ({
                                    path: f.relativePath,
                                    language: f.language,
                                })),
                            },
                            null,
                            2
                        ),
                    },
                ],
            };
        }

        return {
            content: [{ type: 'text', text: `Invalid path type: ${path}` }],
            isError: true,
        };
    }

    private async handleGetRelated(args: {
        path: string;
        depth?: number;
        maxResults?: number;
    }) {
        const { path, depth = 1, maxResults = 10 } = args;

        const absolutePath = isAbsolute(path)
            ? path
            : resolve(this.config.workspacePath, path);

        // Get related via Shadow's relevance engine
        const related = this.shadow.getRelevantFiles(absolutePath, { maxResults });

        // Also get import graph based relationships
        const graphRelated = await this.cartographer.getRelatedFiles(absolutePath, depth);

        // Combine and dedupe
        const allPaths = new Set([
            ...related.map((r) => r.filePath),
            ...graphRelated,
        ]);

        const result: Array<{
            path: string;
            score?: number;
            reason?: string;
        }> = [];

        for (const filePath of allPaths) {
            const relevanceEntry = related.find((r) => r.filePath === filePath);
            result.push({
                path: filePath.replace(this.config.workspacePath, '').replace(/^[\\/\\\\]/, ''),
                score: relevanceEntry?.score,
                reason: relevanceEntry?.reason,
            });
        }

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({ related: result.slice(0, maxResults) }, null, 2),
                },
            ],
        };
    }

    private async handleRefresh(args: { paths: string[] }) {
        const { paths } = args;
        const results: Array<{ path: string; success: boolean; error?: string }> = [];

        for (const path of paths) {
            try {
                const absolutePath = isAbsolute(path)
                    ? path
                    : resolve(this.config.workspacePath, path);
                await this.cartographer.refreshSkeleton(absolutePath);
                results.push({ path, success: true });
            } catch (error) {
                results.push({
                    path,
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({ refreshed: results }, null, 2),
                },
            ],
        };
    }

    private async handleSaveSession(args: {
        sessionId: string;
        name?: string;
        state: SessionState;
    }) {
        const { sessionId, name, state } = args;

        this.anchor.saveSession(sessionId, state, name);

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        saved: true,
                        sessionId,
                        name,
                    }),
                },
            ],
        };
    }

    private async handleRestoreSession(args: { sessionId?: string }) {
        const { sessionId } = args;

        let result;
        if (sessionId) {
            const state = this.anchor.restoreSession(sessionId);
            if (!state) {
                return {
                    content: [{ type: 'text', text: `Session not found: ${sessionId}` }],
                    isError: true,
                };
            }
            result = { sessionId, state };
        } else {
            // Get latest session
            const latest = this.anchor.getLatestSession();
            if (!latest) {
                return {
                    content: [{ type: 'text', text: 'No sessions found' }],
                };
            }
            result = latest;
        }

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    private async handleListSessions() {
        const sessions = this.anchor.listSessions();

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({ sessions }, null, 2),
                },
            ],
        };
    }

    private async handleGetStats() {
        const cartographerStats = this.cartographer?.getStats() ?? { cacheSize: 0, maxCacheSize: 5000 };

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        workspace: this.workspacePath,
                        server: {
                            name: 'acl-mcp',
                            version: '0.1.3',
                        },
                        cache: cartographerStats,
                        shadow: {
                            running: this.shadow?.isRunning() ?? false,
                        },
                    }, null, 2),
                },
            ],
        };
    }

    // ─────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────

    private formatSkeleton(skeleton: FileSkeleton) {
        return {
            file: skeleton.filePath.replace(this.config.workspacePath, '').replace(/^[\\/\\\\]/, ''),
            language: skeleton.language,
            exports: skeleton.exports.map((e) => ({
                name: e.name,
                kind: e.kind,
                line: e.line,
                default: e.isDefault,
            })),
            imports: skeleton.imports.map((i) => ({
                source: i.source,
                specifiers: i.specifiers,
                typeOnly: i.isTypeOnly,
                line: i.line,
            })),
            classes: skeleton.classes.map((c) => ({
                name: c.name,
                line: c.line,
                extends: c.extends,
                implements: c.implements,
                methodCount: c.methods.length,
                propertyCount: c.properties.length,
            })),
            functions: skeleton.functions.map((f) => ({
                name: f.name,
                line: f.line,
                async: f.isAsync,
                exported: f.isExported,
            })),
            parseErrors: skeleton.parseErrors.length > 0 ? skeleton.parseErrors : undefined,
        };
    }

    // ─────────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────────

    async start(): Promise<void> {
        // Initialize with default workspace immediately
        await this.initWithWorkspace(this.workspacePath);

        // Connect to stdio transport
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
    }

    async stop(): Promise<void> {
        if (this.shadow) await this.shadow.stop();
        if (this.anchor) this.anchor.close();
        if (this.database) this.database.close();
        await this.server.close();
    }
}

// ─────────────────────────────────────────────────────────────
// Main Entry Point
// ─────────────────────────────────────────────────────────────

async function main() {
    // Get workspace from environment, or use cwd as fallback
    let workspacePath =
        process.env.ACL_WORKSPACE_PATH ||
        process.env.WORKSPACE_PATH;

    // Handle unexpanded variable from config
    if (!workspacePath || workspacePath.includes('${workspaceFolder}')) {
        workspacePath = process.cwd();
    }

    const { appendFileSync } = await import('fs');
    appendFileSync('C:/Users/Local User/ACL-MCP/debug.log', `[${new Date().toISOString()}] Workspace detected: ${workspacePath}\n`);

    const server = new AclServer(workspacePath);

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        await server.stop();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        await server.stop();
        process.exit(0);
    });

    await server.start();
}

main().catch(() => {
    process.exit(1);
});
