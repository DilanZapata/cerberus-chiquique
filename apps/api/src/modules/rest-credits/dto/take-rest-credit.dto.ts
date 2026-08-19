import { IsDateString } from 'class-validator';

export class TakeRestCreditDto {
  @IsDateString()
  takenDate!: string;
}
