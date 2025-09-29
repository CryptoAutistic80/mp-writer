import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { UserCreditsModule } from '../user-credits/user-credits.module';
import { WritingDeskJobsModule } from '../writing-desk-jobs/writing-desk-jobs.module';
import { UserMpModule } from '../user-mp/user-mp.module';
import { UsersModule } from '../users/users.module';
import { UserAddressModule } from '../user-address-store/user-address.module';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';

@Module({
  imports: [
    ConfigModule,
    UsersModule,
    UserAddressModule,
    UserCreditsModule,
    forwardRef(() => WritingDeskJobsModule),
    UserMpModule,
  ],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
