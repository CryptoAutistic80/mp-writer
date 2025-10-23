import { Module } from '@nestjs/common';
import { RedisModule as IoRedisModule } from '@nestjs-modules/ioredis';

import { RedisClientService } from './redis-client.service';

@Module({
  imports: [
    IoRedisModule.forRootAsync({
      useFactory: async () => {
        const url = process.env.REDIS_URL;

        if (!url) {
          throw new Error('REDIS_URL environment variable is not defined.');
        }

        return {
          config: {
            url,
          },
        };
      },
    }),
  ],
  providers: [RedisClientService],
  exports: [IoRedisModule, RedisClientService],
})
export class RedisModule {}
