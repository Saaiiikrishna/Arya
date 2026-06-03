import { IsDateString, IsString } from 'class-validator';

export class CreateSprintDto {
  @IsString()
  teamId: string;

  @IsString()
  title: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;
}
