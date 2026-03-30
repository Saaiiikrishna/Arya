import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const prisma = new PrismaClient();
  const applicants = await prisma.applicant.findMany({
    include: {
      batch: true,
    }
  });
  console.log('Applicants:');
  applicants.forEach(a => {
    console.log(`ID: ${a.id}, Email: ${a.email}, Name: ${a.firstName} ${a.lastName}`);
  });
  await prisma.$disconnect();
}

main();
