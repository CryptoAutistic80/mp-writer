import { Module } from '@nestjs/common';

import { RedisModule } from './redis';

@Module({
  imports: [RedisModule],
  controllers: [],
  providers: [],
  exports: [RedisModule],
})
export class NestModulesModule {}
