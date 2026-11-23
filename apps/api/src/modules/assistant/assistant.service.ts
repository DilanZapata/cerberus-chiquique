import { BadRequestException, ForbiddenException, HttpException, Injectable, Logger } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { OvertimeApprovalService } from '../novelties/services/overtime-approval.service';
import { AssistantTool, runAssistantTurn } from './openai.client';

/** Vueltas maximas de "el modelo pide una herramienta -> se le responde" por mensaje del usuario. */
const MAX_TOOL_ROUNDS = 6;
/** Mensajes por minuto por persona (cada mensaje cuesta dinero en OpenAI). */
const MAX_MESSAGES_PER_MINUTE = 20;
/** Vigencia de una autorizacion propuesta, mientras la persona la confirma. */
const PROPOSAL_TTL_MINUTES = 15;
const MAX_RANGE_DAYS = 62;
const MAX_DAYS_PER_PROPOSAL = 31;

const NOVELTY_LABELS: Record<string, string> = {
  RNO: 'Recargo nocturno',
  DDCOF: 'Dominical/festivo diurno',
  DNCOF: 'Dominical/festivo nocturno',
  HEOD: 'Hora extra diurna',
  HEON: 'Hora extra nocturna',
  HEFD: 'Hora extra festiva diurna',
  HEFN: 'Hora extra festiva nocturna',
  LLEGADA_TARDE: 'Llegada tarde',
  LLEGADA_TARDE_ALMUERZO: 'Llegada tarde de almuerzo',
  ABANDONO_ALMUERZO: 'No volvio de almuerzo',
  SALIDA_ANTICIPADA: 'Salida anticipada',
  AUSENCIA_INJUSTIFICADA: 'Ausencia injustificada',
  PERMISO_REMUNERADO: 'Permiso remunerado',
  PERMISO_NO_REMUNERADO: 'Permiso no remunerado',
  PERMISO_SALIDA_TEMPORAL: 'Permiso de salida temporal',
  INCAPACIDAD_GENERAL: 'Incapacidad general',
  INCAPACIDAD_ARL: 'Incapacidad ARL',
  VACACIONES: 'Vacaciones',
  HORA_EXTRA_PENDIENTE: 'Hora extra pendiente de autorizar',
  SALIDA_NO_REGISTRADA: 'No marco salida (cierre automatico)',
  JORNADA_REQUIERE_REVISION: 'Jornada requiere revision',
  SIN_DESCANSO_SEMANAL: 'Sin descanso semanal',
  LIMITE_HORAS_EXTRA_EXCEDIDO: 'Paso el tope de horas extra',
  DESCANSO_COMPENSATORIO_PENDIENTE: 'Descanso compensatorio pendiente',
};

/** Tipos de novedad que el usuario puede pedir por nombre ("llegadas tarde", "ausencias"...). */
const NOVELTY_GROUPS: Record<string, string[]> = {
  LLEGADAS_TARDE: ['LLEGADA_TARDE', 'LLEGADA_TARDE_ALMUERZO'],
  SALIDAS_ANTICIPADAS: ['SALIDA_ANTICIPADA'],
  AUSENCIAS: ['AUSENCIA_INJUSTIFICADA'],
  HORAS_EXTRA: ['HEOD', 'HEON', 'HEFD', 'HEFN'],
  RECARGOS: ['RNO', 'DDCOF', 'DNCOF'],
  PERMISOS_E_INCAPACIDADES: ['PERMISO_REMUNERADO', 'PERMISO_NO_REMUNERADO', 'PERMISO_SALIDA_TEMPORAL', 'INCAPACIDAD_GENERAL', 'INCAPACIDAD_ARL', 'VACACIONES'],
  ALERTAS: ['SALIDA_NO_REGISTRADA', 'JORNADA_REQUIERE_REVISION', 'ABANDONO_ALMUERZO', 'SIN_DESCANSO_SEMANAL', 'LIMITE_HORAS_EXTRA_EXCEDIDO'],
};

