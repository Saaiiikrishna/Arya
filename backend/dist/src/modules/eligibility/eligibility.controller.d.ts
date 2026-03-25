import { EligibilityService } from './eligibility.service';
import { CriteriaOperator } from '@prisma/client';
export declare class EligibilityController {
    private readonly eligibilityService;
    constructor(eligibilityService: EligibilityService);
    create(body: {
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
    update(id: string, body: any): Promise<{
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
    screenBatch(batchId: string): Promise<{
        eligibleCount: number;
        ineligibleCount: number;
        total: number;
    }>;
    evaluate(applicantId: string): Promise<{
        eligible: boolean;
        results: Array<{
            criteriaId: string;
            passed: boolean;
            reason: string;
        }>;
    }>;
}
