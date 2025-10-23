import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from '@mp-writer/nest-modules';
import { UserCreditsModule } from '../user-credits/user-credits.module';
import { WritingDeskJobsModule } from '../writing-desk-jobs/writing-desk-jobs.module';
import { UserMpModule } from '../user-mp/user-mp.module';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { UsersModule } from '../users/users.module';
import { UserAddressModule } from '../user-address-store/user-address.module';
import { AiRunStore } from './ai-run.store';

@Module({
  imports: [
    ConfigModule,
    UserCreditsModule,
    forwardRef(() => WritingDeskJobsModule),
    UserMpModule,
    UsersModule,
    UserAddressModule,
    RedisModule,
  ],
  controllers: [AiController],
  providers: [AiService, AiRunStore],
  exports: [AiService],
})
export class AiModule {}
