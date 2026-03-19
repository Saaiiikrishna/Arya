"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const bullmq_1 = require("@nestjs/bullmq");
const prisma_1 = require("./prisma");
const auth_1 = require("./modules/auth");
const question_1 = require("./modules/question");
const applicant_1 = require("./modules/applicant");
const batch_1 = require("./modules/batch");
const team_1 = require("./modules/team");
const email_1 = require("./modules/email");
const document_1 = require("./modules/document");
const eligibility_1 = require("./modules/eligibility");
const jobs_1 = require("./modules/jobs");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({ isGlobal: true }),
            bullmq_1.BullModule.forRootAsync({
                imports: [config_1.ConfigModule],
                useFactory: (configService) => ({
                    connection: {
                        host: configService.get('REDIS_HOST', 'localhost'),
                        port: configService.get('REDIS_PORT', 6379),
                    },
                }),
                inject: [config_1.ConfigService],
            }),
            prisma_1.PrismaModule,
            auth_1.AuthModule,
            question_1.QuestionModule,
            applicant_1.ApplicantModule,
            batch_1.BatchModule,
            team_1.TeamModule,
            email_1.EmailModule,
            document_1.DocumentModule,
            eligibility_1.EligibilityModule,
            jobs_1.JobsModule,
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map