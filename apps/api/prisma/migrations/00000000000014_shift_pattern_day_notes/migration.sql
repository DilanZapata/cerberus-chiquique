-- =====================================================================
-- Puesto del dia en las rutinas (ej. rutina de ordeño por roles).
--
-- Cada dia de la plantilla de una persona puede llevar el puesto que le toca
-- ("Ordeñador (Ordeño 1)", "Vaquero (Vaqueria 2)", "... - media jornada").
-- Al generar los turnos concretos, ese texto se copia a shifts.notes, asi el
-- puesto se conserva cuando el sistema extiende los turnos cada semana.
-- NULL = plantilla sin puesto por dia (todas las anteriores a este cambio).
-- =====================================================================
ALTER TABLE shift_pattern_days
  ADD COLUMN IF NOT EXISTS notes TEXT;
