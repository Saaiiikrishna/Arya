import { ProjectStatus } from '@prisma/client';

export class CreateProjectDto {
  teamId: string;
  projectName: string;
  targetMarket: string;
  description: string;
  estimatedFunds: number;
}
