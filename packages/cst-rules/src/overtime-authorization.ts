import { CalculatedNovelty, DailyCalculationResult, NoveltyCode, NoveltyOrigin, NoveltyStatus } from '@cerberus/shared-types';
import { round } from './math-utils';

const OVERTIME_DETAIL_CODES: NoveltyCode[] = [NoveltyCode.HEOD, NoveltyCode.HEON, NoveltyCode.HEFD, NoveltyCode.HEFN];

export interface OvertimeAuthorizationInput {
  /** Horas extra autorizadas para ese empleado ese dia (antes o despues de trabajarlas). */
  authorizedHours: number;
  /** true si un responsable RECHAZO lo que exceda de lo autorizado (en vez de dejarlo pendiente). */
  excessRejected: boolean;
}

export interface OvertimeAuthorizationOutcome {
  result: DailyCalculationResult;
  /** Horas extra realmente trabajadas ese dia (todas, sin importar su estado). */
  workedOvertimeHours: number;
  /** Horas que quedan cubiertas por la autorizacion: min(autorizadas, trabajadas). Son las que se pagan. */
  approvedHours: number;
  /** Horas trabajadas por encima de lo autorizado y aun sin decidir. */
  pendingHours: number;
  /** Horas trabajadas por encima de lo autorizado y rechazadas. */
  rejectedHours: number;
}

/**
 * Aplica la autorizacion de horas extra del dia al resultado del calculo.
 *
 * La regla: se paga lo MENOR entre lo autorizado y lo trabajado.
 *  - Autorizo 1h y trabajo 0.5h -> 0.5h aprobada (la autorizacion de 1h
 *    queda como trazabilidad, pero solo se paga lo trabajado).
 *  - Autorizo 1h y trabajo 2h -> 1h aprobada y 1h queda PENDIENTE de
 *    autorizar (o RECHAZADA, si ya se rechazo el excedente).
 *
 * La autorizacion cubre las PRIMERAS horas extra trabajadas, en el orden
 * cronologico en que se causaron (`result.overtimeOrder`): si alguien hizo
 * primero extra diurna y luego nocturna, una autorizacion parcial cubre
 * primero la diurna.
 *
 * Solo toca horas extra que el calculo dejo PENDIENTE (empresas que exigen
 * autorizacion); si la empresa no la exige, ya vienen AUTO_CALCULADA y no
 * hay nada que aplicar.
 */
export function applyOvertimeAuthorization(
  result: DailyCalculationResult,
  authorization: OvertimeAuthorizationInput | null,
): OvertimeAuthorizationOutcome {
  const isPendingDetail = (n: CalculatedNovelty) => OVERTIME_DETAIL_CODES.includes(n.code) && n.status === NoveltyStatus.PENDIENTE;
  const pendingDetail = result.novelties.filter(isPendingDetail);
  const workedOvertimeHours = round(pendingDetail.reduce((sum, n) => sum + n.hours, 0));

  if (!authorization || pendingDetail.length === 0) {
    return { result, workedOvertimeHours, approvedHours: 0, pendingHours: workedOvertimeHours, rejectedHours: 0 };
  }

  const order = result.overtimeOrder ?? [];
  const rank = (code: NoveltyCode) => {
    const index = order.indexOf(code);
    return index === -1 ? order.length + OVERTIME_DETAIL_CODES.indexOf(code) : index;
  };
  const chronological = [...pendingDetail].sort((a, b) => rank(a.code) - rank(b.code));

  let remaining = Math.max(0, authorization.authorizedHours);
  let approvedHours = 0;
  let excessHours = 0;
  const split: CalculatedNovelty[] = [];
  for (const novelty of chronological) {
    const approved = round(Math.min(novelty.hours, remaining));
    const excess = round(novelty.hours - approved);
    remaining = round(remaining - approved);
    if (approved > 0) {
      approvedHours = round(approvedHours + approved);
      split.push({ ...novelty, hours: approved, status: NoveltyStatus.APROBADA, notes: 'Hora extra autorizada.' });
    }
    if (excess > 0) {
      excessHours = round(excessHours + excess);
      split.push({
        ...novelty,
        hours: excess,
        status: authorization.excessRejected ? NoveltyStatus.RECHAZADA : NoveltyStatus.PENDIENTE,
        notes: authorization.excessRejected
          ? 'Hora extra trabajada por encima de lo autorizado; rechazada.'
          : 'Hora extra trabajada por encima de lo autorizado; pendiente de autorizar.',
      });
    }
  }

  const pendingHours = authorization.excessRejected ? 0 : excessHours;
  const rejectedHours = authorization.excessRejected ? excessHours : 0;

  // Se conservan las demas novedades en su sitio; el detalle de hora extra
  // se reemplaza por sus partes, y el agregado HORA_EXTRA_PENDIENTE pasa a
  // reflejar solo lo que de verdad sigue pendiente.
  const novelties: CalculatedNovelty[] = [];
  let detailInserted = false;
  for (const novelty of result.novelties) {
    if (isPendingDetail(novelty)) {
      if (!detailInserted) {
        novelties.push(...split);
        detailInserted = true;
      }
      continue;
    }
    if (novelty.code === NoveltyCode.HORA_EXTRA_PENDIENTE) continue;
    novelties.push(novelty);
  }
  if (pendingHours > 0) {
    novelties.push({
      code: NoveltyCode.HORA_EXTRA_PENDIENTE,
      hours: pendingHours,
      status: NoveltyStatus.PENDIENTE,
      origin: NoveltyOrigin.SISTEMA,
      notes:
        approvedHours > 0
          ? `Se autorizaron ${authorization.authorizedHours} h y se trabajaron ${workedOvertimeHours} h extra: ${pendingHours} h pendientes de autorizar.`
          : 'Horas extra detectadas sin autorizacion previa; requieren aprobacion de un supervisor.',
    });
  }

  return {
    result: { ...result, novelties, hasPendingOvertime: pendingHours > 0 },
    workedOvertimeHours,
    approvedHours,
    pendingHours,
    rejectedHours,
  };
}
