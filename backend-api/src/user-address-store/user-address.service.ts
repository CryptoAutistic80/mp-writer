import { InjectModel } from '@nestjs/mongoose';
import { Injectable } from '@nestjs/common';
import { Model } from 'mongoose';
import { UserAddress } from './schemas/user-address.schema';
import { EncryptionService } from '../crypto/encryption.service';

function normalisePostcode(input: string) {
  const tight = (input || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(tight)) return input || '';
  return `${tight.slice(0, -3)} ${tight.slice(-3)}`;
}

@Injectable()
export class UserAddressService {
  constructor(
    @InjectModel(UserAddress.name) private readonly model: Model<UserAddress>,
    private readonly enc: EncryptionService,
  ) {}

  async getMine(userId: string) {
    const doc = await this.model.findOne({ user: userId }).lean();
    if (!doc) return { address: null };
    try {
      const address = this.enc.decryptObject<any>(doc.ciphertext) ?? {};
      const normalised = {
        line1: typeof address.line1 === 'string' ? address.line1 : '',
        line2: typeof address.line2 === 'string' ? address.line2 : '',
        city: typeof address.city === 'string' ? address.city : '',
        county: typeof address.county === 'string' ? address.county : '',
        postcode: typeof address.postcode === 'string' ? address.postcode : '',
        telephone: typeof address.telephone === 'string' ? address.telephone : '',
      };
      return { address: normalised };
    } catch {
      // If decryption fails, treat as no data (could also surface an error)
      return { address: null };
    }
  }

  async upsertMine(
    userId: string,
    input: { line1: string; line2?: string; city?: string; county?: string; postcode: string; telephone?: string },
  ) {
    const payload = {
      line1: input.line1?.trim?.() || '',
      line2: input.line2?.trim?.() || '',
      city: input.city?.trim?.() || '',
      county: input.county?.trim?.() || '',
      postcode: normalisePostcode(input.postcode || ''),
      telephone: input.telephone?.trim?.() || '',
    };
    const ciphertext = this.enc.encryptObject(payload);
    await this.model.updateOne(
      { user: userId },
      { $set: { ciphertext } },
      { upsert: true }
    );
    return this.getMine(userId);
  }

  async clearMine(userId: string) {
    await this.model.deleteOne({ user: userId });
    return { cleared: true };
  }
}
