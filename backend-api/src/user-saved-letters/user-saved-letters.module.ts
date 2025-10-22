import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserSavedLettersController } from './user-saved-letters.controller';
import { UserSavedLettersService } from './user-saved-letters.service';
import { UserSavedLetter, UserSavedLetterSchema } from './schemas/user-saved-letter.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: UserSavedLetter.name, schema: UserSavedLetterSchema }])],
  controllers: [UserSavedLettersController],
  providers: [UserSavedLettersService],
  exports: [UserSavedLettersService],
})
export class UserSavedLettersModule {}

export { ListSavedLettersDto } from './dto/list-saved-letters.dto';
export type {
  PaginatedUserSavedLettersResult,
  SavedLetterMetadata,
  UserSavedLetterResource,
} from './user-saved-letters.service';
