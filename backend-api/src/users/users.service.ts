import { InjectModel } from '@nestjs/mongoose';
import { Injectable } from '@nestjs/common';
import { Model } from 'mongoose';
import { User } from './schemas/user.schema';
import { Account } from './schemas/account.schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Account.name) private readonly accountModel: Model<Account>,
  ) {}

  async findById(id: string) {
    return this.userModel.findById(id).lean();
  }

  async findByEmail(email: string) {
    return this.userModel.findOne({ email }).lean();
  }

  async findOrCreateFromOAuth(input: {
    provider: string;
    providerId: string;
    email?: string;
    name?: string;
    image?: string;
  }) {
    // Try to find account mapping first
    const existingAccount = await this.accountModel
      .findOne({ provider: input.provider, providerId: input.providerId })
      .lean();
    if (existingAccount) {
      const accountUserId = (existingAccount.user as any)?.toString?.();
      if (accountUserId) {
        const user = await this.userModel.findById(accountUserId).lean();
        if (user) {
          await this.syncProfileFields(accountUserId, input, user);
          return this.userModel.findById(accountUserId).lean();
        }
      }
    }

    // Fall back to email if available
    let user = input.email ? await this.userModel.findOne({ email: input.email }).lean() : null;
    let userId = (user as any)?._id?.toString?.();

    if (!user) {
      const created = await this.userModel.create({
        email: input.email ?? `${input.provider}:${input.providerId}@example.invalid`,
        name: input.name,
        image: input.image,
      });
      userId = (created as any)?._id?.toString?.();
      user = created.toObject();
    }

    if (!userId) {
      userId = (user as any)?._id?.toString?.();
    }

    if (!userId) {
      return user;
    }

    // Ensure account mapping exists
    await this.accountModel.updateOne(
      { provider: input.provider, providerId: input.providerId },
      { $setOnInsert: { user: userId, provider: input.provider, providerId: input.providerId } },
      { upsert: true }
    );

    await this.syncProfileFields(userId, input, user as any);

    // Return lean
    const lean = await this.userModel.findById(userId).lean();
    return lean;
  }

  private async syncProfileFields(
    userId: string,
    input: { name?: string; image?: string },
    existing: Partial<User> | null,
  ) {
    const updates: Partial<User> = {};

    const nextName = input.name?.trim();
    if (nextName && nextName !== existing?.name) {
      updates.name = nextName;
    }

    const nextImage = input.image;
    if (nextImage && nextImage !== existing?.image) {
      updates.image = nextImage;
    }

    if (Object.keys(updates).length > 0) {
      await this.userModel.updateOne({ _id: userId }, { $set: updates });
    }
  }
}

