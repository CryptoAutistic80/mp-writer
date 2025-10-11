import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserStoredLetter, UserStoredLetterDocument } from './schema/user-stored-letter.schema';
import { UserStoredLetterRecord, WritingDeskLetterTone } from './user-stored-letters.types';

@Injectable()
export class UserStoredLettersRepository {
  constructor(
    @InjectModel(UserStoredLetter.name)
    private readonly model: Model<UserStoredLetterDocument>,
  ) {}

  async create(input: {
    userId: string;
    letterId: string;
    ciphertext: string;
    mpName: string;
    tone: WritingDeskLetterTone | null;
  }): Promise<UserStoredLetterRecord> {
    const doc = await this.model.create({
      userId: input.userId,
      letterId: input.letterId,
      ciphertext: input.ciphertext,
      mpName: input.mpName,
      tone: input.tone,
    });
    const plain = doc.toObject();
    return plain as unknown as UserStoredLetterRecord;
  }
}
