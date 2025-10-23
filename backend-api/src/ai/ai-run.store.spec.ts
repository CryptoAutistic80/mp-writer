import { AiRunStore, AiRunStreamEntry, AiRunMetadata } from './ai-run.store';
import type { RedisClientService } from '@mp-writer/nest-modules';

jest.mock('node:crypto', () => ({
  randomUUID: jest.fn(() => 'test-token'),
}));

describe('AiRunStore', () => {
  const createStore = () => {
    const pipeline = {
      pexpire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };

    const redis = {
      setnx: jest.fn(),
      pexpire: jest.fn(),
      get: jest.fn(),
      del: jest.fn(),
      xadd: jest.fn(),
      xrange: jest.fn(),
      xread: jest.fn(),
      hset: jest.fn(),
      hgetall: jest.fn(),
      pipeline: jest.fn(() => pipeline),
      eval: jest.fn(),
    } as any;

    const redisClientService = {
      getClient: jest.fn(() => redis),
    } as unknown as RedisClientService & { getClient: jest.MockedFunction<() => any> };

    return { store: new AiRunStore(redisClientService), redis, pipeline };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('acquires a run lock and applies TTL when available', async () => {
    const { store, redis } = createStore();
    redis.setnx.mockResolvedValue(1);
    redis.pexpire.mockResolvedValue(1);

    const token = await store.acquireRunLock('letter', 'run-1', 5000);

    expect(token).toBe('test-token');
    expect(redis.setnx).toHaveBeenCalledWith('ai:run:letter:run-1:lock', 'test-token');
    expect(redis.pexpire).toHaveBeenCalledWith('ai:run:letter:run-1:lock', 5000);
  });

  it('returns null when a run lock cannot be acquired', async () => {
    const { store, redis } = createStore();
    redis.setnx.mockResolvedValue(0);

    const token = await store.acquireRunLock('deep-research', 'run-2', 3000);

    expect(token).toBeNull();
    expect(redis.pexpire).not.toHaveBeenCalled();
  });

  it('applies TTL to stream and metadata keys when ttlMs is positive', async () => {
    const { store, redis, pipeline } = createStore();

    await store.applyTtl('letter', 'run-3', 12000);

    expect(redis.pipeline).toHaveBeenCalledTimes(1);
    expect(pipeline.pexpire).toHaveBeenNthCalledWith(1, 'ai:run:letter:run-3:stream', 12000);
    expect(pipeline.pexpire).toHaveBeenNthCalledWith(2, 'ai:run:letter:run-3:meta', 12000);
    expect(pipeline.exec).toHaveBeenCalledTimes(1);
  });

  it('skips TTL application when ttlMs is not positive', async () => {
    const { store, redis } = createStore();

    await store.applyTtl('deep-research', 'run-4', 0);

    expect(redis.pipeline).not.toHaveBeenCalled();
  });

  it('returns cached metadata when available', async () => {
    const { store, redis } = createStore();
    redis.hgetall.mockResolvedValue({
      status: 'completed',
      responseId: ' resp-1 ',
      remainingCredits: ' 4 ',
      updatedAt: `${1700000000000}`,
    });

    const metadata = await store.getMetadata('letter', 'run-5');

    const expected: AiRunMetadata = {
      status: 'completed',
      responseId: 'resp-1',
      remainingCredits: 4,
      updatedAt: 1700000000000,
    };
    expect(metadata).toEqual(expected);
  });

  it('replays cached stream entries and filters invalid payloads', async () => {
    const { store, redis } = createStore();
    const goodPayload = { type: 'delta', text: 'Hello world' };
    redis.xrange.mockResolvedValue([
      ['0-1', ['payload', JSON.stringify(goodPayload)]],
      ['0-2', ['payload', '{"invalidJson":']],
    ]);

    const entries = await store.getStreamEntries<typeof goodPayload>('deep-research', 'run-6');

    const expected: Array<AiRunStreamEntry<typeof goodPayload>> = [
      { id: '0-1', payload: goodPayload },
    ];
    expect(entries).toEqual(expected);
  });
});
