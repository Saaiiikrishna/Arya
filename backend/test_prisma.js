process.env.PRISMA_DATASOURCE_URL = "postgresql://arya_user:arya_dev_password@localhost:5432/arya?schema=public";

const { PrismaClient } = require('@prisma/client');
try {
  // Try with empty options object
  const p = new PrismaClient({});
  console.log('PrismaClient created OK with {}');
  p.$connect().then(() => {
    console.log('Connected OK');
    return p.$disconnect();
  }).then(() => {
    console.log('Disconnected OK');
  }).catch(e => {
    console.error('Connection error:', e.message);
    process.exit(1);
  });
} catch(e) {
  console.error('Construction error with {}:', e.message);
}
