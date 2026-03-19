export declare class AnswerItemDto {
    questionId: string;
    value: any;
}
export declare class ApplyDto {
    email: string;
    firstName: string;
    lastName: string;
    phone?: string;
    answers: AnswerItemDto[];
}
export declare class SubmitAdditionalAnswersDto {
    answers: AnswerItemDto[];
}
