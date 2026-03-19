import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { CriteriaOperator } from '@prisma/client';

@Injectable()
export class EligibilityService {
  private readonly logger = new Logger(EligibilityService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createCriteria(data: {
    questionId: string;
    operator: CriteriaOperator;
    value: any;
    weight?: number;
  }) {
    return this.prisma.eligibilityCriteria.create({ data });
  }

  async findAll() {
    return this.prisma.eligibilityCriteria.findMany({
      where: { isActive: true },
      include: { question: { select: { label: true, type: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async update(id: string, data: Partial<{
    operator: CriteriaOperator;
    value: any;
    weight: number;
    isActive: boolean;
  }>) {
    return this.prisma.eligibilityCriteria.update({ where: { id }, data });
  }

  async remove(id: string) {
    return this.prisma.eligibilityCriteria.update({
      where: { id },
      data: { isActive: false },
    });
  }

  /**
   * Evaluate an applicant against all active eligibility criteria.
   * Returns { eligible: boolean, results: CriteriaResult[] }
   */
  async evaluateApplicant(applicantId: string): Promise<{
    eligible: boolean;
    results: Array<{ criteriaId: string; passed: boolean; reason: string }>;
  }> {
    const criteria = await this.prisma.eligibilityCriteria.findMany({
      where: { isActive: true },
      include: { question: true },
    });

    const answers = await this.prisma.answer.findMany({
      where: { applicantId },
    });

    const answerMap = new Map(answers.map((a) => [a.questionId, a.value]));
    const results: Array<{ criteriaId: string; passed: boolean; reason: string }> = [];
    let eligible = true;

    for (const criterion of criteria) {
      const answer = answerMap.get(criterion.questionId);
      const passed = this.evaluateCriterion(answer, criterion.operator, criterion.value);

      if (!passed) eligible = false;

      results.push({
        criteriaId: criterion.id,
        passed,
        reason: passed
          ? `Passed: ${criterion.question.label}`
          : `Failed: ${criterion.question.label} (${criterion.operator} ${JSON.stringify(criterion.value)})`,
      });
    }

    return { eligible, results };
  }

  private evaluateCriterion(answer: any, operator: CriteriaOperator, expected: any): boolean {
    if (answer === undefined || answer === null) return false;

    // Unwrap JSON value
    const val = typeof answer === 'object' && answer !== null ? answer : answer;

    switch (operator) {
      case 'EQ':
        return val === expected;
      case 'NEQ':
        return val !== expected;
      case 'GT':
        return Number(val) > Number(expected);
      case 'LT':
        return Number(val) < Number(expected);
      case 'GTE':
        return Number(val) >= Number(expected);
      case 'LTE':
        return Number(val) <= Number(expected);
      case 'IN':
        return Array.isArray(expected) ? expected.includes(val) : false;
      case 'NOT_IN':
        return Array.isArray(expected) ? !expected.includes(val) : true;
      case 'CONTAINS':
        return typeof val === 'string' ? val.includes(String(expected)) : false;
      case 'NOT_CONTAINS':
        return typeof val === 'string' ? !val.includes(String(expected)) : true;
      default:
        return false;
    }
  }

  /**
   * Screen all applicants in a batch.
   */
  async screenBatch(batchId: string) {
    const applicants = await this.prisma.applicant.findMany({
      where: { batchId, status: 'PENDING' },
    });

    let eligibleCount = 0;
    let ineligibleCount = 0;

    for (const applicant of applicants) {
      const { eligible } = await this.evaluateApplicant(applicant.id);
      await this.prisma.applicant.update({
        where: { id: applicant.id },
        data: { status: eligible ? 'ELIGIBLE' : 'INELIGIBLE' },
      });
      if (eligible) eligibleCount++;
      else ineligibleCount++;
    }

    this.logger.log(`Batch screening: ${eligibleCount} eligible, ${ineligibleCount} ineligible`);
    return { eligibleCount, ineligibleCount, total: applicants.length };
  }
}
