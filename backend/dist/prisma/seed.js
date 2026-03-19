"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcrypt = __importStar(require("bcrypt"));
const prisma = new client_1.PrismaClient();
async function main() {
    console.log('🌱 Seeding database...');
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
    await prisma.batch.upsert({
        where: { batchNumber: 1 },
        update: {},
        create: { batchNumber: 1 },
    });
    console.log('✅ Batch 1 created');
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
//# sourceMappingURL=seed.js.map