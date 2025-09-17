import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AiService, IssueRefinement } from '../ai/ai.service';
import { UserMpService } from '../user-mp/user-mp.service';
import { UserAddressService } from '../user-address-store/user-address.service';
import { UserCreditsService } from '../user-credits/user-credits.service';
import { CreateWritingSessionDto } from './dto/create-writing-session.dto';
import { RunResearchDto } from './dto/run-research.dto';
import { WritingSession, WritingSessionDocument } from './schemas/writing-session.schema';
import { DeepResearchResult, DeepResearchService } from './deep-research.service';

@Injectable()
export class WritingSessionsService {
  constructor(
    @InjectModel(WritingSession.name)
    private readonly writingSessions: Model<WritingSession>,
    private readonly ai: AiService,
    private readonly userMp: UserMpService,
    private readonly userAddress: UserAddressService,
    private readonly credits: UserCreditsService,
    private readonly deepResearch: DeepResearchService,
  ) {}

  async create(userId: string, dto: CreateWritingSessionDto) {
    const brief = dto.brief.trim();
    if (brief.length < 20) {
      throw new BadRequestException('Please provide more detail about your issue.');
    }

    const mpDoc = await this.userMp.getMine(userId);
    if (!mpDoc || (!mpDoc.constituency && !mpDoc.mp)) {
      throw new BadRequestException('Please save your MP before drafting a letter.');
    }

    const addressDoc = await this.userAddress.getMine(userId);
    if (!addressDoc?.address) {
      throw new BadRequestException('Please save your mailing address before drafting a letter.');
    }

    const refinement = await this.ai.refineIssue({ brief });

    const session = await this.writingSessions.create({
      user: userId,
      status: 'refined',
      issueBrief: brief,
      refinement,
      mpSnapshot: this.mapMpSnapshot(mpDoc),
      addressSnapshot: addressDoc.address,
      refinementModel: refinement.model,
      refinementCompletedAt: new Date(),
      creditsSpent: 0,
    });

    return this.present(session);
  }

  async listMine(userId: string, limit = 10) {
    const safeLimit = Math.max(1, Math.min(50, limit));
    const sessions = await this.writingSessions
      .find({ user: userId })
      .sort({ updatedAt: -1 })
      .limit(safeLimit)
      .lean();
    return sessions.map((session) => this.present(session));
  }

  async getMine(userId: string, id: string) {
    const session = await this.writingSessions.findOne({ _id: id, user: userId }).lean();
    if (!session) throw new NotFoundException('Writing session not found');
    return this.present(session);
  }

  async runResearch(userId: string, id: string, dto: RunResearchDto) {
    const session = await this.writingSessions.findOne({ _id: id, user: userId });
    if (!session) throw new NotFoundException('Writing session not found');

    if (!session.refinement) {
      throw new BadRequestException('The writing session is missing refinement details.');
    }

    if (!session.mpSnapshot || !session.addressSnapshot) {
      throw new BadRequestException('Missing MP or address details for this session.');
    }

    if (session.status === 'researching') {
      return this.present(session);
    }

    const alreadyComplete = session.status === 'completed' && session.research?.letterBody;
    if (alreadyComplete && !dto.force) {
      return this.present(session);
    }

    await this.credits.deductFromMine(userId, 1);

    session.status = 'researching';
    session.errorMessage = null;
    session.researchStartedAt = new Date();
    session.researchCompletedAt = null;
    if (dto.force) {
      session.research = null;
    }
    session.creditsSpent = (session.creditsSpent ?? 0) + 1;
    await session.save();

    try {
      const result = await this.deepResearch.run({
        brief: session.issueBrief,
        refinement: session.refinement as IssueRefinement,
        mpSnapshot: session.mpSnapshot,
        addressSnapshot: session.addressSnapshot,
      });
      this.applyResearchResult(session, result);
      await session.save();
      return this.present(session);
    } catch (error: any) {
      session.status = 'failed';
      session.errorMessage = error?.message ?? 'Deep research failed';
      await session.save();
      throw new InternalServerErrorException(session.errorMessage);
    }
  }

  private applyResearchResult(session: WritingSessionDocument, result: DeepResearchResult) {
    session.research = {
      letterBody: result.letterBody,
      citations: result.citations ?? [],
      rawOutput: result.rawOutput,
    };
    session.researchModel = result.model;
    session.status = 'completed';
    session.researchCompletedAt = new Date();
  }

  private mapMpSnapshot(mpDoc: any) {
    if (!mpDoc) return null;
    const { constituency, mp } = mpDoc;
    return {
      constituency: constituency ?? '',
      mp: mp ?? null,
    };
  }

  private present(input: WritingSessionDocument | (WritingSession & { _id: any }) | any) {
    if (!input) return null;
    const data = typeof input.toObject === 'function' ? input.toObject() : input;
    return {
      id: data._id?.toString?.() ?? `${data._id}`,
      status: data.status,
      issueBrief: data.issueBrief,
      refinement: data.refinement ?? null,
      research: data.research ?? null,
      mpSnapshot: data.mpSnapshot ?? null,
      addressSnapshot: data.addressSnapshot ?? null,
      refinementModel: data.refinementModel ?? null,
      researchModel: data.researchModel ?? null,
      refinementCompletedAt: data.refinementCompletedAt ?? null,
      researchStartedAt: data.researchStartedAt ?? null,
      researchCompletedAt: data.researchCompletedAt ?? null,
      errorMessage: data.errorMessage ?? null,
      creditsSpent: data.creditsSpent ?? 0,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  }
}
