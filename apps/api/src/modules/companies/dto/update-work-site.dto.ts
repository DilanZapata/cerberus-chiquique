import { IsInt, IsLatitude, IsLongitude, IsOptional, IsString, Min } from 'class-validator';

export class UpdateWorkSiteDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @IsInt()
  @Min(10)
  gpsRadiusMeters?: number;
}
