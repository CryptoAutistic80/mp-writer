import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiService } from './ai.service';
import { GenerateDto } from './dto/generate.dto';
import { WritingDeskIntakeDto } from './dto/writing-desk-intake.dto';
import { WritingDeskFollowUpDto } from './dto/writing-desk-follow-up.dto';
import { WritingDeskResearchDto } from './dto/writing-desk-research.dto';

@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post('generate')
  async generate(@Body() body: GenerateDto) {
    return this.ai.generate(body);
  }

  @Post('writing-desk/follow-up')
  async writingDeskFollowUp(@Req() req: any, @Body() body: WritingDeskIntakeDto) {
    const userId = req?.user?.id ?? req?.user?._id ?? null;
    return this.ai.generateWritingDeskFollowUps(userId, body);
  }

  @Post('writing-desk/follow-up/answers')
  async writingDeskFollowUpAnswers(@Body() body: WritingDeskFollowUpDto) {
    return this.ai.recordWritingDeskFollowUps(body);
  }

  @Post('writing-desk/research')
  async startWritingDeskResearch(@Req() req: any, @Body() body: WritingDeskResearchDto) {
    const userId = req?.user?.id ?? req?.user?._id ?? null;
    return this.ai.startWritingDeskResearch(userId, body);
  }

  @Get('writing-desk/research/:jobId')
  async pollWritingDeskResearch(@Req() req: any, @Param('jobId') jobId: string) {
    const userId = req?.user?.id ?? req?.user?._id ?? null;
    return this.ai.pollWritingDeskResearch(userId, jobId);
  }
}
