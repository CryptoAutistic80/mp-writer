import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CreateUserStoredLetterDto } from './dto/create-user-stored-letter.dto';
import { UserStoredLettersRepository } from './user-stored-letters.repository';
import { EncryptionService } from '../crypto/encryption.service';
import {
  StoredLetterMetadata,
  StoredLetterPayload,
  UserStoredLetterRecord,
  UserStoredLetterResource,
} from './user-stored-letters.types';
import { WRITING_DESK_LETTER_TONES, WritingDeskLetterTone } from '../writing-desk-jobs/writing-desk-jobs.types';

@Injectable()
export class UserStoredLettersService {
  constructor(
    private readonly repository: UserStoredLettersRepository,
    private readonly encryption: EncryptionService,
  ) {}

  async createLetter(userId: string, input: CreateUserStoredLetterDto): Promise<UserStoredLetterResource> {
    const sanitized = this.sanitiseInput(input);
    const payload: StoredLetterPayload = {
      jobId: sanitized.jobId,
      letterHtml: sanitized.letterHtml,
      letterJson: sanitized.letterJson,
      references: sanitized.references,
      responseId: sanitized.responseId,
      tone: sanitized.tone,
      metadata: sanitized.metadata,
    };

    const ciphertext = this.encryption.encryptObject(payload);
    const letterId = randomUUID();
    const record = await this.repository.create({
      userId,
      letterId,
      ciphertext,
      mpName: sanitized.metadata.mpName,
      tone: sanitized.tone,
    });

    return this.toResource(record);
  }

  private sanitiseInput(input: CreateUserStoredLetterDto) {
    const normaliseMultiline = (value: string | undefined | null) => {
      if (typeof value !== 'string') return '';
      return value.replace(/\r\n/g, '\n');
    };

    const toNullableString = (value: string | undefined | null) => {
      if (typeof value !== 'string') return null;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    };

    const normaliseTone = (value: string | null | undefined): WritingDeskLetterTone | null => {
      if (!value) return null;
      const trimmed = value.trim();
      return (WRITING_DESK_LETTER_TONES as readonly string[]).includes(trimmed)
        ? (trimmed as WritingDeskLetterTone)
        : null;
    };

    const normaliseReferences = (values: string[] | undefined) => {
      if (!Array.isArray(values)) return [];
      const seen = new Set<string>();
      const cleaned: string[] = [];
      for (const value of values) {
        if (typeof value !== 'string') continue;
        const trimmed = value.trim();
        if (!trimmed || seen.has(trimmed)) continue;
        seen.add(trimmed);
        cleaned.push(trimmed);
      }
      return cleaned.slice(0, 100);
    };

    const metadata = this.normaliseMetadata(input.metadata);

    return {
      jobId: toNullableString(input.jobId),
      letterHtml: normaliseMultiline(input.letterHtml),
      letterJson: toNullableString(normaliseMultiline(input.letterJson)),
      references: normaliseReferences(input.references),
      responseId: toNullableString(input.responseId),
      tone: normaliseTone(input.tone ?? null),
      metadata,
    };
  }

  private normaliseMetadata(metadata: CreateUserStoredLetterDto['metadata']): StoredLetterMetadata {
    const toValue = (value: unknown) => {
      if (typeof value !== 'string') return '';
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : '';
    };

    const safe = metadata ?? {};

    return {
      mpName: toValue((safe as any).mpName),
      mpAddress1: toValue((safe as any).mpAddress1),
      mpAddress2: toValue((safe as any).mpAddress2),
      mpCity: toValue((safe as any).mpCity),
      mpCounty: toValue((safe as any).mpCounty),
      mpPostcode: toValue((safe as any).mpPostcode),
      date: toValue((safe as any).date),
      senderName: toValue((safe as any).senderName),
      senderAddress1: toValue((safe as any).senderAddress1),
      senderAddress2: toValue((safe as any).senderAddress2),
      senderAddress3: toValue((safe as any).senderAddress3),
      senderCity: toValue((safe as any).senderCity),
      senderCounty: toValue((safe as any).senderCounty),
      senderPostcode: toValue((safe as any).senderPostcode),
      senderTelephone: toValue((safe as any).senderTelephone),
    };
  }

  private toResource(record: UserStoredLetterRecord): UserStoredLetterResource {
    return {
      letterId: record.letterId,
      savedAt: record.createdAt.toISOString(),
      tone: record.tone,
      mpName: record.mpName,
    };
  }
}
