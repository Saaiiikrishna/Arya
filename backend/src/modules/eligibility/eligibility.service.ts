import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { CriteriaOperator } from '@prisma/client';
import { NotificationService } from '../notifications/notification.service';

@Injectable()
export class EligibilityService {
  private readonly logger = new Logger(EligibilityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

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
      case 'LT':
      case 'GTE':
      case 'LTE': {
        // Guard numeric operators: a non-numeric answer or expected value must
        // fail deterministically rather than silently coercing to NaN (NaN
        // comparisons are always false, which can flip NOT_* semantics elsewhere).
        const a = Number(val);
        const e = Number(expected);
        if (Number.isNaN(a) || Number.isNaN(e)) return false;
        if (operator === 'GT') return a > e;
        if (operator === 'LT') return a < e;
        if (operator === 'GTE') return a >= e;
        return a <= e;
      }
      case 'IN':
        // Misconfigured (non-array) expected value fails safe: nothing matches.
        return Array.isArray(expected) ? expected.includes(val) : false;
      case 'NOT_IN':
        // Misconfigured (non-array) expected value fails safe: treat as not-passed.
        return Array.isArray(expected) ? !expected.includes(val) : false;
      case 'CONTAINS':
        // Both operands must be strings; a non-scalar/array expected value fails safe.
        return typeof val === 'string' && (typeof expected === 'string' || typeof expected === 'number')
          ? val.includes(String(expected))
          : false;
      case 'NOT_CONTAINS':
        return typeof val === 'string' && (typeof expected === 'string' || typeof expected === 'number')
          ? !val.includes(String(expected))
          : false;
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
      select: {
        id: true,
        email: true,
        firstName: true,
        phone: true,
        accessToken: true,
        batch: { select: { batchNumber: true } },
      },
    });
    if (applicants.length === 0) {
      return { eligibleCount: 0, ineligibleCount: 0, total: 0 };
    }

    // Fetch criteria once and all answers for the batch in a single query each,
    // then evaluate in memory — avoids the previous 3×N per-applicant round-trips.
    const criteria = await this.prisma.eligibilityCriteria.findMany({
      where: { isActive: true },
    });
    const applicantIds = applicants.map((a) => a.id);
    const allAnswers = await this.prisma.answer.findMany({
      where: { applicantId: { in: applicantIds } },
      select: { applicantId: true, questionId: true, value: true },
    });

    const answersByApplicant = new Map<string, Map<string, any>>();
    for (const ans of allAnswers) {
      let m = answersByApplicant.get(ans.applicantId);
      if (!m) {
        m = new Map();
        answersByApplicant.set(ans.applicantId, m);
      }
      m.set(ans.questionId, ans.value);
    }

    const eligibleIds: string[] = [];
    const ineligibleIds: string[] = [];
    for (const applicant of applicants) {
      const answerMap = answersByApplicant.get(applicant.id) ?? new Map();
      const eligible = criteria.every((c) =>
        this.evaluateCriterion(answerMap.get(c.questionId), c.operator, c.value),
      );
      (eligible ? eligibleIds : ineligibleIds).push(applicant.id);
    }

    // Two bulk updates inside one transaction instead of N updates.
    await this.prisma.$transaction([
      ...(eligibleIds.length
        ? [this.prisma.applicant.updateMany({ where: { id: { in: eligibleIds } }, data: { status: 'ELIGIBLE' } })]
        : []),
      ...(ineligibleIds.length
        ? [this.prisma.applicant.updateMany({ where: { id: { in: ineligibleIds } }, data: { status: 'INELIGIBLE' } })]
        : []),
    ]);

    // After the status updates commit, notify each applicant of their result.
    // Best-effort and non-blocking: NotificationService swallows its own errors,
    // and Promise.allSettled ensures one failed send never aborts the rest.
    const eligibleIdSet = new Set(eligibleIds);
    await Promise.allSettled(
      applicants.map((a) =>
        this.notifications.eligibilityDecision(
          {
            id: a.id,
            email: a.email,
            firstName: a.firstName,
            phone: a.phone,
            accessToken: a.accessToken,
            batchNumber: a.batch?.batchNumber ?? null,
          },
          eligibleIdSet.has(a.id),
        ),
      ),
    );

    this.logger.log(`Batch screening: ${eligibleIds.length} eligible, ${ineligibleIds.length} ineligible`);
    return { eligibleCount: eligibleIds.length, ineligibleCount: ineligibleIds.length, total: applicants.length };
  }
}
