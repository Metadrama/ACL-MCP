/**
 * ACL-MCP Cartographer Module
 * Structural mapping of codebase via AST parsing
 */

import { createHash } from 'crypto';
import { resolve, relative, join, dirname } from 'path';
import { readdirSync, statSync, existsSync, readFileSync } from 'fs';
import { SkeletonCache } from './cache.js';
import { parseFile, FileSkeleton, detectLanguage } from './parser.js';
import { AclConfig } from '../config.js';
import { AclDatabase } from '../anchor/database.js';

export interface CartographerOptions {
    config: AclConfig;
    database: AclDatabase;
}

export interface DirectoryMap {
    path: string;
    relativePath: string;
    files: FileInfo[];
    subdirectories: string[];
    totalFiles: number;
}

export interface FileInfo {
    path: string;
    relativePath: string;
    language: string | null;
    skeleton?: FileSkeleton;
}

export class Cartographer {
    private config: AclConfig;
    private database: AclDatabase;
    private cache: SkeletonCache<FileSkeleton>;

    constructor(options: CartographerOptions) {
        this.config = options.config;
        this.database = options.database;
        this.cache = new SkeletonCache<FileSkeleton>(
            options.config.cache.maxSkeletons,
            options.config.cache.debounceMs
        );
    }

    /**
     * Get skeleton for a single file (lazy parsing)
     */
    async getSkeleton(filePath: string): Promise<FileSkeleton | null> {
        const absolutePath = resolve(this.config.workspacePath, filePath);

        // Check memory cache first
        const cached = this.cache.getIfValid(absolutePath);
        if (cached) {
            return cached;
        }

        // Check database cache
        const dbRecord = this.database.getSkeleton(absolutePath);
        if (dbRecord) {
            // Validate hash
            const skeleton = JSON.parse(dbRecord.skeleton_json) as FileSkeleton;
            // Store in memory cache
            this.cache.set(absolutePath, skeleton);
            return skeleton;
        }

        // Parse file
        const skeleton = await parseFile(absolutePath, this.config.maxFileSizeBytes);
        if (!skeleton) {
            return null;
        }

        // Store in caches
        this.cache.set(absolutePath, skeleton);
        this.persistSkeleton(absolutePath, skeleton);

        return skeleton;
    }

    /**
     * Get skeletons for multiple files
     */
    async getSkeletons(filePaths: string[]): Promise<Map<string, FileSkeleton>> {
        const results = new Map<string, FileSkeleton>();

        await Promise.all(
            filePaths.map(async (path) => {
                const skeleton = await this.getSkeleton(path);
                if (skeleton) {
                    results.set(path, skeleton);
                }
            })
        );

        return results;
    }

    /**
     * Map a directory structure (without parsing file contents)
     */
    mapDirectory(
        dirPath: string,
        maxDepth: number = 3
    ): DirectoryMap {
        const absolutePath = resolve(this.config.workspacePath, dirPath);
        const relativePath = relative(this.config.workspacePath, absolutePath);

        const result: DirectoryMap = {
            path: absolutePath,
            relativePath: relativePath || '.',
            files: [],
            subdirectories: [],
            totalFiles: 0,
        };

        this.walkDirectory(absolutePath, result, 0, maxDepth);

        return result;
    }

    private walkDirectory(
        dir: string,
        result: DirectoryMap,
        depth: number,
        maxDepth: number
    ): void {
        if (depth > maxDepth) return;

        let entries: string[];
        try {
            entries = readdirSync(dir);
        } catch {
            return;
        }

        for (const entry of entries) {
            const fullPath = join(dir, entry);
            const relativePath = relative(this.config.workspacePath, fullPath);

            // Check exclusions
            if (this.isExcluded(relativePath)) {
                continue;
            }

            let stat;
            try {
                stat = statSync(fullPath);
            } catch {
                continue;
            }

            if (stat.isDirectory()) {
                result.subdirectories.push(relativePath);
                this.walkDirectory(fullPath, result, depth + 1, maxDepth);
            } else if (stat.isFile()) {
                const language = detectLanguage(fullPath);
                if (language || this.isSupportedFile(entry)) {
                    result.files.push({
                        path: fullPath,
                        relativePath,
                        language,
                    });
                    result.totalFiles++;
                }
            }
        }
    }

    private isExcluded(relativePath: string): boolean {
        // Check include zones first (if specified)
        if (this.config.includeZones.length > 0) {
            const inIncludeZone = this.config.includeZones.some((zone) =>
                relativePath.startsWith(zone)
            );
            if (!inIncludeZone) return true;
        }

        // Check exclude zones
        return this.config.excludeZones.some(
            (zone) =>
                relativePath === zone ||
                relativePath.startsWith(zone + '/') ||
                relativePath.startsWith(zone + '\\')
        );
    }

