import { QuestionService } from './question.service';
import { CreateQuestionDto, UpdateQuestionDto, ReorderQuestionsDto } from './dto';
import { PhaseTag } from '@prisma/client';
export declare class QuestionController {
    private readonly questionService;
    constructor(questionService: QuestionService);
    getPublicQuestions(phase?: PhaseTag): Promise<{
        id: string;
        label: string;
        helpText: string | null;
        type: import("@prisma/client").$Enums.QuestionType;
        options: import("@prisma/client/runtime/client").JsonValue;
        isRequired: boolean;
        category: string | null;
        validation: import("@prisma/client/runtime/client").JsonValue;
    }[]>;
    create(dto: CreateQuestionDto): Promise<{
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
    }>;
    findAll(phase?: PhaseTag, activeOnly?: string): Promise<{
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
    }[]>;
    findOne(id: string): Promise<{
        eligibilityCriteria: {
            id: string;
            isActive: boolean;
            createdAt: Date;
            updatedAt: Date;
            questionId: string;
            value: import("@prisma/client/runtime/client").JsonValue;
            operator: import("@prisma/client").$Enums.CriteriaOperator;
            weight: number;
        }[];
    } & {
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
    }>;
    update(id: string, dto: UpdateQuestionDto): Promise<{
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
    }>;
    remove(id: string): Promise<{
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
    }>;
    reorder(dto: ReorderQuestionsDto): Promise<{
        success: boolean;
    }>;
}
