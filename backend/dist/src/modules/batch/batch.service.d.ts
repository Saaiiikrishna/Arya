import { PrismaService } from '../../prisma';
import { BatchStatus } from '@prisma/client';
export declare class BatchService {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    findAll(): Promise<({
        _count: {
            applicants: number;
            teams: number;
        };
    } & {
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
    })[]>;
    findOne(id: string): Promise<{
        teams: ({
            _count: {
                members: number;
            };
        } & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            name: string;
            batchId: string;
            memberCount: number;
            matchingCriteria: import("@prisma/client/runtime/client").JsonValue | null;
        })[];
        instructions: {
            id: string;
            createdAt: Date;
            batchId: string;
            sentAt: Date;
            title: string;
            content: string;
            additionalQuestionIds: string[];
        }[];
        _count: {
            applicants: number;
            teams: number;
        };
    } & {
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
    }>;
    findByNumber(batchNumber: number): Promise<{
        teams: ({
            members: {
                id: string;
                email: string;
                firstName: string;
                lastName: string;
                status: import("@prisma/client").$Enums.ApplicantStatus;
            }[];
        } & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            name: string;
            batchId: string;
            memberCount: number;
            matchingCriteria: import("@prisma/client/runtime/client").JsonValue | null;
        })[];
        _count: {
            applicants: number;
            teams: number;
        };
    } & {
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
    }>;
    checkAndCreateBatch(): Promise<{
        triggered: boolean;
        batchId?: string;
    }>;
    transitionStatus(id: string, newStatus: BatchStatus): Promise<{
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
    }>;
    sendInstructions(batchId: string, title: string, content: string, additionalQuestionIds?: string[]): Promise<{
        id: string;
        createdAt: Date;
        batchId: string;
        sentAt: Date;
        title: string;
        content: string;
        additionalQuestionIds: string[];
    }>;
    getApplicantsForBatch(batchId: string): Promise<({
        team: {
            id: string;
            name: string;
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
    })[]>;
    approveBatch(id: string): Promise<{
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
    }>;
    getPublicBatchStatus(batchNumber: number): Promise<{
        createdAt: Date;
        batchNumber: number;
        status: import("@prisma/client").$Enums.BatchStatus;
        capacity: number;
        currentCount: number;
        finalizedAt: Date | null;
        _count: {
            teams: number;
        };
    }>;
}
