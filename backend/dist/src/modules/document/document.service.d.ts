import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma';
export declare class DocumentService {
    private readonly prisma;
    private readonly configService;
    private readonly s3;
    private readonly bucket;
    private readonly logger;
    constructor(prisma: PrismaService, configService: ConfigService);
    getUploadUrl(applicantId: string, fileName: string, mimeType: string): Promise<{
        uploadUrl: string;
        documentId: string;
        key: string;
    }>;
    confirmUpload(documentId: string, fileSize?: number): Promise<{
        id: string;
        status: import("@prisma/client").$Enums.DocumentStatus;
        type: import("@prisma/client").$Enums.DocumentType;
        applicantId: string;
        fileName: string;
        fileUrl: string;
        fileSize: number | null;
        mimeType: string | null;
        uploadedAt: Date;
        verifiedAt: Date | null;
    }>;
    getDownloadUrl(documentId: string): Promise<{
        downloadUrl: string;
        document: {
            id: string;
            status: import("@prisma/client").$Enums.DocumentStatus;
            type: import("@prisma/client").$Enums.DocumentType;
            applicantId: string;
            fileName: string;
            fileUrl: string;
            fileSize: number | null;
            mimeType: string | null;
            uploadedAt: Date;
            verifiedAt: Date | null;
        };
    }>;
    getByApplicant(applicantId: string): Promise<{
        id: string;
        status: import("@prisma/client").$Enums.DocumentStatus;
        type: import("@prisma/client").$Enums.DocumentType;
        applicantId: string;
        fileName: string;
        fileUrl: string;
        fileSize: number | null;
        mimeType: string | null;
        uploadedAt: Date;
        verifiedAt: Date | null;
    }[]>;
    verify(documentId: string): Promise<{
        id: string;
        status: import("@prisma/client").$Enums.DocumentStatus;
        type: import("@prisma/client").$Enums.DocumentType;
        applicantId: string;
        fileName: string;
        fileUrl: string;
        fileSize: number | null;
        mimeType: string | null;
        uploadedAt: Date;
        verifiedAt: Date | null;
    }>;
}
