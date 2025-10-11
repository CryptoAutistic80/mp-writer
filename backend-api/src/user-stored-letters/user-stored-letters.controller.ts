import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserStoredLettersService } from './user-stored-letters.service';
import { CreateUserStoredLetterDto } from './dto/create-user-stored-letter.dto';

@UseGuards(JwtAuthGuard)
@Controller('writing-desk/letters')
export class UserStoredLettersController {
  constructor(private readonly service: UserStoredLettersService) {}

  @Post()
  async createLetter(@Req() req: any, @Body() body: CreateUserStoredLetterDto) {
    return this.service.createLetter(req.user.id, body);
  }
}
