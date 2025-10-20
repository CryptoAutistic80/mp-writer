import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  async validateOrCreateGoogleUser(profile: {
    id: string;
    emails?: Array<{ value: string }>;
    displayName?: string;
    photos?: Array<{ value: string }>;
  }) {
    const email = profile.emails?.[0]?.value;
    const name = profile.displayName ?? email ?? 'Unknown';
    const image = profile.photos?.[0]?.value;
    
    return this.users.findOrCreateFromOAuth({
      provider: 'google',
      providerId: profile.id,
      email,
      name,
      image,
    });
  }

  async getUserById(id: string) {
    return this.users.findById(id);
  }

  async signJwt(user: { id: string; email?: string | null }) {
    const payload = { sub: user.id, email: user.email ?? undefined };
    const token = await this.jwt.signAsync(payload);
    return { access_token: token };
  }
}

