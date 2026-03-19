import { DocumentService } from './document.service';
export declare class DocumentController {
    private readonly documentService;
    constructor(documentService: DocumentService);
    getUploadUrl(body: {
        applicantId: string;
        fileName: string;
        mimeType: string;
    }): Promise<{
        uploadUrl: string;
        documentId: string;
        key: string;
    }>;
    confirmUpload(id: string, fileSize?: number): Promise<{
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
    getDownloadUrl(id: string): Promise<{
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
    verify(id: string): Promise<{
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
