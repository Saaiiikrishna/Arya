import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as path from 'path';
import { config } from 'dotenv';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { v4 as uuidv4 } from 'uuid';

config({ path: path.resolve(__dirname, '..', '.env') });
const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool as any);

const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Seeding database...');

  // Create default admin
  const adminPassword = await bcrypt.hash('admin123456', 12);
  const admin = await prisma.admin.upsert({
    where: { email: 'admin@arya.com' },
    update: {},
    create: {
      email: 'admin@arya.com',
      passwordHash: adminPassword,
      firstName: 'Super',
      lastName: 'Admin',
      role: 'SUPER_ADMIN',
    },
  });
  console.log(`✅ Admin created: ${admin.email}`);

  // Create email templates
  const templates = [
    {
      slug: 'application-received',
      subject: 'Application Received - {{firstName}}',
      body: `
        <h2>Hi {{firstName}},</h2>
        <p>Thank you for your application! We have successfully received your information.</p>
        <p>You have been placed in <strong>Batch {{batchNumber}}</strong>.</p>
        <p>We will review your application and contact you soon.</p>
        <p>You can check your application status anytime: <a href="{{statusUrl}}">View Status</a></p>
        <br/>
        <p>Best regards,<br/>The Arya Team</p>
      `,
    },
    {
      slug: 'batch-filled',
      subject: 'Batch {{batchNumber}} Update',
      body: `
        <h2>Hi {{firstName}},</h2>
        <p>We wanted to let you know that <strong>Batch {{filledBatchNumber}}</strong> is now filled.</p>
        <p>You are currently in <strong>Batch {{batchNumber}}</strong>.</p>
        <p>You can view Batch {{filledBatchNumber}} details here: <a href="{{batchUrl}}">View Batch Details</a></p>
        <p>We will notify you once your batch starts processing.</p>
        <br/>
        <p>Best regards,<br/>The Arya Team</p>
      `,
    },
    {
      slug: 'user-moved-to-batch',
      subject: 'You Have Been Moved to Batch {{newBatchNumber}}!',
      body: `
        <h2>Hi {{firstName}},</h2>
        <p>Great news! You have been moved from Batch {{oldBatchNumber}} to <strong>Batch {{newBatchNumber}}</strong>.</p>
        <p>You will be freshly matched into a team. We will keep you updated on the progress.</p>
        <p>Check your updated status: <a href="{{statusUrl}}">View Status</a></p>
        <br/>
        <p>Best regards,<br/>The Arya Team</p>
      `,
    },
    {
      slug: 'additional-instructions',
      subject: '{{title}} - Action Required',
      body: `
        <h2>Hi {{firstName}},</h2>
        <p>We have some additional information and questions for you:</p>
        <div>{{content}}</div>
        <p>Please answer the additional questions here: <a href="{{statusUrl}}">Complete Questions</a></p>
        <br/>
        <p>Best regards,<br/>The Arya Team</p>
      `,
    },
    {
      slug: 'consent-request',
      subject: 'Final Consent Required - Batch {{batchNumber}}',
      body: `
        <h2>Hi {{firstName}},</h2>
        <p>Your batch is almost finalized! Please complete the following steps:</p>
        <ol>
          <li>Watch the introductory video</li>
          <li>Review and sign the agreement document</li>
          <li>Upload the signed document</li>
        </ol>
        <p>Complete your consent: <a href="{{statusUrl}}">Give Consent</a></p>
        <br/>
        <p>Best regards,<br/>The Arya Team</p>
      `,
    },
  ];

  for (const template of templates) {
    await prisma.emailTemplate.upsert({
      where: { slug: template.slug },
      update: { subject: template.subject, body: template.body },
      create: template,
    });
  }
  console.log(`✅ ${templates.length} email templates created`);

  // Create first batch
  const batch = await prisma.batch.upsert({
    where: { batchNumber: 1 },
    update: {},
    create: { batchNumber: 1 },
  });
  console.log('✅ Batch 1 created');

  // ─── Test Applicant Account ────────────────────────────
  // This account can be used for testing OTP auth and Razorpay payment flows
  const testAccessToken = '00000000-0000-4000-a000-000000000001';
  const testApplicant = await prisma.applicant.upsert({
    where: { email: 'test@arya.com' },
    update: {},
    create: {
      email: 'test@arya.com',
      firstName: 'Test',
      lastName: 'Founder',
      phone: '+919999999999',
      accessToken: testAccessToken,
      batchId: batch.id,
      status: 'PENDING',
      city: 'Hyderabad',
      age: 28,
      vocation: 'Full-Stack Engineer & Product Builder',
      obsession: 'Democratizing access to startup infrastructure for first-generation founders in India.',
      heresy: 'Most accelerators optimize for investor returns, not founder success. The model is broken.',
      scarTissue: 'Built a SaaS product that reached 500 users but failed to monetize. Shut down after 14 months.',
    } as any,
  });
  console.log(`✅ Test applicant created: ${testApplicant.email} (OTP login: request OTP for test@arya.com)`);

  console.log('🌱 Seeding complete!');
}

main()
  .catch((e) => {
    console.error('Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
