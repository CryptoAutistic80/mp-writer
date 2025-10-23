import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Redis } from 'ioredis';

@Injectable()
export class RedisClientService implements OnModuleDestroy {
  constructor(@InjectRedis() private readonly client: Redis) {}

  getClient(): Redis {
    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status !== 'end') {
      await this.client.quit();
    }
  }
}
