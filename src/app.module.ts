import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiModule } from './ai/ai.service';
import { AuthModule } from './auth/auth.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ExerciseModule } from './exercise/exercise.module';
import { CronModule } from './internal/cron.module';
import { MealModule } from './meal/meal.module';
import { PrismaModule } from './prisma/prisma.service';
import { ProfileModule } from './profile/profile.module';
import { SummaryModule } from './summary/summary.module';
import { WeightModule } from './weight/weight.module';

@Controller('health')
class HealthController {
  @Get()
  health() {
    return { ok: true };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AiModule,
    AuthModule,
    ProfileModule,
    WeightModule,
    ExerciseModule,
    MealModule,
    DashboardModule,
    SummaryModule,
    CronModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
