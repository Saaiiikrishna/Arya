import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateLedgerDto } from './dto/create-ledger.dto';

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN', 'MODERATOR'];

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async createTransaction(createLedgerDto: CreateLedgerDto) {
    // We run this in a transaction to update the fundedAmount on the project
    return this.prisma.$transaction(async (tx) => {
      const transaction = await tx.ledgerTransaction.create({
        data: createLedgerDto,
      });

      // If it's a disbursement, it increases the funded amount
      if (createLedgerDto.type === 'DISBURSEMENT') {
        await tx.project.update({
          where: { id: createLedgerDto.projectId },
          data: { fundedAmount: { increment: createLedgerDto.amount } },
        });
      }

      return transaction;
    });
  }

  async getTransactionsByProject(
    projectId: string,
    requesterId: string,
    requesterRole?: string,
  ) {
    // Authorization: admins may view any project's financials; everyone else
    // may only view projects belonging to their own team. Prevents IDOR.
    const isAdmin = ADMIN_ROLES.includes(requesterRole || '');
    if (!isAdmin) {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { teamId: true },
      });
      if (!project) throw new NotFoundException('Project not found');

      const requester = await this.prisma.applicant.findUnique({
        where: { id: requesterId },
        select: { teamId: true },
      });
      if (!requester?.teamId || requester.teamId !== project.teamId) {
        throw new ForbiddenException(
          'You can only view financials for your own team’s project',
        );
      }
    }

    return this.prisma.ledgerTransaction.findMany({
      where: { projectId },
      orderBy: { date: 'desc' },
    });
  }
}
