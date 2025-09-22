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
      const user = await this.userModel.findById(existingAccount.user).lean();
      if (user) return user;
    }

    // Atomic user creation/lookup to prevent race condition during concurrent OAuth logins
    // This fixes avatar fallback issues caused by duplicate user records
    const userEmail = input.email ?? `${input.provider}:${input.providerId}@example.invalid`;
    const user = await this.userModel.findOneAndUpdate(
      { email: userEmail },
      {
        $setOnInsert: {
          email: userEmail,
          name: input.name,
          image: input.image,
        },
        // Always update name and image in case they changed from OAuth provider
        $set: {
          name: input.name,
          image: input.image,
        }
      },
      {
        upsert: true,
        new: true, // Return document after update
        lean: true
      }
    );

    // Ensure account mapping exists
    await this.accountModel.updateOne(
      { provider: input.provider, providerId: input.providerId },
      { $setOnInsert: { user: (user as any)._id, provider: input.provider, providerId: input.providerId } },
      { upsert: true }
    );

    return user;
  }
}

