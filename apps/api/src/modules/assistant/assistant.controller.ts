import { Body, Controller, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { AssistantService } from './assistant.service';
import { AssistantChatDto, AssistantConfirmDto } from './dto/assistant.dto';

/** Asistente (chat) de la app Cerberus Managers. Solo jefatura. */
@Roles(UserRole.ADMIN, UserRole.HR, UserRole.SUPERVISOR)
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  /** Un mensaje del chat. Devuelve la respuesta y, si aplica, una autorizacion lista para confirmar. */
  @Post('chat')
  chat(@CurrentUser() actor: AuthenticatedUser, @Body() dto: AssistantChatDto) {
    return this.assistantService.chat(actor, dto.messages);
  }

  /** Confirma (ejecuta) una autorizacion de horas extra que el asistente dejo propuesta. */
  @Post('confirm')
  confirm(@CurrentUser() actor: AuthenticatedUser, @Body() dto: AssistantConfirmDto) {
    return this.assistantService.confirm(actor, dto.token);
  }
}
