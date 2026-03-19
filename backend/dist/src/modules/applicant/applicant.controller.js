"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApplicantController = void 0;
const common_1 = require("@nestjs/common");
const applicant_service_1 = require("./applicant.service");
const dto_1 = require("./dto");
const guards_1 = require("../auth/guards");
const client_1 = require("@prisma/client");
let ApplicantController = class ApplicantController {
    applicantService;
    constructor(applicantService) {
        this.applicantService = applicantService;
    }
    async apply(dto) {
        return this.applicantService.apply(dto);
    }
    async getStatus(accessToken) {
        return this.applicantService.findByAccessToken(accessToken);
    }
    async submitAdditionalAnswers(accessToken, dto) {
        return this.applicantService.submitAdditionalAnswers(accessToken, dto);
    }
    async giveConsent(accessToken, consentDocUrl) {
        return this.applicantService.giveConsent(accessToken, consentDocUrl);
    }
    async findAll(page, limit, search, status, batchId) {
        return this.applicantService.findAll({
            page: page ? parseInt(page) : undefined,
            limit: limit ? parseInt(limit) : undefined,
            search,
            status,
            batchId,
        });
    }
    async findOne(id) {
        return this.applicantService.findOneAdmin(id);
    }
    async remove(id) {
        return this.applicantService.removeApplicant(id);
    }
    async getDashboardStats() {
        return this.applicantService.getDashboardStats();
    }
};
exports.ApplicantController = ApplicantController;
__decorate([
    (0, common_1.Post)('applicants/apply'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ApplyDto]),
    __metadata("design:returntype", Promise)
], ApplicantController.prototype, "apply", null);
__decorate([
    (0, common_1.Get)('applicants/status/:accessToken'),
    __param(0, (0, common_1.Param)('accessToken')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ApplicantController.prototype, "getStatus", null);
__decorate([
    (0, common_1.Post)('applicants/answers/:accessToken'),
    __param(0, (0, common_1.Param)('accessToken')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, dto_1.SubmitAdditionalAnswersDto]),
    __metadata("design:returntype", Promise)
], ApplicantController.prototype, "submitAdditionalAnswers", null);
__decorate([
    (0, common_1.Post)('applicants/consent/:accessToken'),
    __param(0, (0, common_1.Param)('accessToken')),
    __param(1, (0, common_1.Body)('consentDocUrl')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], ApplicantController.prototype, "giveConsent", null);
__decorate([
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    (0, common_1.Get)('admin/applicants'),
    __param(0, (0, common_1.Query)('page')),
    __param(1, (0, common_1.Query)('limit')),
    __param(2, (0, common_1.Query)('search')),
    __param(3, (0, common_1.Query)('status')),
    __param(4, (0, common_1.Query)('batchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String]),
    __metadata("design:returntype", Promise)
], ApplicantController.prototype, "findAll", null);
__decorate([
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    (0, common_1.Get)('admin/applicants/:id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ApplicantController.prototype, "findOne", null);
__decorate([
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    (0, common_1.Delete)('admin/applicants/:id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ApplicantController.prototype, "remove", null);
__decorate([
    (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
    (0, common_1.Get)('admin/dashboard/stats'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ApplicantController.prototype, "getDashboardStats", null);
exports.ApplicantController = ApplicantController = __decorate([
    (0, common_1.Controller)('api'),
    __metadata("design:paramtypes", [applicant_service_1.ApplicantService])
], ApplicantController);
//# sourceMappingURL=applicant.controller.js.map