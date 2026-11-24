import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  timezone: string;
}

type AuthedRequest = Request & { user?: AuthUser };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('Silakan login dulu');

    let sub: string;
    try {
      ({ sub } = await this.jwt.verifyAsync<{ sub: string }>(token));
    } catch {
      throw new UnauthorizedException('Sesi habis, silakan login ulang');
    }

    const cached = userCache.get(sub);
    let user = cached && cached.until > Date.now() ? cached.user : null;
    if (!user) {
      user = await this.prisma.user.findUnique({
        where: { id: sub },
        select: { id: true, email: true, name: true, timezone: true },
      });
      if (!user) throw new UnauthorizedException('Akun tidak ditemukan');
      userCache.set(sub, { user, until: Date.now() + USER_TTL_MS });
    }
    req.user = user;
    return true;
  }
}

/**
 * Signed-in users per warm instance, so every request does not pay a database round trip
 * just to learn the user's name and timezone. Short-lived; dropped when the profile changes.
 */
const USER_TTL_MS = 5 * 60 * 1000;
const userCache = new Map<string, { user: AuthUser; until: number }>();
export const forgetUser = (id: string) => userCache.delete(id);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.user) throw new UnauthorizedException();
  return req.user;
});
