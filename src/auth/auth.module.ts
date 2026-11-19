import {
  Body,
  ConflictException,
  Controller,
  Get,
  Global,
  HttpCode,
  Module,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { z } from 'zod';
import { CurrentUser, JwtAuthGuard } from '../common/auth';
import type { AuthUser } from '../common/auth';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

const registerSchema = z.object({
  name: z.string().trim().min(1, 'Nama wajib diisi').max(80),
  email: z.email('Format email tidak valid').transform((e) => e.toLowerCase()),
  password: z.string().min(8, 'Password minimal 8 karakter').max(72),
});

const loginSchema = z.object({
  email: z.email('Format email tidak valid').transform((e) => e.toLowerCase()),
  password: z.string().min(1),
});

@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  @Post('register')
  async register(@Body(new ZodPipe(registerSchema)) body: z.infer<typeof registerSchema>) {
    const exists = await this.prisma.user.findUnique({ where: { email: body.email } });
    if (exists) throw new ConflictException('Email sudah terdaftar');
    const user = await this.prisma.user.create({
      data: { name: body.name, email: body.email, passwordHash: await bcrypt.hash(body.password, 10) },
    });
    return this.session(user);
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>) {
    const user = await this.prisma.user.findUnique({ where: { email: body.email } });
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
      throw new UnauthorizedException('Email atau password salah');
    }
    return this.session(user);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: AuthUser) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId: user.id },
      select: { userId: true },
    });
    return { user, hasProfile: Boolean(profile) };
  }

  private async session(user: { id: string; email: string; name: string; timezone: string }) {
    const token = await this.jwt.signAsync({ sub: user.id });
    const profile = await this.prisma.profile.findUnique({
      where: { userId: user.id },
      select: { userId: true },
    });
    return {
      token,
      user: { id: user.id, email: user.email, name: user.name, timezone: user.timezone },
      hasProfile: Boolean(profile),
    };
  }
}

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '30d' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [JwtAuthGuard],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
