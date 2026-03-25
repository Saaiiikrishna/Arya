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
const core_1 = require("@nestjs/core");
const app_module_1 = require("./src/app.module");
const email_service_1 = require("./src/modules/email/email.service");
const prisma_1 = require("./src/prisma");
const crypto = __importStar(require("crypto"));
async function bootstrap() {
    console.log('Initializing NestJS Context to test DB logging...');
    const app = await core_1.NestFactory.createApplicationContext(app_module_1.AppModule);
    const emailService = app.get(email_service_1.EmailService);
    const prismaService = app.get(prisma_1.PrismaService);
    try {
        const existing = await prismaService.applicant.findUnique({ where: { email: 'saaiiikrishna@gmail.com' } });
        let applicantId = existing?.id;
        if (!existing) {
            console.log('Creating dummy applicant to attach the notification log to...');
            const applicant = await prismaService.applicant.create({
                data: {
                    email: 'saaiiikrishna@gmail.com',
                    firstName: 'Db Logging',
                    lastName: 'Test',
                    accessToken: crypto.randomUUID(),
                }
            });
            applicantId = applicant.id;
        }
        else {
            console.log('Using existing applicant...');
        }
        console.log('Sending real templated email ("application-received") via backend service...');
        const result = await emailService.sendTemplatedEmail('saaiiikrishna@gmail.com', 'application-received', {
            firstName: 'Db Logging',
            batchNumber: 'Test Batch',
            statusUrl: 'http://localhost:3000/status'
        }, applicantId);
        console.log('Did Email send successfully via AWS?', result);
        console.log('Checking database for the injected log...');
        const logs = await prismaService.notification.findMany({
            where: { applicantId }
        });
        console.log('Found logs in database:', logs.length);
        console.log('If you check Prisma Studio (Notification table) now, you will see it!');
    }
    catch (error) {
        console.error('Test failed:', error);
    }
    finally {
        await app.close();
    }
}
bootstrap();
//# sourceMappingURL=test-db-email.js.map