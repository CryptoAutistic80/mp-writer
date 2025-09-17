import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WritingSessionsController } from './writing-sessions.controller';
import { WritingSessionsService } from './writing-sessions.service';
import { WritingSession, WritingSessionSchema } from './schemas/writing-session.schema';
import { AiModule } from '../ai/ai.module';
import { UserMpModule } from '../user-mp/user-mp.module';
import { UserAddressModule } from '../user-address-store/user-address.module';
import { UserCreditsModule } from '../user-credits/user-credits.module';
import { DeepResearchService } from './deep-research.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: WritingSession.name, schema: WritingSessionSchema }]),
    AiModule,
    UserMpModule,
    UserAddressModule,
    UserCreditsModule,
  ],
  controllers: [WritingSessionsController],
  providers: [WritingSessionsService, DeepResearchService],
})
export class WritingSessionsModule {}
