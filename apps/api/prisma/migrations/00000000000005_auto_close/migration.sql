-- =====================================================================
-- Cierre automatico de jornadas abiertas (Fase 2 del rediseno de control
-- de asistencia). Nuevos valores de enum, deben ir antes de cualquier uso.
-- =====================================================================

-- Marca de salida generada por el proceso automatico de cierre de dia,
-- distinta de KIOSK/MOBILE_GPS/WEB/MANUAL para que quede claramente
-- identificable en el historial y en los reportes.
ALTER TYPE time_log_source_enum ADD VALUE IF NOT EXISTS 'AUTO_CLOSE';

-- Novedad que documenta que una jornada quedo abierta y se cerro sola,
-- pendiente de revision por un supervisor.
ALTER TYPE novelty_code_enum ADD VALUE IF NOT EXISTS 'SALIDA_NO_REGISTRADA';

-- Novedad para casos ambiguos que el sistema no puede resolver solo (ej.
-- marcas inconsistentes) y deja pendientes de revision manual, sin
-- inventar una hora de salida.
ALTER TYPE novelty_code_enum ADD VALUE IF NOT EXISTS 'JORNADA_REQUIERE_REVISION';
