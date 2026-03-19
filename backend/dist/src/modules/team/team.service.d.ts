import { PrismaService } from '../../prisma';
export declare class TeamService {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    formTeams(batchId: string): Promise<{
        teamsCreated: number;
        message: string;
        teams?: undefined;
    } | {
        teamsCreated: number;
        teams: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            name: string;
            batchId: string;
            memberCount: number;
            matchingCriteria: import("@prisma/client/runtime/client").JsonValue | null;
        }[];
        message?: undefined;
    }>;
    private balancedPartition;
    matchToExistingTeam(applicantId: string, batchId: string): Promise<({
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
    }) | null>;
    findByBatch(batchId: string): Promise<({
        _count: {
            members: number;
        };
        members: {
            id: string;
            email: string;
            firstName: string;
            lastName: string;
            status: import("@prisma/client").$Enums.ApplicantStatus;
            consentGiven: boolean;
        }[];
    } & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        batchId: string;
        memberCount: number;
        matchingCriteria: import("@prisma/client/runtime/client").JsonValue | null;
    })[]>;
    findOne(id: string): Promise<{
        batch: {
            batchNumber: number;
            status: import("@prisma/client").$Enums.BatchStatus;
        };
        members: ({
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
        })[];
    } & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        batchId: string;
        memberCount: number;
        matchingCriteria: import("@prisma/client/runtime/client").JsonValue | null;
    }>;
}
