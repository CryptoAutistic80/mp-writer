import { Body, Controller, Post, Query, Req, Sse, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiService } from './ai.service';
import { GenerateDto } from './dto/generate.dto';
import { WritingDeskIntakeDto } from './dto/writing-desk-intake.dto';
import { WritingDeskFollowUpDto } from './dto/writing-desk-follow-up.dto';

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

  @Sse('writing-desk/deep-research')
  writingDeskDeepResearch(@Req() req: any, @Query('jobId') jobId?: string) {
    const userId = req?.user?.id ?? req?.user?._id ?? null;
    return this.ai.streamWritingDeskDeepResearch(userId, { jobId: jobId ?? null });
  }

  @Sse('writing-desk/letter')
  writingDeskLetter(@Req() req: any, @Query('jobId') jobId?: string) {
    const userId = req?.user?.id ?? req?.user?._id ?? null;
    return this.ai.streamWritingDeskLetter(userId, { jobId: jobId ?? null });
  }
}
