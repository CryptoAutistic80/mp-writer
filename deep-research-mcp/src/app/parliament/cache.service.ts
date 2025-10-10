import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly enabled: boolean;

  constructor() {
    this.enabled =
      process.env.CACHE_ENABLED?.toLowerCase() !== 'false' &&
      process.env.CACHE_ENABLED !== '0';

    if (this.enabled) {
      this.logger.log('Cache service enabled');
      // Cleanup expired entries every 5 minutes
      setInterval(() => this.cleanupExpired(), 5 * 60 * 1000);
    } else {
      this.logger.log('Cache service disabled');
    }
  }

  /**
   * Generate a cache key from URL and parameters
   */
  generateKey(url: string, params?: Record<string, unknown>): string {
    const data = params ? `${url}:${JSON.stringify(params)}` : url;
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Get cached value if available and not expired
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.enabled) {
      return null;
    }

    const entry = this.cache.get(key) as CacheEntry<T> | undefined;

    if (!entry) {
      return null;
    }

    const now = Date.now();
    const age = now - entry.timestamp;

    if (age > entry.ttl * 1000) {
      this.cache.delete(key);
      this.logger.debug(`Cache entry expired: ${key}`);
      return null;
    }

    this.logger.debug(`Cache hit: ${key} (age: ${Math.round(age / 1000)}s)`);
    return entry.data;
  }

  /**
   * Store value in cache with TTL in seconds
   */
  async set<T>(key: string, value: T, ttl: number): Promise<void> {
    if (!this.enabled) {
      return;
    }

    this.cache.set(key, {
      data: value,
      timestamp: Date.now(),
      ttl,
    });

    this.logger.debug(`Cache set: ${key} (TTL: ${ttl}s)`);
  }

  /**
   * Clear all cached entries
   */
  async clear(): Promise<void> {
    this.cache.clear();
    this.logger.log('Cache cleared');
  }

  /**
   * Remove expired entries from cache
   */
  private cleanupExpired(): void {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      const age = now - entry.timestamp;
      if (age > entry.ttl * 1000) {
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      this.logger.debug(`Cleaned up ${removed} expired cache entries`);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; enabled: boolean } {
    return {
      size: this.cache.size,
      enabled: this.enabled,
    };
  }
}

