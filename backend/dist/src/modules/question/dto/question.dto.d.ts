import { QuestionType, PhaseTag } from '@prisma/client';
export declare class CreateQuestionDto {
    label: string;
    helpText?: string;
    type: QuestionType;
    options?: any;
    sortOrder?: number;
    isRequired?: boolean;
    category?: string;
    phaseTag?: PhaseTag;
    validation?: any;
}
export declare class UpdateQuestionDto {
    label?: string;
    helpText?: string;
    type?: QuestionType;
    options?: any;
    sortOrder?: number;
    isRequired?: boolean;
    isActive?: boolean;
    category?: string;
    phaseTag?: PhaseTag;
    validation?: any;
}
export declare class ReorderQuestionsDto {
    items: Array<{
        id: string;
        sortOrder: number;
    }>;
}
