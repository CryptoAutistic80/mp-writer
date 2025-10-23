import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { RedisClientService } from '@mp-writer/nest-modules';
import type { Redis } from 'ioredis';

export type AiRunKind = 'deep-research' | 'letter';

export interface AiRunMetadata {
  status?: 'running' | 'completed' | 'error';
  responseId?: string | null;
  remainingCredits?: number | null;
  updatedAt?: number | null;
}

export interface AiRunStreamEntry<TPayload> {
  id: string;
  payload: TPayload;
}

@Injectable()
export class AiRunStore {
  private readonly logger = new Logger(AiRunStore.name);

  constructor(private readonly redisClientService: RedisClientService) {}

  private get client(): Redis {
    return this.redisClientService.getClient();
  }

  private getBaseKey(kind: AiRunKind, runKey: string): string {
    return `ai:run:${kind}:${runKey}`;
  }

  private getStreamKey(kind: AiRunKind, runKey: string): string {
    return `${this.getBaseKey(kind, runKey)}:stream`;
  }

  private getMetadataKey(kind: AiRunKind, runKey: string): string {
    return `${this.getBaseKey(kind, runKey)}:meta`;
  }

  private getLockKey(kind: AiRunKind, runKey: string): string {
    return `${this.getBaseKey(kind, runKey)}:lock`;
  }

  async acquireRunLock(kind: AiRunKind, runKey: string, ttlMs: number): Promise<string | null> {
    const client = this.client;
    const lockKey = this.getLockKey(kind, runKey);
    const token = randomUUID();

    const acquired = await client.setnx(lockKey, token);
    if (acquired !== 1) {
      return null;
    }

    if (ttlMs > 0) {
      await client.pexpire(lockKey, ttlMs);
    }

    return token;
  }

  async refreshRunLock(kind: AiRunKind, runKey: string, token: string | null, ttlMs: number): Promise<void> {
    if (!token) {
      return;
    }

    const client = this.client;
    const lockKey = this.getLockKey(kind, runKey);
    const current = await client.get(lockKey);
    if (current !== token) {
      return;
    }

    if (ttlMs > 0) {
      await client.pexpire(lockKey, ttlMs);
    }
  }

  async releaseRunLock(kind: AiRunKind, runKey: string, token: string | null): Promise<void> {
    if (!token) {
      return;
    }

    const client = this.client;
    const lockKey = this.getLockKey(kind, runKey);
    const releaseScript = `if redis.call("get", KEYS[1]) == ARGV[1] then\n  return redis.call("del", KEYS[1])\nend\nreturn 0`;

    try {
      await client.eval(releaseScript, 1, lockKey, token);
    } catch (error) {
      this.logger.warn(
        `Failed to release AI run lock for ${kind}:${runKey}: ${(error as Error)?.message ?? 'unknown error'}`,
      );
    }
  }

  async clearRun(kind: AiRunKind, runKey: string): Promise<void> {
    const client = this.client;
    await client.del(this.getStreamKey(kind, runKey), this.getMetadataKey(kind, runKey));
  }

  async appendStreamEvent<TPayload>(
    kind: AiRunKind,
    runKey: string,
    payload: TPayload,
    ttlMs: number,
  ): Promise<string | null> {
    const client = this.client;
    const streamKey = this.getStreamKey(kind, runKey);
    const serialized = JSON.stringify(payload);

    try {
      const id = await client.xadd(streamKey, '*', 'payload', serialized);
      await this.applyTtl(kind, runKey, ttlMs);
      return id;
    } catch (error) {
      this.logger.warn(
        `Failed to append AI run event for ${kind}:${runKey}: ${(error as Error)?.message ?? 'unknown error'}`,
      );
      return null;
    }
  }

  async applyTtl(kind: AiRunKind, runKey: string, ttlMs: number): Promise<void> {
    if (ttlMs <= 0) {
      return;
    }

    const client = this.client;
    const streamKey = this.getStreamKey(kind, runKey);
    const metaKey = this.getMetadataKey(kind, runKey);
    const pipeline = client.pipeline();
    pipeline.pexpire(streamKey, ttlMs);
    pipeline.pexpire(metaKey, ttlMs);
    await pipeline.exec();
  }

