import { BatchService } from './batch.service';
import { BatchStatus } from '@prisma/client';
export declare class BatchController {
    private readonly batchService;
    constructor(batchService: BatchService);
    getPublicStatus(batchNumber: string): Promise<{
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
    getApplicants(id: string): Promise<({
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
            answeredAt: Date;
            applicantId: string;
            value: import("@prisma/client/runtime/client").JsonValue;
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
    transitionStatus(id: string, status: BatchStatus): Promise<{
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
    sendInstructions(id: string, body: {
        title: string;
        content: string;
        additionalQuestionIds?: string[];
    }): Promise<{
        id: string;
        createdAt: Date;
        batchId: string;
        sentAt: Date;
        title: string;
        content: string;
        additionalQuestionIds: string[];
    }>;
    approve(id: string): Promise<{
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
}
