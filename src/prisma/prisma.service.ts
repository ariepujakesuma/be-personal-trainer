import { Global, Injectable, Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { mariaDbAdapter } from './adapter';

/**
 * Connects lazily on the first query. No eager $connect() at startup: on Vercel the app
 * must reach listen() quickly, and a slow or misconfigured database would block it.
 */
@Injectable()
export class PrismaService extends PrismaClient {
  constructor() {
    super({ adapter: mariaDbAdapter() });
  }
}

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
