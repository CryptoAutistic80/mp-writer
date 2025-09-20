import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { UserCreditsModule } from '../user-credits/user-credits.module';
import { UserMpModule } from '../user-mp/user-mp.module';
import { UserAddressModule } from '../user-address-store/user-address.module';

@Module({
  imports: [ConfigModule, UserCreditsModule, UserMpModule, UserAddressModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}

