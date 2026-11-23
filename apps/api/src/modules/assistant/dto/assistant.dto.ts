import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class AssistantMessageDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content!: string;
}

/** La conversacion completa hasta ahora (la guarda la app; el servidor no guarda el chat). */
export class AssistantChatDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => AssistantMessageDto)
  messages!: AssistantMessageDto[];
}

/** Confirmacion de una autorizacion que el asistente dejo propuesta. */
export class AssistantConfirmDto {
  @IsString()
  @MaxLength(6000)
  token!: string;
}
