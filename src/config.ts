/**
 * ACL-MCP Configuration
 * Handles configuration loading and defaults
 */

import { existsSync, readFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';

export interface AclConfig {
    /** Root workspace path */
    workspacePath: string;

    /** Subdirectories to include (relative paths). Empty = all */
    includeZones: string[];

    /** Subdirectories to exclude (relative paths) */
    excludeZones: string[];

    /** Supported languages for Tree-sitter parsing */
    languages: string[];

    /** Maximum file size to parse (bytes) */
    maxFileSizeBytes: number;

    /** Cache settings */
    cache: {
        /** Maximum number of skeletons in memory */
        maxSkeletons: number;
        /** Debounce delay for file changes (ms) */
        debounceMs: number;
    };

    /** Server settings */
    server: {
        /** Server name for MCP registration */
        name: string;
        /** Server version */
        version: string;
    };
}

const DEFAULT_CONFIG: Omit<AclConfig, 'workspacePath'> = {
    includeZones: [],
    excludeZones: [
        'node_modules',
        '.git',
        'dist',
        'build',
        'out',
        '.next',
        '.nuxt',
        'vendor',
        '__pycache__',
        '.venv',
        'venv',
        'target', // Rust
    ],
    languages: ['typescript', 'javascript', 'python', 'go', 'rust'],
    maxFileSizeBytes: 1024 * 1024, // 1MB
    cache: {
        maxSkeletons: 5000,
        debounceMs: 500,
    },
    server: {
        name: 'acl-mcp',
        version: '0.1.0',
    },
};

/**
 * Load configuration from workspace .acl/config.json or use defaults
 */
export function loadConfig(workspacePath: string): AclConfig {
    const resolvedPath = resolve(workspacePath);
    const configPath = join(resolvedPath, '.acl', 'config.json');

    // Ensure .acl directory exists
    const aclDir = join(resolvedPath, '.acl');
    if (!existsSync(aclDir)) {
        mkdirSync(aclDir, { recursive: true });
    }

    let userConfig: Partial<AclConfig> = {};

    if (existsSync(configPath)) {
        try {
            const content = readFileSync(configPath, 'utf-8');
            userConfig = JSON.parse(content);
        } catch (error) {
            // Logging disabled for MCP compatibility
        }
    }

    return {
        workspacePath: resolvedPath,
        includeZones: userConfig.includeZones ?? DEFAULT_CONFIG.includeZones,
        excludeZones: userConfig.excludeZones ?? DEFAULT_CONFIG.excludeZones,
        languages: userConfig.languages ?? DEFAULT_CONFIG.languages,
        maxFileSizeBytes:
            userConfig.maxFileSizeBytes ?? DEFAULT_CONFIG.maxFileSizeBytes,
        cache: {
            ...DEFAULT_CONFIG.cache,
            ...userConfig.cache,
        },
        server: {
            ...DEFAULT_CONFIG.server,
            ...userConfig.server,
        },
    };
}

/**
 * Get configuration from environment variables
 */
export function getWorkspaceFromEnv(): string | undefined {
    return (
        process.env.ACL_WORKSPACE_PATH ||
        process.env.WORKSPACE_PATH ||
        process.cwd()
    );
}
