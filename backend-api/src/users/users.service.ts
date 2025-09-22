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
    // Try to find account mapping first, accounting for possible duplicates
    const matchingAccounts = await this.accountModel
      .find({ provider: input.provider, providerId: input.providerId })
      .sort({ createdAt: 1 })
      .lean();

    const accountUserIds = Array.from(
      new Set(
        matchingAccounts
          .map((account: any) => this.normalizeDocumentId(account?.user))
          .filter((value): value is string => !!value)
      )
    );

    let user: Partial<User> | null = null;
    let userId: string | null = null;

    if (accountUserIds.length > 0) {
      const users = await this.userModel
        .find({ _id: { $in: accountUserIds } })
        .lean();

      const usersById = new Map(
        users.map((candidate: any) => [this.normalizeDocumentId(candidate?._id), candidate])
      );

      for (const account of matchingAccounts) {
        const accountUserId = this.normalizeDocumentId((account as any)?.user);
        if (!accountUserId) continue;
        const candidate = usersById.get(accountUserId);
        if (candidate) {
          user = candidate;
          userId = accountUserId;
          break;
        }
      }
    }

    // Fall back to email if available
    if (!user && input.email) {
      const emailMatches = await this.userModel
        .find({ email: input.email })
        .sort({ createdAt: 1 })
        .lean();

      if (emailMatches.length > 0) {
        let chosen: any = null;
        for (let index = emailMatches.length - 1; index >= 0; index -= 1) {
          const candidate = emailMatches[index];
          if (candidate?.image) {
            chosen = candidate;
            break;
          }
        }
        if (!chosen) {
          chosen = emailMatches[emailMatches.length - 1];
        }

        user = chosen;
        userId = this.normalizeDocumentId((chosen as any)?._id);
      }
    }

    if (!user) {
      const created = await this.userModel.create({
        email: input.email ?? `${input.provider}:${input.providerId}@example.invalid`,
        name: input.name,
        image: input.image,
      });
      user = created.toObject();
      userId = this.normalizeDocumentId((created as any)?._id);
    }

    if (!userId) {
      userId = this.normalizeDocumentId((user as any)?._id);
    }

    if (!userId) {
      return user;
    }

    if (matchingAccounts.length === 0) {
      await this.accountModel.create({
        provider: input.provider,
        providerId: input.providerId,
        user: userId,
      });
    } else {
      await this.accountModel.updateMany(
        { provider: input.provider, providerId: input.providerId, user: { $ne: userId } },
        { $set: { user: userId } }
      );

      const canonicalAccount =
        matchingAccounts.find((account: any) => this.normalizeDocumentId(account?.user) === userId) ??
        matchingAccounts[0];

      const canonicalAccountId = this.normalizeDocumentId((canonicalAccount as any)?._id);

      const duplicateAccountIds = matchingAccounts
        .map((account: any) => this.normalizeDocumentId(account?._id))
        .filter((accountId): accountId is string => !!accountId && accountId !== canonicalAccountId);

      if (duplicateAccountIds.length > 0) {
        await this.accountModel.deleteMany({ _id: { $in: duplicateAccountIds } });
      }
    }

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

  private normalizeDocumentId(value: any): string | null {
    if (!value) {
      return null;
    }

    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'object' && typeof value.toString === 'function') {
      return value.toString();
    }

    return null;
  }
}

