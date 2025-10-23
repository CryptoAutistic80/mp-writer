import { Module } from '@nestjs/common';
import { RedisModule } from '@mp-writer/nest-modules';
import { MpsController } from './mps.controller';
import { MpsService } from './mps.service';

@Module({
  imports: [RedisModule],
  providers: [MpsService],
  controllers: [MpsController],
})
export class MpsModule {}

