import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserMp, UserMpSchema } from './schemas/user-mp.schema';
import { UserMpService } from './user-mp.service';
import { UserMpController } from './user-mp.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: UserMp.name, schema: UserMpSchema }])],
  providers: [UserMpService],
  controllers: [UserMpController],
  exports: [UserMpService],
})
export class UserMpModule {}

