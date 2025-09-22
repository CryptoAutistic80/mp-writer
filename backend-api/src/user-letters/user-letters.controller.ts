import { Controller, Get, NotFoundException, Param, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserLettersService } from './user-letters.service';

@UseGuards(JwtAuthGuard)
@Controller('user/letters')
export class UserLettersController {
  constructor(private readonly letters: UserLettersService) {}

  @Get()
  async listMine(@Req() req: any) {
    const letters = await this.letters.listMine(req.user.id);
    return { letters };
  }

  @Get(':id')
  async getMine(@Req() req: any, @Param('id') id: string) {
    const letter = await this.letters.getMineById(req.user.id, id);
    if (!letter) {
      throw new NotFoundException('Letter not found');
    }
    return letter;
  }
}
