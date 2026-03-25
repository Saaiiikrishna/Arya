import { PrismaService } from '../../prisma';
import { CriteriaOperator } from '@prisma/client';
export declare class EligibilityService {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    createCriteria(data: {
        questionId: string;
        operator: CriteriaOperator;
        value: any;
        weight?: number;
    }): Promise<{
        id: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        questionId: string;
        value: import("@prisma/client/runtime/client").JsonValue;
        operator: import("@prisma/client").$Enums.CriteriaOperator;
        weight: number;
    }>;
    findAll(): Promise<({
        question: {
            label: string;
            type: import("@prisma/client").$Enums.QuestionType;
        };
    } & {
        id: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        questionId: string;
        value: import("@prisma/client/runtime/client").JsonValue;
        operator: import("@prisma/client").$Enums.CriteriaOperator;
        weight: number;
    })[]>;
    update(id: string, data: Partial<{
        operator: CriteriaOperator;
        value: any;
        weight: number;
        isActive: boolean;
    }>): Promise<{
        id: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        questionId: string;
        value: import("@prisma/client/runtime/client").JsonValue;
        operator: import("@prisma/client").$Enums.CriteriaOperator;
        weight: number;
    }>;
    remove(id: string): Promise<{
        id: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        questionId: string;
        value: import("@prisma/client/runtime/client").JsonValue;
        operator: import("@prisma/client").$Enums.CriteriaOperator;
        weight: number;
    }>;
    evaluateApplicant(applicantId: string): Promise<{
        eligible: boolean;
        results: Array<{
            criteriaId: string;
            passed: boolean;
            reason: string;
        }>;
    }>;
    private evaluateCriterion;
    screenBatch(batchId: string): Promise<{
        eligibleCount: number;
        ineligibleCount: number;
        total: number;
    }>;
}
