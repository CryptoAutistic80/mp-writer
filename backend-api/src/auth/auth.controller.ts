import { Controller, Get, Query, Req, Res, UseGuards, Param } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  // Initiates Google OAuth (redirect flow)
  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleAuth() {
    return;
  }

  // Google OAuth callback
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(
    @Req() req: any,
    @Res() res: Response,
    @Query('returnTo') returnTo?: string,
  ) {
    // req.user is set by GoogleStrategy.validate
    const user = req.user;
    // Use Mongo _id when present
    const rawId = (user as any)?._id ?? (user as any)?.id;
    const id = typeof rawId === 'string' ? rawId : rawId?.toString?.();
    const token = await this.auth.signJwt({ id, email: user.email });

    // Issue HttpOnly session cookie
    const appOrigin = this.config.get<string>('APP_ORIGIN', 'http://localhost:3000');
    const isSecure = appOrigin.startsWith('https://');
    const threeHoursMs = 3 * 60 * 60 * 1000;
    res.cookie('mpw_session', token.access_token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      maxAge: threeHoursMs,
      path: '/',
    });

    // Best-practice: redirect back to app — default to dashboard
    let target = appOrigin.replace(/\/$/, '') + '/dashboard';
    // Defensive: only allow relative paths for returnTo
    if (returnTo && returnTo.startsWith('/')) {
      target = appOrigin.replace(/\/$/, '') + returnTo;
    }
    return res.redirect(target);
  }

  // Return current user
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: any) {
    return req.user;
  }

  // Proxy Google profile images to avoid CORS issues
  @Get('avatar/:userId')
  @UseGuards(JwtAuthGuard)
  async getAvatar(@Req() req: any, @Res() res: Response, @Param('userId') userId: string) {
    // Only allow users to access their own avatar
    if (req.user.id !== userId) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const user = await this.auth.getUserById(userId);
    if (!user || !user.image) {
      return res.status(404).json({ message: 'Avatar not found' });
    }

    try {
      // Fetch the image from Google
      const response = await fetch(user.image);
      if (!response.ok) {
        return res.status(404).json({ message: 'Avatar not found' });
      }

      const imageBuffer = await response.arrayBuffer();
      const contentType = response.headers.get('content-type') || 'image/jpeg';

      res.set({
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
      });
      
      return res.send(Buffer.from(imageBuffer));
    } catch {
      return res.status(500).json({ message: 'Failed to fetch avatar' });
    }
  }

  // Logout clears cookie and redirects to app
  @Get('logout')
  async logout(@Res() res: Response) {
    const appOrigin = this.config.get<string>('APP_ORIGIN', 'http://localhost:3000');
    const isSecure = appOrigin.startsWith('https://');
    res.clearCookie('mpw_session', { httpOnly: true, secure: isSecure, sameSite: 'lax', path: '/' });
    return res.redirect(appOrigin);
  }
}