/** Una autorizacion de horas extra que el asistente dejo lista, a la espera de que la persona la confirme. */
export interface OvertimeProposal {
  token: string;
  expiresAt: string;
  employee: { id: string; fullName: string; employeeCode: string };
  days: Array<{
    date: string;
    /** Horas que la persona pidio autorizar ese dia. */
    hours: number;
    /** PENDIENTES = se suman a lo ya autorizado (aprueba parte de lo pendiente); TOTAL = es el total autorizado del dia. */
    mode: 'PENDIENTES' | 'TOTAL';
    reason: string;
    workedHours: number;
    currentAuthorizedHours: number;
    pendingHours: number;
    /** Total autorizado con el que queda el dia si se confirma. */
    resultingAuthorizedHours: number;
  }>;
}

interface ProposalPayload {
  jti: string;
  actorId: string;
  companyId: string;
  userId: string;
  exp: number;
  days: Array<{ date: string; hours: number; mode: 'PENDIENTES' | 'TOTAL'; reason: string }>;
}

const TOOLS: AssistantTool[] = [
  {
    name: 'buscar_empleado',
    description:
      'Busca empleados de la empresa por nombre, cedula o codigo. Usala SIEMPRE antes de consultar o autorizar algo de una persona, para obtener su id. Si hay varios resultados parecidos, pregunta al usuario cual es.',
    parameters: {
      type: 'object',
      properties: { texto: { type: 'string', description: 'Nombre (o parte), cedula o codigo del empleado.' } },
      required: ['texto'],
      additionalProperties: false,
    },
  },
  {
    name: 'horas_extra_empleado',
    description:
      'Horas extra de un empleado dia por dia en un rango de fechas: trabajadas, autorizadas, pendientes de autorizar y rechazadas, con el motivo de cada autorizacion.',
    parameters: {
      type: 'object',
      properties: {
        empleado_id: { type: 'string' },
        desde: { type: 'string', description: 'Fecha inicial YYYY-MM-DD.' },
        hasta: { type: 'string', description: 'Fecha final YYYY-MM-DD (maximo 62 dias de rango).' },
      },
      required: ['empleado_id', 'desde', 'hasta'],
      additionalProperties: false,
    },
  },
  {
    name: 'horas_extra_pendientes',
    description: 'Lista de horas extra PENDIENTES de autorizar en toda la empresa (quien, que dia, cuantas horas).',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'novedades_empleado',
    description:
      'Novedades de asistencia de un empleado en un rango de fechas: llegadas tarde, salidas anticipadas, ausencias, permisos, incapacidades, recargos, alertas. Devuelve el conteo por tipo y el detalle por dia.',
    parameters: {
      type: 'object',
      properties: {
        empleado_id: { type: 'string' },
        desde: { type: 'string', description: 'Fecha inicial YYYY-MM-DD.' },
        hasta: { type: 'string', description: 'Fecha final YYYY-MM-DD (maximo 62 dias de rango).' },
        tipo: {
          type: 'string',
          enum: ['TODAS', ...Object.keys(NOVELTY_GROUPS)],
          description: 'Filtra por tipo de novedad. TODAS para verlas todas.',
        },
      },
      required: ['empleado_id', 'desde', 'hasta', 'tipo'],
      additionalProperties: false,
    },
  },
  {
    name: 'proponer_autorizacion',
    description:
      'Deja LISTA (no la ejecuta) una autorizacion de horas extra para un empleado, uno o varios dias. Solo se llama cuando el usuario ya dijo, PARA CADA DIA, cuantas horas y el motivo de ese dia. El usuario despues la confirma con un boton en la app. Si un dia tiene horas pendientes, "horas" son las que se aprueban de esas pendientes; si no tiene pendientes, "horas" es el total que queda autorizado para ese dia.',
    parameters: {
      type: 'object',
      properties: {
        empleado_id: { type: 'string' },
        dias: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              fecha: { type: 'string', description: 'Dia YYYY-MM-DD.' },
              horas: { type: 'number', description: 'Horas a autorizar ese dia, en pasos de media hora (0.5, 1, 1.5...).' },
              motivo: { type: 'string', description: 'El motivo que dio el usuario PARA ESE DIA, con sus palabras. Nunca inventado.' },
            },
            required: ['fecha', 'horas', 'motivo'],
            additionalProperties: false,
          },
        },
      },
      required: ['empleado_id', 'dias'],
      additionalProperties: false,
    },
  },
];

function isDateKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00`));
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Asistente de la app Cerberus Managers: un chat (modelo de OpenAI) que
 * consulta horas extra y novedades y prepara autorizaciones de horas extra.
 *
 * Reglas de seguridad:
 *  - El modelo NUNCA escribe en la base de datos. Solo puede consultar (con
 *    las herramientas de arriba, siempre dentro de la empresa de quien
 *    pregunta) y dejar PROPUESTA una autorizacion.
 *  - La autorizacion se ejecuta solo cuando la persona toca "Confirmar" en la
 *    app (`confirm`), con una propuesta firmada por el servidor, de un solo
 *    uso, y pasando por las mismas validaciones y permisos de siempre
 *    (`OvertimeApprovalService.authorize`).
 *  - Cada dia autorizado exige su motivo: sin motivo no hay propuesta.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private readonly recentMessages = new Map<string, number[]>();
  private readonly usedProposals = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly overtime: OvertimeApprovalService,
  ) {}

  // ---------------------------------------------------------------- chat

  async chat(actor: AuthenticatedUser, history: Array<{ role: 'user' | 'assistant'; content: string }>) {
    if (history[history.length - 1]?.role !== 'user') {
      throw new BadRequestException('El ultimo mensaje de la conversacion debe ser del usuario.');
    }
    this.assertRateLimit(actor.id);

    const [me, permissions] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: actor.id }, select: { fullName: true } }),
      this.overtime.getPermissions(actor),
    ]);

    let proposal: OvertimeProposal | null = null;
    const reply = await runAssistantTurn({
      system: this.systemPrompt(me?.fullName ?? 'Usuario', actor.role, permissions.canApprove),
      history: history.map((message) => ({ role: message.role, content: message.content })),
      tools: TOOLS,
      maxRounds: MAX_TOOL_ROUNDS,
      runTool: async (name, rawArguments) => {
        const result = await this.runTool(actor, name, rawArguments);
        if (result.proposal) proposal = result.proposal;
        return JSON.stringify(result.output);
      },
    });
    return {
      reply: reply || (proposal ? 'Revisa el resumen y toca Confirmar para que quede hecho.' : 'No alcance a terminar esa consulta. Intenta pedirla en partes mas pequenas.'),
      pendingAction: proposal as OvertimeProposal | null,
    };
  }

  private systemPrompt(actorName: string, role: string, canApprove: boolean): string {
    const today = new Date();
    const weekday = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'][today.getDay()];
    return [
      'Eres el asistente de Cerberus, el sistema de asistencia y nomina de la empresa. Hablas con un jefe o supervisor desde la app.',
      `Hoy es ${weekday} ${localDateKey(today)} (hora de Colombia). Te habla ${actorName}, con rol ${role}.`,
      canApprove
        ? 'Esta persona SI puede autorizar horas extra.'
        : 'Esta persona NO puede autorizar horas extra: si lo pide, dile que su rol no esta habilitado y que solo puede consultar.',
      '',
      'Que puedes hacer: consultar horas extra y novedades de asistencia (llegadas tarde, salidas anticipadas, ausencias, permisos, recargos) y preparar autorizaciones de horas extra. Nada mas: si te piden otra cosa, dilo con amabilidad.',
      '',
      'Reglas:',
      '- Responde siempre en espanol, corto y claro, como en un chat. Sin tablas ni markdown; usa listas con guiones cuando haya varios dias.',
      '- Nunca inventes datos. Todo numero, fecha o nombre que digas debe venir de una herramienta. Si no lo tienes, consultalo o di que no lo encuentras.',
      '- Antes de consultar o autorizar algo de una persona, buscala con buscar_empleado. Si hay varias parecidas, pregunta cual es mostrando nombre y cedula. Si no aparece, dilo.',
      '- Si el usuario no dice el ano o el mes de una fecha, asume el mes y el ano actuales; si la fecha queda en el futuro lejano o es ambigua, pregunta.',
      '- Las horas se dicen en horas con medias (2,5 h), nunca con mas decimales.',
      '',
      'Para AUTORIZAR horas extra sigue estos pasos, sin saltarte ninguno:',
      '1. Identifica a la persona y los dias. Consulta horas_extra_empleado para esos dias.',
      '2. Para CADA dia necesitas dos cosas dichas por el usuario: cuantas horas y el motivo de ese dia.',
      '   - Si el dia tiene horas pendientes, dile cuantas tiene pendientes y pregunta cuantas de esas autoriza.',
      '   - Si el dia no tiene pendientes, pregunta cuantas horas autoriza para ese dia.',
      '   - El motivo es obligatorio para cada dia. Si el usuario da un solo motivo para varios dias, confirmale que aplica a todos esos dias antes de usarlo. Nunca inventes ni completes un motivo.',
      '3. Si falta la cantidad o el motivo de algun dia, pregunta solo lo que falta, dia por dia.',
      '4. Cuando tengas TODO, llama proponer_autorizacion una sola vez con todos los dias.',
      '5. Despues dile al usuario, en una linea, que revise el resumen y toque Confirmar en la pantalla para que quede hecho. Tu no puedes confirmarla: solo el boton lo hace. Nunca digas que ya quedo autorizado.',
    ].join('\n');
  }

  private assertRateLimit(actorId: string): void {
    const now = Date.now();
    const recent = (this.recentMessages.get(actorId) ?? []).filter((at) => now - at < 60_000);
    if (recent.length >= MAX_MESSAGES_PER_MINUTE) {
      throw new HttpException('Vas muy rapido. Espera un momento y vuelve a escribir.', 429);
    }
    recent.push(now);
    this.recentMessages.set(actorId, recent);
  }

  // ---------------------------------------------------------- herramientas

  private async runTool(actor: AuthenticatedUser, name: string, rawArguments: string): Promise<{ output: unknown; proposal?: OvertimeProposal }> {
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(rawArguments || '{}');
    } catch {
      return { output: { error: 'Argumentos invalidos.' } };
    }
    try {
      switch (name) {
        case 'buscar_empleado':
          return { output: await this.searchEmployees(actor, String(args.texto ?? '')) };
        case 'horas_extra_empleado':
          return { output: await this.employeeOvertime(actor, String(args.empleado_id ?? ''), args.desde, args.hasta) };
        case 'horas_extra_pendientes':
          return { output: await this.pendingOvertime(actor) };
        case 'novedades_empleado':
          return { output: await this.employeeNovelties(actor, String(args.empleado_id ?? ''), args.desde, args.hasta, String(args.tipo ?? 'TODAS')) };
        case 'proponer_autorizacion':
          return await this.proposeAuthorization(actor, String(args.empleado_id ?? ''), args.dias);
        default:
          return { output: { error: `Herramienta desconocida: ${name}` } };
      }
    } catch (error) {
      // El error se le devuelve al modelo para que se lo explique al usuario.
      const message = error instanceof HttpException ? this.httpMessage(error) : 'No se pudo completar la consulta.';
      if (!(error instanceof HttpException)) this.logger.error(`Fallo la herramienta ${name}: ${(error as Error).message}`);
      return { output: { error: message } };
    }
  }

  private httpMessage(error: HttpException): string {
    const response = error.getResponse();
    if (typeof response === 'string') return response;
    const message = (response as { message?: string | string[] }).message;
    return Array.isArray(message) ? message.join(' ') : message ?? error.message;
  }

  private async searchEmployees(actor: AuthenticatedUser, text: string) {
    const query = text.trim();
    if (query.length < 2) return { error: 'Escribe al menos 2 letras o numeros para buscar.' };
    const words = query.split(/\s+/).filter(Boolean).slice(0, 4);
    const employees = await this.prisma.user.findMany({
      where: {
        companyId: actor.companyId,
        isActive: true,
        OR: [
          { AND: words.map((word) => ({ fullName: { contains: word, mode: 'insensitive' as const } })) },
          { nationalId: { contains: query } },
          { employeeCode: { contains: query, mode: 'insensitive' as const } },
        ],
      },
      select: { id: true, fullName: true, nationalId: true, employeeCode: true, position: { select: { name: true } } },
      orderBy: { fullName: 'asc' },
      take: 8,
    });
    return {
      encontrados: employees.length,
      empleados: employees.map((e) => ({ id: e.id, nombre: e.fullName, cedula: e.nationalId, codigo: e.employeeCode, cargo: e.position?.name ?? null })),
    };
  }

  private assertRange(from: unknown, to: unknown): { from: string; to: string } {
    if (!isDateKey(from) || !isDateKey(to)) throw new BadRequestException('Las fechas deben venir como YYYY-MM-DD.');
    const days = (Date.parse(`${to}T00:00:00`) - Date.parse(`${from}T00:00:00`)) / 86_400_000;
    if (days < 0 || days > MAX_RANGE_DAYS) throw new BadRequestException(`El rango debe ser de maximo ${MAX_RANGE_DAYS} dias.`);
    return { from, to };
  }

  private async employeeOvertime(actor: AuthenticatedUser, userId: string, from: unknown, to: unknown) {
    const range = this.assertRange(from, to);
    const rows = await this.overtime.listEmployeeOvertime(actor.companyId, userId, range.from, range.to);
    const sum = (field: 'workedHours' | 'approvedHours' | 'pendingHours' | 'rejectedHours') => rows.reduce((total, row) => total + row[field], 0);
    return {
      empleado: rows[0]?.fullName ?? null,
      desde: range.from,
      hasta: range.to,
      dias: rows.map((row) => ({
        fecha: row.workDate,
        horas_extra_trabajadas: row.workedHours,
        horas_autorizadas: row.authorizedHours,
        horas_pendientes: row.pendingHours,
        horas_rechazadas: row.rejectedHours,
        motivo_autorizacion: row.notes,
        autorizo: row.authorizedByName,
      })),
      totales: { trabajadas: sum('workedHours'), aprobadas: sum('approvedHours'), pendientes: sum('pendingHours'), rechazadas: sum('rejectedHours') },
      nota: rows.length === 0 ? 'No tiene horas extra ni autorizaciones en ese rango.' : undefined,
    };
  }

  private async pendingOvertime(actor: AuthenticatedUser) {
    const pending = await this.overtime.listPending(actor);
    return {
      total_solicitudes: pending.length,
      pendientes: pending.slice(0, 40).map((item) => ({
        empleado: item.novelty.user.fullName,
        empleado_id: item.novelty.userId,
        fecha: item.novelty.workDate.toISOString().slice(0, 10),
        horas_pendientes: item.pendingHours,
        horas_ya_autorizadas: item.authorizedHours,
      })),
      nota: pending.length === 0 ? 'No hay horas extra pendientes de autorizar.' : pending.length > 40 ? 'Hay mas de 40; se muestran las primeras.' : undefined,
    };
  }

  private async employeeNovelties(actor: AuthenticatedUser, userId: string, from: unknown, to: unknown, type: string) {
    const range = this.assertRange(from, to);
    const employee = await this.prisma.user.findFirst({ where: { id: userId, companyId: actor.companyId }, select: { fullName: true } });
    if (!employee) return { error: 'Empleado no encontrado en tu empresa.' };
    const codes = type === 'TODAS' ? undefined : NOVELTY_GROUPS[type];
    if (type !== 'TODAS' && !codes) return { error: 'Tipo de novedad desconocido.' };

    const rows = await this.prisma.novelty.findMany({
      where: {
        userId,
        workDate: { gte: new Date(`${range.from}T00:00:00`), lte: new Date(`${range.to}T00:00:00`) },
        ...(codes ? { code: { in: codes as never[] } } : {}),
      },
      orderBy: [{ workDate: 'asc' }, { code: 'asc' }],
      select: { workDate: true, code: true, hours: true, status: true, notes: true },
    });
    const byType = new Map<string, { veces: number; horas: number }>();
    for (const row of rows) {
      const label = NOVELTY_LABELS[row.code] ?? row.code;
      const entry = byType.get(label) ?? { veces: 0, horas: 0 };
      entry.veces += 1;
      entry.horas += row.hours.toNumber();
      byType.set(label, entry);
    }
    return {
      empleado: employee.fullName,
      desde: range.from,
      hasta: range.to,
      resumen: [...byType.entries()].map(([tipo, value]) => ({ tipo, veces: value.veces, horas: Math.round(value.horas * 10) / 10 })),
      detalle: rows.slice(0, 80).map((row) => ({
        fecha: row.workDate.toISOString().slice(0, 10),
        tipo: NOVELTY_LABELS[row.code] ?? row.code,
        horas: row.hours.toNumber(),
        estado: row.status,
        nota: row.notes ?? undefined,
      })),
      nota: rows.length === 0 ? 'No tiene novedades de ese tipo en ese rango.' : rows.length > 80 ? 'Hay mas de 80 novedades; el detalle muestra las primeras.' : undefined,
    };
  }

  // -------------------------------------------------- propuesta y confirmacion

  private async proposeAuthorization(actor: AuthenticatedUser, userId: string, rawDays: unknown): Promise<{ output: unknown; proposal?: OvertimeProposal }> {
    const { canApprove } = await this.overtime.getPermissions(actor);
    if (!canApprove) return { output: { error: 'Tu rol no esta habilitado para autorizar horas extra en esta empresa.' } };

    const employee = await this.prisma.user.findFirst({
      where: { id: userId, companyId: actor.companyId, isActive: true },
      select: { id: true, fullName: true, employeeCode: true },
    });
    if (!employee) return { output: { error: 'Empleado no encontrado en tu empresa. Buscalo primero con buscar_empleado.' } };
    if (!Array.isArray(rawDays) || rawDays.length === 0) return { output: { error: 'Faltan los dias a autorizar.' } };
    if (rawDays.length > MAX_DAYS_PER_PROPOSAL) return { output: { error: `Maximo ${MAX_DAYS_PER_PROPOSAL} dias por autorizacion.` } };

    const problems: string[] = [];
    const days: OvertimeProposal['days'] = [];
    const seen = new Set<string>();
    for (const raw of rawDays as Array<Record<string, unknown>>) {
      const date = raw?.fecha;
      const hours = Number(raw?.horas);
      const reason = String(raw?.motivo ?? '').trim();
      if (!isDateKey(date)) {
        problems.push(`Fecha invalida: ${String(date)}.`);
        continue;
      }
      if (seen.has(date)) {
        problems.push(`El dia ${date} esta repetido.`);
        continue;
      }
      seen.add(date);
      if (!Number.isFinite(hours) || hours <= 0 || hours > 16 || Math.abs(hours * 2 - Math.round(hours * 2)) > 1e-9) {
        problems.push(`Dia ${date}: las horas deben ir en pasos de media hora, entre 0.5 y 16.`);
        continue;
      }
      if (reason.length < 4) {
        problems.push(`Dia ${date}: falta el motivo. Preguntale al usuario el motivo de ese dia.`);
        continue;
      }
      const current = await this.overtime.describeDay(actor.companyId, employee.id, date);
      if (current.pendingHours > 0 && hours > current.pendingHours + 1e-9) {
        problems.push(`Dia ${date}: solo tiene ${current.pendingHours} h pendientes; no se pueden autorizar ${hours} de las pendientes. Preguntale al usuario cuantas de esas ${current.pendingHours} autoriza.`);
        continue;
      }
      const mode: 'PENDIENTES' | 'TOTAL' = current.pendingHours > 0 ? 'PENDIENTES' : 'TOTAL';
      days.push({
        date,
        hours,
        mode,
        reason: reason.slice(0, 500),
        workedHours: current.workedHours,
        currentAuthorizedHours: current.authorizedHours,
        pendingHours: current.pendingHours,
        resultingAuthorizedHours: mode === 'PENDIENTES' ? current.authorizedHours + hours : hours,
      });
    }
    if (problems.length > 0) return { output: { error: 'No se pudo dejar lista la autorizacion.', problemas: problems } };

    days.sort((a, b) => a.date.localeCompare(b.date));
    const expiresAtMs = Date.now() + PROPOSAL_TTL_MINUTES * 60_000;
    const token = this.signProposal({
      jti: randomUUID(),
      actorId: actor.id,
      companyId: actor.companyId,
      userId: employee.id,
      exp: expiresAtMs,
      days: days.map((d) => ({ date: d.date, hours: d.hours, mode: d.mode, reason: d.reason })),
    });
    const proposal: OvertimeProposal = { token, expiresAt: new Date(expiresAtMs).toISOString(), employee, days };
    return {
      proposal,
      output: {
        estado: 'LISTA_PARA_CONFIRMAR',
        instruccion: 'Dile al usuario que revise el resumen en pantalla y toque Confirmar. Todavia NO esta autorizado.',
        empleado: employee.fullName,
        dias: days.map((d) => ({
          fecha: d.date,
          horas: d.hours,
          motivo: d.reason,
          quedara_autorizado_total: d.resultingAuthorizedHours,
          aviso: d.resultingAuthorizedHours < d.currentAuthorizedHours ? `Ojo: hoy tiene ${d.currentAuthorizedHours} h autorizadas y bajaria a ${d.resultingAuthorizedHours}.` : undefined,
        })),
      },
    };
  }

  /** Ejecuta una autorizacion propuesta, cuando la persona toca "Confirmar". */
  async confirm(actor: AuthenticatedUser, token: string) {
    const payload = this.verifyProposal(token);
    if (payload.actorId !== actor.id || payload.companyId !== actor.companyId) {
      throw new ForbiddenException('Esta autorizacion la preparo otra persona.');
    }
    const now = Date.now();
    if (payload.exp < now) throw new BadRequestException('Esta autorizacion ya vencio. Pidesela otra vez al asistente.');
    for (const [jti, exp] of this.usedProposals) if (exp < now) this.usedProposals.delete(jti);
    if (this.usedProposals.has(payload.jti)) throw new BadRequestException('Esta autorizacion ya fue confirmada.');
    this.usedProposals.set(payload.jti, payload.exp);

    const results = [];
    try {
      for (const day of payload.days) {
        const current = await this.overtime.describeDay(actor.companyId, payload.userId, day.date);
        const total = day.mode === 'PENDIENTES' ? current.authorizedHours + day.hours : day.hours;
        const done = await this.overtime.authorize(actor, { userId: payload.userId, workDate: day.date, hours: total, notes: day.reason });
        results.push({ date: day.date, authorizedHours: done.authorizedHours, pendingHours: done.pendingHours, reason: day.reason });
      }
    } catch (error) {
      // Si fallo a mitad de camino, la propuesta se puede volver a confirmar (autorizar es "poner el total", repetirlo no duplica).
      this.usedProposals.delete(payload.jti);
      throw error;
    }
    const employee = await this.prisma.user.findUnique({ where: { id: payload.userId }, select: { fullName: true } });
    return {
      message: `Listo. Quedaron autorizadas las horas extra de ${employee?.fullName ?? 'la persona'} en ${results.length} dia(s).`,
      employee: employee?.fullName ?? '',
      days: results,
    };
  }

  private proposalSecret(): string {
    return `${process.env.JWT_SECRET ?? 'change-me'}:assistant-proposal`;
  }

  private signProposal(payload: ProposalPayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', this.proposalSecret()).update(body).digest('base64url');
    return `${body}.${signature}`;
  }

  private verifyProposal(token: string): ProposalPayload {
    const [body, signature] = token.split('.');
    const expected = createHmac('sha256', this.proposalSecret()).update(body ?? '').digest('base64url');
    const valid = Boolean(body && signature) && signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    if (!valid) throw new BadRequestException('Autorizacion invalida.');
    try {
      return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ProposalPayload;
    } catch {
      throw new BadRequestException('Autorizacion invalida.');
    }
  }
}
