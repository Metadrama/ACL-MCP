/**
 * ACL-MCP Skeleton Cache
 * LRU cache for parsed file skeletons with hash-based invalidation
 */

import { createHash } from 'crypto';
import { readFileSync, statSync } from 'fs';

export interface CacheEntry<T> {
    value: T;
    hash: string;
    accessedAt: number;
}

export class LRUCache<T> {
    private cache: Map<string, CacheEntry<T>> = new Map();
    private maxSize: number;

    constructor(maxSize: number = 5000) {
        this.maxSize = maxSize;
    }

    get(key: string): CacheEntry<T> | undefined {
        const entry = this.cache.get(key);
        if (entry) {
            // Update access time for LRU tracking
            entry.accessedAt = Date.now();
        }
        return entry;
    }

    set(key: string, value: T, hash: string): void {
        // Evict oldest entries if at capacity
        if (this.cache.size >= this.maxSize) {
            this.evictOldest();
        }

        this.cache.set(key, {
            value,
            hash,
            accessedAt: Date.now(),
        });
    }

    has(key: string): boolean {
        return this.cache.has(key);
    }

    delete(key: string): boolean {
        return this.cache.delete(key);
    }

    clear(): void {
        this.cache.clear();
    }

    size(): number {
        return this.cache.size;
    }

    getMaxSize(): number {
        return this.maxSize;
    }

    private evictOldest(): void {
        // Remove 10% of oldest entries
        const entriesToRemove = Math.max(1, Math.floor(this.maxSize * 0.1));
        const sorted = [...this.cache.entries()].sort(
            (a, b) => a[1].accessedAt - b[1].accessedAt
        );

        for (let i = 0; i < entriesToRemove && i < sorted.length; i++) {
            this.cache.delete(sorted[i][0]);
        }
    }
}

/**
 * Skeleton-specific cache with file hash validation
 */
export class SkeletonCache<T> {
    private memoryCache: LRUCache<T>;
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
    private debounceMs: number;

    constructor(maxSize: number = 5000, debounceMs: number = 500) {
        this.memoryCache = new LRUCache<T>(maxSize);
        this.debounceMs = debounceMs;
    }

    /**
     * Get cached skeleton if hash matches current file
     */
    getIfValid(filePath: string): T | null {
        const entry = this.memoryCache.get(filePath);
        if (!entry) return null;

        // Validate hash against current file
        const currentHash = this.computeFileHash(filePath);
        if (currentHash === entry.hash) {
            return entry.value;
        }

        // Hash mismatch - invalidate
        this.memoryCache.delete(filePath);
        return null;
    }

    /**
     * Store skeleton with computed file hash
     */
    set(filePath: string, skeleton: T): void {
        const hash = this.computeFileHash(filePath);
        if (hash) {
            this.memoryCache.set(filePath, skeleton, hash);
        }
    }

    /**
     * Invalidate cache for a file (debounced)
     */
    invalidateDebounced(filePath: string, callback?: () => void): void {
        // Clear existing timer
        const existing = this.debounceTimers.get(filePath);
        if (existing) {
            clearTimeout(existing);
        }

        // Set new debounced invalidation
        const timer = setTimeout(() => {
            this.memoryCache.delete(filePath);
            this.debounceTimers.delete(filePath);
            callback?.();
        }, this.debounceMs);

        this.debounceTimers.set(filePath, timer);
    }

    /**
     * Immediate invalidation (no debounce)
     */
    invalidate(filePath: string): void {
        this.memoryCache.delete(filePath);
        const timer = this.debounceTimers.get(filePath);
        if (timer) {
            clearTimeout(timer);
            this.debounceTimers.delete(filePath);
        }
    }

    /**
     * Clear all cache
     */
    clear(): void {
        this.memoryCache.clear();
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();
    }

    /**
     * Get cache statistics
     */
    stats(): { size: number; maxSize: number } {
        return {
            size: this.memoryCache.size(),
            maxSize: this.memoryCache.getMaxSize(),
        };
    }

    /**
     * Compute MD5 hash of file contents
     */
    private computeFileHash(filePath: string): string | null {
        try {
            const stat = statSync(filePath);
            if (!stat.isFile()) return null;

            const content = readFileSync(filePath);
            return createHash('md5').update(content).digest('hex');
        } catch {
            return null;
        }
    }
}
