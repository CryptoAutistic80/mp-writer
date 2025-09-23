import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiService } from './ai.service';
import { GenerateDto } from './dto/generate.dto';
import { GenerateFollowupsDto } from './dto/followups.dto';
import { TransformDto } from './dto/transform.dto';
import { UserCreditsService } from '../user-credits/user-credits.service';
import { UserMpService } from '../user-mp/user-mp.service';
import { UserAddressService } from '../user-address-store/user-address.service';

@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly userCredits: UserCreditsService,
    private readonly userMp: UserMpService,
    private readonly userAddress: UserAddressService,
  ) {}

  @Post('generate')
  @HttpCode(HttpStatus.ACCEPTED)
  async generate(@Req() req: any, @Body() body: GenerateDto) {
    return this.ai.enqueueGenerate({
      userId: req.user.id,
      prompt: body.prompt,
      model: body.model,
      tone: body.tone,
      details: body.details,
      mpName: body.mpName,
      constituency: body.constituency,
      userName: body.userName || req.user.name || '',
      userAddressLine: body.userAddressLine,
    });
  }

  @Get('generate/:jobId')
  async getJob(@Req() req: any, @Param('jobId') jobId: string) {
    return this.ai.getJob(jobId, req.user.id);
  }

  @Post('followups')
  async generateFollowups(@Req() req: any, @Body() body: GenerateFollowupsDto) {
    return this.ai.generateFollowups({
      userId: req.user.id,
      issueSummary: body.issueSummary,
      contextAnswers: body.contextAnswers,
      mpName: body.mpName,
      constituency: body.constituency,
    });
  }

  @Post('transform')
  async transform(@Req() req: any, @Body() body: TransformDto) {
    return this.ai.transformLetterToJson({
      userId: req.user.id,
      letterHtml: body.letterHtml,
      mpName: body.mpName,
      constituency: body.constituency,
      senderName: body.senderName,
      senderAddressLines: body.senderAddressLines,
      tone: body.tone,
      date: body.date,
    });
  }
}
