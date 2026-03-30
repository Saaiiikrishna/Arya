import { MilestoneType } from '@prisma/client';

export class CreateMilestoneDto {
  title: string;
  description?: string;
  deadline: Date;
  type?: MilestoneType;
}