  async setMetadata(
    kind: AiRunKind,
    runKey: string,
    metadata: Partial<AiRunMetadata>,
    ttlMs: number,
  ): Promise<void> {
    const client = this.client;
    const metaKey = this.getMetadataKey(kind, runKey);
    const flattened: Record<string, string> = {};

    if (metadata.status) {
      flattened.status = metadata.status;
    }
    if (typeof metadata.responseId === 'string') {
      flattened.responseId = metadata.responseId;
    } else if (metadata.responseId === null) {
      flattened.responseId = '';
    }
    if (typeof metadata.remainingCredits === 'number' && Number.isFinite(metadata.remainingCredits)) {
      flattened.remainingCredits = metadata.remainingCredits.toString();
    } else if (metadata.remainingCredits === null) {
      flattened.remainingCredits = '';
    }
    if (typeof metadata.updatedAt === 'number' && Number.isFinite(metadata.updatedAt)) {
      flattened.updatedAt = metadata.updatedAt.toString();
    }

    if (Object.keys(flattened).length > 0) {
      await client.hset(metaKey, flattened);
    }

    await this.applyTtl(kind, runKey, ttlMs);
  }

  async getMetadata(kind: AiRunKind, runKey: string): Promise<AiRunMetadata | null> {
    const client = this.client;
    const metaKey = this.getMetadataKey(kind, runKey);
    const result = await client.hgetall(metaKey);

    if (!result || Object.keys(result).length === 0) {
      return null;
    }

    const metadata: AiRunMetadata = {};
    if (result.status === 'running' || result.status === 'completed' || result.status === 'error') {
      metadata.status = result.status;
    }

    if (typeof result.responseId === 'string') {
      const trimmed = result.responseId.trim();
      metadata.responseId = trimmed.length > 0 ? trimmed : null;
    }

    if (typeof result.remainingCredits === 'string') {
      const trimmed = result.remainingCredits.trim();
      if (trimmed.length === 0) {
        metadata.remainingCredits = null;
      } else {
        const parsed = Number.parseFloat(trimmed);
        metadata.remainingCredits = Number.isFinite(parsed) ? parsed : null;
      }
    }

    if (typeof result.updatedAt === 'string') {
      const parsed = Number.parseInt(result.updatedAt, 10);
      metadata.updatedAt = Number.isFinite(parsed) ? parsed : null;
    }

    return metadata;
  }

  async getStreamEntries<TPayload>(kind: AiRunKind, runKey: string): Promise<Array<AiRunStreamEntry<TPayload>>> {
    const client = this.client;
    const streamKey = this.getStreamKey(kind, runKey);

    try {
      const rawEntries = await client.xrange(streamKey, '-', '+');
      return rawEntries.map(([id, fields]) => ({ id, payload: this.deserializePayload<TPayload>(fields) })).filter(
        (entry): entry is AiRunStreamEntry<TPayload> => entry.payload !== null,
      );
    } catch (error) {
      if ((error as Error)?.message?.includes?.('no such key')) {
        return [];
      }
      this.logger.warn(
        `Failed to read AI run stream for ${kind}:${runKey}: ${(error as Error)?.message ?? 'unknown error'}`,
      );
      return [];
    }
  }

  async readStreamFrom<TPayload>(
    kind: AiRunKind,
    runKey: string,
    lastId: string,
    blockMs: number,
  ): Promise<Array<AiRunStreamEntry<TPayload>>> {
    const client = this.client;
    const streamKey = this.getStreamKey(kind, runKey);

    try {
      const response = await client.xread('BLOCK', blockMs, 'STREAMS', streamKey, lastId);
      if (!response || response.length === 0) {
        return [];
      }

      const [, entries] = response[0];
      return entries
        .map(([id, fields]) => ({ id, payload: this.deserializePayload<TPayload>(fields) }))
        .filter((entry): entry is AiRunStreamEntry<TPayload> => entry.payload !== null);
    } catch (error) {
      const message = (error as Error)?.message ?? 'unknown error';
      if (!message.includes('No such key')) {
        this.logger.warn(`Failed to tail AI run stream for ${kind}:${runKey}: ${message}`);
      }
      return [];
    }
  }

  private deserializePayload<TPayload>(fields: string[]): TPayload | null {
    const record: Record<string, string> = {};
    for (let index = 0; index < fields.length; index += 2) {
      const field = fields[index];
      const value = fields[index + 1];
      record[field] = value;
    }

    const rawPayload = record.payload;
    if (typeof rawPayload !== 'string') {
      return null;
    }

    try {
      return JSON.parse(rawPayload) as TPayload;
    } catch (error) {
      this.logger.warn(`Failed to parse AI run payload: ${(error as Error)?.message ?? 'unknown error'}`);
      return null;
    }
  }
}
