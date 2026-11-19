import { Global, Injectable, Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Connects lazily on the first query. No eager $connect() at startup: on Vercel the app
 * must reach listen() quickly, and a slow or misconfigured database would block it.
 * Connection settings (TLS, timeouts) come from DATABASE_URL.
 */
@Injectable()
export class PrismaService extends PrismaClient {}

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
