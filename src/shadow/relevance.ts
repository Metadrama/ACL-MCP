/**
 * ACL-MCP Relevance Engine
 * Determines which related files are relevant to surface proactively
 */

import { AclDatabase } from '../anchor/database.js';

export interface RelevanceScore {
    filePath: string;
    score: number;
    reason: string;
}

export interface RelevanceOptions {
    /** Maximum number of related files to return */
    maxResults?: number;
    /** Minimum score threshold (0-1) */
    minScore?: number;
    /** Include type-only imports */
    includeTypeOnly?: boolean;
}

const DEFAULT_OPTIONS: Required<RelevanceOptions> = {
    maxResults: 10,
    minScore: 0.1,
    includeTypeOnly: true,
};

export class RelevanceEngine {
    private database: AclDatabase;

    constructor(database: AclDatabase) {
        this.database = database;
    }

    /**
     * Get relevant files for a given file (conservative V1 approach)
     * Currently only returns direct imports and importers
     */
    getRelevantFiles(
        filePath: string,
        options: RelevanceOptions = {}
    ): RelevanceScore[] {
        const opts = { ...DEFAULT_OPTIONS, ...options };
        const scores: RelevanceScore[] = [];

        // Direct imports (what this file depends on)
        const imports = this.database.getImports(filePath);
        for (const imp of imports) {
            if (!opts.includeTypeOnly && imp.import_type === 'type-only') {
                continue;
            }

            const score = this.calculateImportScore(imp.import_type);
            if (score >= opts.minScore) {
                scores.push({
                    filePath: imp.target_path,
                    score,
                    reason: `imported (${imp.import_type})`,
                });
            }
        }

        // Direct importers (what depends on this file)
        const importers = this.database.getImporters(filePath);
        for (const imp of importers) {
            if (!opts.includeTypeOnly && imp.import_type === 'type-only') {
                continue;
            }

            // Importers are slightly less relevant than imports
            const score = this.calculateImportScore(imp.import_type) * 0.8;
            if (score >= opts.minScore) {
                scores.push({
                    filePath: imp.source_path,
                    score,
                    reason: `importer (${imp.import_type})`,
                });
            }
        }

        // Sort by score descending and limit results
        return scores
            .sort((a, b) => b.score - a.score)
            .slice(0, opts.maxResults);
    }

    /**
     * Calculate relevance score based on import type
     */
    private calculateImportScore(importType: string): number {
        switch (importType) {
            case 'static':
                return 1.0;
            case 'dynamic':
                return 0.7;
            case 'type-only':
                return 0.5;
            default:
                return 0.3;
        }
    }

    /**
     * Get transitive dependencies (for future enhancement)
     * Currently not used in V1 - returns empty
     */
    getTransitiveDependencies(
        _filePath: string,
        _depth: number = 2
    ): RelevanceScore[] {
        // V1: Conservative approach - only direct dependencies
        // Future: Implement BFS/DFS traversal with decay factor
        return [];
    }

    /**
     * Score adjustment based on file recency (for future enhancement)
     * Could integrate with session state to boost recently-edited files
     */
    applyRecencyBoost(
        scores: RelevanceScore[],
        recentFiles: string[]
    ): RelevanceScore[] {
        const recentSet = new Set(recentFiles);

        return scores.map((score) => {
            if (recentSet.has(score.filePath)) {
                return {
                    ...score,
                    score: Math.min(1.0, score.score * 1.2),
                    reason: `${score.reason}, recently edited`,
                };
            }
            return score;
        });
    }
}
