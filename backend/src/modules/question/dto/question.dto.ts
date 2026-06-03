import {
  IsString,
  IsEnum,
  IsOptional,
  IsBoolean,
  IsInt,
  IsObject,
  IsUUID,
  ValidateNested,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';
import { QuestionType, PhaseTag } from '@prisma/client';

export class CreateQuestionDto {
  @IsString()
  label!: string;

  @IsOptional()
  @IsString()
  helpText?: string;

  @IsEnum(QuestionType)
  type!: QuestionType;

  @IsOptional()
  @IsObject()
  options?: any; // [{ value, label }] for SELECT/MULTISELECT

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsEnum(PhaseTag)
  phaseTag?: PhaseTag;

  @IsOptional()
  @IsObject()
  validation?: any; // { min, max, pattern }
}

export class UpdateQuestionDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  helpText?: string;

  @IsOptional()
  @IsEnum(QuestionType)
  type?: QuestionType;

  @IsOptional()
  @IsObject()
  options?: any;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsEnum(PhaseTag)
  phaseTag?: PhaseTag;

  @IsOptional()
  @IsObject()
  validation?: any;
}

export class ReorderQuestionItemDto {
  @IsString()
  @IsUUID()
  id!: string;

  @IsInt()
  sortOrder!: number;
}

export class ReorderQuestionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderQuestionItemDto)
  items!: ReorderQuestionItemDto[];
}
