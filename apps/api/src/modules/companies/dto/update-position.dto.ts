import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class UpdatePositionDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsUUID()
  scheduleId?: string;
}
