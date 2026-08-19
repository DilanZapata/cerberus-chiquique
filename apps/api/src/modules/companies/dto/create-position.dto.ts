import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreatePositionDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsUUID()
  scheduleId?: string;
}
