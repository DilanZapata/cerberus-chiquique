-- =====================================================================
-- Fase 4 del rediseno de control de asistencia: ventanas de marcacion
-- configurables por horario, en vez de constantes fijas en el codigo.
-- Columnas aditivas con default = mismo valor que la constante que
-- reemplazan, para no cambiar el comportamiento de ningun horario
-- existente hasta que un admin decida ajustarlo.
-- =====================================================================

-- Desde cuantos minutos antes de la hora de salida programada, una marca
-- SIEMPRE se interpreta como salida final (aunque falten marcas de
-- almuerzo). Reemplaza FINAL_EXIT_WINDOW_BEFORE_MIN en shift-marks.util.ts.
ALTER TABLE "schedules" ADD COLUMN "final_exit_window_before_min" INTEGER NOT NULL DEFAULT 30;

-- Margen tras la hora de salida programada durante el cual: (a) una marca
-- del dia calendario siguiente todavia puede completar un turno nocturno
-- de "ayer" que cruza medianoche, y (b) el cierre automatico
-- (jornada-cierre.service.ts) considera una jornada abierta como vencida y
-- candidata a cierre. Un solo campo para ambos usos: los dos representan
-- "cuanto dura la jornada como valida despues de su fin programado".
ALTER TABLE "schedules" ADD COLUMN "final_exit_grace_min" INTEGER NOT NULL DEFAULT 180;
