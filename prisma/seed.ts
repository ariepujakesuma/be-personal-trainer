import { PrismaClient } from '@prisma/client';
import { EXERCISE_TYPES } from '../src/exercise/met';

const prisma = new PrismaClient();

async function main() {
  for (const t of EXERCISE_TYPES) {
    await prisma.exerciseType.upsert({ where: { name: t.name }, create: t, update: t });
  }
  console.log(`Seeded ${EXERCISE_TYPES.length} exercise types`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
