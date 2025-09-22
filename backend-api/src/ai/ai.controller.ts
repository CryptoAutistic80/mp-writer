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
import { GenerateDto } from './dto/generate.dto';

@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

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

  @Get('jobs/active')
  async getActiveJob(@Req() req: any) {
    return this.ai.getActiveJob(req.user.id);
  }

  @Get('letters')
  async listLetters(@Req() req: any) {
    return this.ai.listLetters(req.user.id);
  }

  @Get('letters/:jobId')
  async getLetter(@Req() req: any, @Param('jobId') jobId: string) {
    return this.ai.getLetter(jobId, req.user.id);
  }
}
