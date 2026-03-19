"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var DocumentService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const prisma_1 = require("../../prisma");
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const uuid_1 = require("uuid");
let DocumentService = DocumentService_1 = class DocumentService {
    prisma;
    configService;
    s3;
    bucket;
    logger = new common_1.Logger(DocumentService_1.name);
    constructor(prisma, configService) {
        this.prisma = prisma;
        this.configService = configService;
        this.s3 = new client_s3_1.S3Client({
            region: this.configService.get('AWS_REGION', 'ap-south-1'),
            credentials: {
                accessKeyId: this.configService.get('AWS_ACCESS_KEY_ID', ''),
                secretAccessKey: this.configService.get('AWS_SECRET_ACCESS_KEY', ''),
            },
        });
        this.bucket = this.configService.get('AWS_S3_BUCKET', 'arya-documents');
    }
    async getUploadUrl(applicantId, fileName, mimeType) {
        const key = `documents/${applicantId}/${(0, uuid_1.v4)()}-${fileName}`;
        const command = new client_s3_1.PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            ContentType: mimeType,
        });
        const uploadUrl = await (0, s3_request_presigner_1.getSignedUrl)(this.s3, command, { expiresIn: 3600 });
        const document = await this.prisma.document.create({
            data: {
                applicantId,
                fileName,
                fileUrl: key,
                mimeType,
                status: 'PENDING',
            },
        });
        return { uploadUrl, documentId: document.id, key };
    }
    async confirmUpload(documentId, fileSize) {
        return this.prisma.document.update({
            where: { id: documentId },
            data: { status: 'UPLOADED', fileSize },
        });
    }
    async getDownloadUrl(documentId) {
        const document = await this.prisma.document.findUnique({
            where: { id: documentId },
        });
        if (!document)
            throw new common_1.NotFoundException('Document not found');
        const command = new client_s3_1.GetObjectCommand({
            Bucket: this.bucket,
            Key: document.fileUrl,
        });
        const downloadUrl = await (0, s3_request_presigner_1.getSignedUrl)(this.s3, command, { expiresIn: 3600 });
        return { downloadUrl, document };
    }
    async getByApplicant(applicantId) {
        return this.prisma.document.findMany({
            where: { applicantId },
            orderBy: { uploadedAt: 'desc' },
        });
    }
    async verify(documentId) {
        return this.prisma.document.update({
            where: { id: documentId },
            data: { status: 'VERIFIED', verifiedAt: new Date() },
        });
    }
};
exports.DocumentService = DocumentService;
exports.DocumentService = DocumentService = DocumentService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_1.PrismaService,
        config_1.ConfigService])
], DocumentService);
//# sourceMappingURL=document.service.js.map