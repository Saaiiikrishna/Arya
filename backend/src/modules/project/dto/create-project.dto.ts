import { IsInt, IsString, IsUUID, Min } from 'class-validator';

export class CreateProjectDto {
  @IsUUID()
  teamId: string;

  @IsString()
  projectName: string;

  @IsString()
  targetMarket: string;

  @IsString()
  description: string;

  /** Estimated funds in INTEGER PAISE (e.g. 100000 = ₹1000.00). */
  @IsInt()
  @Min(0)
  estimatedFunds: number;
}
