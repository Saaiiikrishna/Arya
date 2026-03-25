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
const client_ses_1 = require("@aws-sdk/client-ses");
const dotenv = __importStar(require("dotenv"));
const path = __importStar(require("path"));
dotenv.config({ path: path.resolve(__dirname, '.env') });
const ses = new client_ses_1.SESClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    },
});
async function testEmail() {
    console.log('Testing sending email to saaiiikrishna@gmail.com...');
    const fromName = process.env.AWS_SES_FROM_NAME || 'Aryavartham Support';
    const fromAddress = process.env.AWS_SES_FROM_EMAIL;
    const command = new client_ses_1.SendEmailCommand({
        Source: `${fromName} <${fromAddress}>`,
        Destination: { ToAddresses: ['saaiiikrishna@gmail.com'] },
        Message: {
            Subject: { Data: 'Arya Test Email from SES', Charset: 'UTF-8' },
            Body: {
                Html: { Data: '<h1>Success!</h1><p>The AWS SES integration is configured correctly.</p>', Charset: 'UTF-8' },
                Text: { Data: 'Success! The AWS SES integration is configured correctly.', Charset: 'UTF-8' },
            },
        },
    });
    try {
        const result = await ses.send(command);
        console.log('Email sent successfully!', result.MessageId);
    }
    catch (error) {
        console.error('Failed to send email:', error);
    }
}
testEmail();
//# sourceMappingURL=test-email.js.map