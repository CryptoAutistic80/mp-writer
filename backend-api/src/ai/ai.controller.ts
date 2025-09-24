import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiService } from './ai.service';
import {
  ComposeLetterDto,
  DeepResearchDto,
  GenerateFollowupsDto,
  ResearchPromptDto,
} from './dto/generate.dto';

@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post('followups')
  async generateFollowups(@Req() req: any, @Body() body: GenerateFollowupsDto) {
    return this.ai.generateFollowupQuestions(req.user.id, body);
  }

  @Post('research-prompt')
  async createResearchPrompt(@Req() req: any, @Body() body: ResearchPromptDto) {
    return this.ai.generateResearchPrompt(req.user.id, body);
  }

  @Post('generate')
  @HttpCode(HttpStatus.ACCEPTED)
  async generateResearch(@Req() req: any, @Body() body: DeepResearchDto) {
    return this.ai.enqueueDeepResearch(req.user.id, body);
  }

  @Get('generate/:jobId')
  async getJob(@Req() req: any, @Param('jobId') jobId: string) {
    return this.ai.getJob(jobId, req.user.id);
  }

  @Post('compose')
  async composeLetter(@Req() req: any, @Body() body: ComposeLetterDto) {
    return this.ai.composeLetter(req.user.id, body);
  }
}