    private isSupportedFile(filename: string): boolean {
        // Common config/doc files that might be useful
        const supported = [
            'package.json',
            'tsconfig.json',
            'pyproject.toml',
            'Cargo.toml',
            'go.mod',
            'README.md',
            '.env.example',
        ];
        return supported.includes(filename);
    }

    /**
     * Get imports for a file (for building import graph)
     */
    async getImports(filePath: string): Promise<string[]> {
        const skeleton = await this.getSkeleton(filePath);
        if (!skeleton) return [];

        return skeleton.imports.map((imp) => {
            // Resolve relative imports
            if (imp.source.startsWith('.')) {
                const fileDir = dirname(resolve(this.config.workspacePath, filePath));
                return resolve(fileDir, imp.source);
            }
            return imp.source;
        });
    }

    /**
     * Get related files based on import graph
     */
    async getRelatedFiles(
        filePath: string,
        depth: number = 1
    ): Promise<string[]> {
        const absolutePath = resolve(this.config.workspacePath, filePath);
        const visited = new Set<string>();
        const queue: Array<{ path: string; currentDepth: number }> = [
            { path: absolutePath, currentDepth: 0 },
        ];

        while (queue.length > 0) {
            const { path, currentDepth } = queue.shift()!;

            if (visited.has(path) || currentDepth > depth) {
                continue;
            }
            visited.add(path);

            // Get imports from database cache
            const importEdges = this.database.getImports(path);
            for (const edge of importEdges) {
                if (!visited.has(edge.target_path)) {
                    queue.push({ path: edge.target_path, currentDepth: currentDepth + 1 });
                }
            }

            // Get importers (reverse dependencies)
            const importerEdges = this.database.getImporters(path);
            for (const edge of importerEdges) {
                if (!visited.has(edge.source_path)) {
                    queue.push({
                        path: edge.source_path,
                        currentDepth: currentDepth + 1,
                    });
                }
            }
        }

        // Remove the original file from results
        visited.delete(absolutePath);
        return Array.from(visited);
    }

    /**
     * Force refresh of a file's skeleton
     */
    async refreshSkeleton(filePath: string): Promise<FileSkeleton | null> {
        const absolutePath = resolve(this.config.workspacePath, filePath);

        // Invalidate caches
        this.cache.invalidate(absolutePath);
        this.database.deleteSkeleton(absolutePath);
        this.database.clearImportsForFile(absolutePath);

        // Re-parse
        return this.getSkeleton(filePath);
    }

    /**
     * Handle file change notification (debounced)
     */
    onFileChanged(filePath: string): void {
        const absolutePath = resolve(this.config.workspacePath, filePath);

        this.cache.invalidateDebounced(absolutePath, () => {
            // After debounce, also clear database cache
            this.database.deleteSkeleton(absolutePath);
            this.database.clearImportsForFile(absolutePath);
        });
    }

    /**
     * Get cache statistics
     */
    getStats(): { cacheSize: number; maxCacheSize: number } {
        const stats = this.cache.stats();
        return {
            cacheSize: stats.size,
            maxCacheSize: stats.maxSize,
        };
    }

    private persistSkeleton(filePath: string, skeleton: FileSkeleton): void {
        // Compute file hash for the skeleton record
        let hash: string;
        try {
            const content = readFileSync(filePath);
            hash = createHash('md5').update(content).digest('hex');
        } catch {
            hash = '';
        }

        // Save skeleton to database
        this.database.upsertSkeleton(
            filePath,
            hash,
            skeleton.language,
            JSON.stringify(skeleton)
        );

        // Update import graph
        this.database.clearImportsForFile(filePath);
        for (const imp of skeleton.imports) {
            // Only track local imports (not node_modules)
            if (imp.source.startsWith('.') || imp.source.startsWith('/')) {
                const targetPath = this.resolveImportPath(filePath, imp.source);
                if (targetPath) {
                    this.database.addImportEdge(
                        filePath,
                        targetPath,
                        imp.isTypeOnly ? 'type-only' : imp.isDynamic ? 'dynamic' : 'static'
                    );
                }
            }
        }
    }

    private resolveImportPath(
        fromPath: string,
        importSource: string
    ): string | null {
        const dir = dirname(fromPath);
        const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs'];

        // Try exact path first
        const exactPath = resolve(dir, importSource);
        if (existsSync(exactPath)) {
            return exactPath;
        }

        // Try with extensions
        for (const ext of extensions) {
            const withExt = exactPath + ext;
            if (existsSync(withExt)) {
                return withExt;
            }

            // Try /index.{ext}
            const indexPath = join(exactPath, `index${ext}`);
            if (existsSync(indexPath)) {
                return indexPath;
            }
        }

        return null;
    }
}
