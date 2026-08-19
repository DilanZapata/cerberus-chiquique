export const NOVELTY_LABELS: Record<string, string> = {
  RNO: 'Recargo Nocturno Ordinario',
  DDCOF: 'Dominical/Festivo Diurno',
  DNCOF: 'Dominical/Festivo Nocturno',
  HEOD: 'Hora Extra Diurna',
  HEON: 'Hora Extra Nocturna',
  HEFD: 'Hora Extra Festiva Diurna',
  HEFN: 'Hora Extra Festiva Nocturna',
  LLEGADA_TARDE: 'Llegada tarde',
  LLEGADA_TARDE_ALMUERZO: 'Llegada tarde de almuerzo',
  ABANDONO_ALMUERZO: 'Abandono tras almuerzo',
  SALIDA_ANTICIPADA: 'Salida anticipada',
  AUSENCIA_INJUSTIFICADA: 'Ausencia injustificada',
  PERMISO_REMUNERADO: 'Permiso remunerado',
  PERMISO_NO_REMUNERADO: 'Permiso no remunerado',
  PERMISO_SALIDA_TEMPORAL: 'Permiso de salida temporal',
  INCAPACIDAD_GENERAL: 'Incapacidad general',
  INCAPACIDAD_ARL: 'Incapacidad ARL',
  VACACIONES: 'Vacaciones',
  HORA_EXTRA_PENDIENTE: 'Hora extra pendiente de autorizacion',
};

export const NOVELTY_BADGE_CLASS: Record<string, string> = {
  PENDIENTE: 'bg-amber-100 text-amber-800 ring-amber-600/20',
  APROBADA: 'bg-emerald-100 text-emerald-800 ring-emerald-600/20',
  RECHAZADA: 'bg-red-100 text-red-800 ring-red-600/20',
  AUTO_CALCULADA: 'bg-slate-100 text-slate-700 ring-slate-500/20',
};

export function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}
