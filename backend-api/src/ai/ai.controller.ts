import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
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
  async generate(@Req() req: any, @Body() body: GenerateDto) {
    const userId = req.user.id;
    let deduction = { credits: 0 };
    let deducted = false;

    try {
      deduction = await this.userCredits.deductFromMine(userId, 1);
      deducted = true;
      const [mpDoc, addressDoc] = await Promise.all([
        this.userMp.getMine(userId).catch(() => null),
        this.userAddress.getMine(userId).catch(() => null),
      ]);

      const mpName =
        body.mpName ||
        mpDoc?.mp?.name ||
        mpDoc?.mp?.fullName ||
        mpDoc?.mp?.displayName ||
        '';
      const constituency = body.constituency || mpDoc?.constituency || '';
      const address = addressDoc?.address;
      const addressLine =
        body.userAddressLine ||
        (address
          ? [address.line1, address.line2, address.city, address.county, address.postcode]
              .map((part: string | undefined) => (part || '').trim())
              .filter((part: string) => Boolean(part))
              .join(', ')
          : '');

      const payload = await this.ai.generate({
        prompt: body.prompt,
        model: body.model,
        tone: body.tone,
        details: body.details,
        mpName,
        constituency,
        userName: body.userName || req.user.name || '',
        userAddressLine: addressLine,
      });

      return { ...payload, credits: deduction.credits };
    } catch (error: any) {
      if (deducted) {
        await this.userCredits.addToMine(userId, 1);
      }
      throw error;
    }
  }
}

