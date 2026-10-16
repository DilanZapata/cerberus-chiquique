import { IsString, MinLength } from 'class-validator';

export class ResetUserPasswordDto {
  @IsString()
  @MinLength(4)
  newPassword!: string;
}
