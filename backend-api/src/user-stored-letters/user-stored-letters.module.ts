import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserStoredLettersController } from './user-stored-letters.controller';
import { UserStoredLettersService } from './user-stored-letters.service';
import { UserStoredLettersRepository } from './user-stored-letters.repository';
import { UserStoredLetter, UserStoredLetterSchema } from './schema/user-stored-letter.schema';
import { EncryptionService } from '../crypto/encryption.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: UserStoredLetter.name, schema: UserStoredLetterSchema }]),
  ],
  controllers: [UserStoredLettersController],
  providers: [UserStoredLettersService, UserStoredLettersRepository, EncryptionService],
  exports: [UserStoredLettersService],
})
export class UserStoredLettersModule {}
