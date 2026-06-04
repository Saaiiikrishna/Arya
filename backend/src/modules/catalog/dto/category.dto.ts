import {
  IsString,
  IsOptional,
  IsInt,
  IsUUID,
  IsBoolean,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  /**
   * Re-parent target. An explicit `null` moves the category to the root
   * (disconnect from parent). `@ValidateIf` skips the UUID check for `null` so
   * `{ parentId: null }` is accepted instead of failing as an invalid UUID.
   */
  @IsOptional()
  @ValidateIf((o: UpdateCategoryDto) => o.parentId !== null)
  @IsUUID()
  parentId?: string | null;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class DeleteCategoryQueryDto {
  /**
   * Required confirmation that deleting this category will float its child
   * categories to the root and re-sync the denormalized Product.category for the
   * affected subtree. Without `confirm=true` the delete is rejected.
   */
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}
