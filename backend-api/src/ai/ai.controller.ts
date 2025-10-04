import { Body, Controller, Post, Query, Req, Res, Sse, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiService } from './ai.service';
import { GenerateDto } from './dto/generate.dto';
import { WritingDeskIntakeDto } from './dto/writing-desk-intake.dto';
import { WritingDeskFollowUpDto } from './dto/writing-desk-follow-up.dto';
import type { Response } from 'express';
import type { UploadedAudioFile } from './types/uploaded-audio-file';

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

  @Post('transcriptions/stream')
  @UseInterceptors(FileInterceptor('audio'))
  async streamTranscription(@UploadedFile() file: UploadedAudioFile | undefined, @Res() res: Response) {
    await this.ai.streamTranscription(file, res);
  }

  @Sse('writing-desk/deep-research')
  writingDeskDeepResearch(@Req() req: any, @Query('jobId') jobId?: string) {
    const userId = req?.user?.id ?? req?.user?._id ?? null;
    return this.ai.streamWritingDeskDeepResearch(userId, { jobId: jobId ?? null });
  }

  @Sse('writing-desk/letter')
  writingDeskLetter(
    @Req() req: any,
    @Query('jobId') jobId?: string,
    @Query('tone') tone?: string,
    @Query('resume') resume?: string,
  ) {
    const userId = req?.user?.id ?? req?.user?._id ?? null;
    return this.ai.streamWritingDeskLetter(userId, {
      jobId: jobId ?? null,
      tone: tone ?? null,
      resume: resume === '1' || resume === 'true',
    });
  }
}
