import { PrismaService } from '../../prisma';
import { ApplyDto, SubmitAdditionalAnswersDto } from './dto';
import { ApplicantStatus } from '@prisma/client';
export declare class ApplicantService {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    apply(dto: ApplyDto): Promise<{
        id: string;
        email: string;
        firstName: string;
        lastName: string;
        batchNumber: number;
        accessToken: string;
    }>;
    findByAccessToken(accessToken: string): Promise<{
        batch: {
            batchNumber: number;
            status: import("@prisma/client").$Enums.BatchStatus;
        } | null;
        team: {
            id: string;
            name: string;
        } | null;
        answers: ({
            question: {
                label: string;
                type: import("@prisma/client").$Enums.QuestionType;
            };
        } & {
            id: string;
            updatedAt: Date;
            phaseTag: import("@prisma/client").$Enums.PhaseTag;
            questionId: string;
            value: import("@prisma/client/runtime/client").JsonValue;
            answeredAt: Date;
            applicantId: string;
        })[];
    } & {
        id: string;
        email: string;
        firstName: string;
        lastName: string;
        updatedAt: Date;
        status: import("@prisma/client").$Enums.ApplicantStatus;
        phone: string | null;
        accessToken: string;
        batchId: string | null;
        teamId: string | null;
        consentGiven: boolean;
        consentDocUrl: string | null;
        appliedAt: Date;
        movedAt: Date | null;
        removedAt: Date | null;
    }>;
    submitAdditionalAnswers(accessToken: string, dto: SubmitAdditionalAnswersDto): Promise<{
        success: boolean;
    }>;
    giveConsent(accessToken: string, consentDocUrl?: string): Promise<{
        id: string;
        email: string;
        firstName: string;
        lastName: string;
        updatedAt: Date;
        status: import("@prisma/client").$Enums.ApplicantStatus;
        phone: string | null;
        accessToken: string;
        batchId: string | null;
        teamId: string | null;
        consentGiven: boolean;
        consentDocUrl: string | null;
        appliedAt: Date;
        movedAt: Date | null;
        removedAt: Date | null;
    }>;
    findAll(params: {
        page?: number;
        limit?: number;
        search?: string;
        status?: ApplicantStatus;
        batchId?: string;
    }): Promise<{
        data: ({
            batch: {
                batchNumber: number;
                status: import("@prisma/client").$Enums.BatchStatus;
            } | null;
            team: {
                id: string;
                name: string;
            } | null;
        } & {
            id: string;
            email: string;
            firstName: string;
            lastName: string;
            updatedAt: Date;
            status: import("@prisma/client").$Enums.ApplicantStatus;
            phone: string | null;
            accessToken: string;
            batchId: string | null;
            teamId: string | null;
            consentGiven: boolean;
            consentDocUrl: string | null;
            appliedAt: Date;
            movedAt: Date | null;
            removedAt: Date | null;
        })[];
        meta: {
            total: number;
            page: number;
            limit: number;
            totalPages: number;
        };
    }>;
    findOneAdmin(id: string): Promise<{
        batch: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            batchNumber: number;
            status: import("@prisma/client").$Enums.BatchStatus;
            capacity: number;
            currentCount: number;
            teamMinSize: number;
            teamMaxSize: number;
            teamFormationConfig: import("@prisma/client/runtime/client").JsonValue | null;
            finalizedAt: Date | null;
            productionAt: Date | null;
        } | null;
        team: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            name: string;
            batchId: string;
            memberCount: number;
            matchingCriteria: import("@prisma/client/runtime/client").JsonValue | null;
        } | null;
        answers: ({
            question: {
                id: string;
                isActive: boolean;
                createdAt: Date;
                updatedAt: Date;
                label: string;
                helpText: string | null;
                type: import("@prisma/client").$Enums.QuestionType;
                options: import("@prisma/client/runtime/client").JsonValue | null;
                sortOrder: number;
                isRequired: boolean;
                category: string | null;
                phaseTag: import("@prisma/client").$Enums.PhaseTag;
                validation: import("@prisma/client/runtime/client").JsonValue | null;
            };
        } & {
            id: string;
            updatedAt: Date;
            phaseTag: import("@prisma/client").$Enums.PhaseTag;
            questionId: string;
            value: import("@prisma/client/runtime/client").JsonValue;
            answeredAt: Date;
            applicantId: string;
        })[];
        notifications: {
            id: string;
            createdAt: Date;
            subject: string;
            body: string;
            status: import("@prisma/client").$Enums.NotificationStatus;
            type: import("@prisma/client").$Enums.NotificationType;
            applicantId: string;
            metadata: import("@prisma/client/runtime/client").JsonValue | null;
            sentAt: Date | null;
        }[];
        documents: {
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
        }[];
    } & {
        id: string;
        email: string;
        firstName: string;
        lastName: string;
        updatedAt: Date;
        status: import("@prisma/client").$Enums.ApplicantStatus;
        phone: string | null;
        accessToken: string;
        batchId: string | null;
        teamId: string | null;
        consentGiven: boolean;
        consentDocUrl: string | null;
        appliedAt: Date;
        movedAt: Date | null;
        removedAt: Date | null;
    }>;
    removeApplicant(id: string): Promise<{
        removedApplicantId: string;
        batchId: string | null;
        message: string;
    }>;
    getDashboardStats(): Promise<{
        totalApplicants: number;
        statusBreakdown: {
            pending: number;
            eligible: number;
            active: number;
            removed: number;
        };
        totalBatches: number;
        activeBatch: {
            id: string;
            batchNumber: number;
            status: import("@prisma/client").$Enums.BatchStatus;
            currentCount: number;
            capacity: number;
            teamCount: number;
        } | null;
    }>;
}
