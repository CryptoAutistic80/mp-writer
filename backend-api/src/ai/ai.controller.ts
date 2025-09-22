import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiService } from './ai.service';
import { GenerateDto } from './dto/generate.dto';
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

  @Get('generate')
  async getActiveJob(@Req() req: any) {
    return this.ai.getActiveJob(req.user.id);
  }

  @Get('generate/:jobId')
  async getJob(@Req() req: any, @Param('jobId') jobId: string) {
    return this.ai.getJob(jobId, req.user.id);
  }
}
