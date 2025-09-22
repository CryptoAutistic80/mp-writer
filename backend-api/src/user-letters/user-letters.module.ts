import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { UserLettersController } from './user-letters.controller';
import { UserLettersService } from './user-letters.service';
import { UserLetter, UserLetterSchema } from './schemas/user-letter.schema';
import { EncryptionService } from '../crypto/encryption.service';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([{ name: UserLetter.name, schema: UserLetterSchema }]),
  ],
  controllers: [UserLettersController],
  providers: [UserLettersService, EncryptionService],
  exports: [UserLettersService, MongooseModule],
})
export class UserLettersModule {}
