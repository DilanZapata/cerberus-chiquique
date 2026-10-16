-- =====================================================================
-- Alerta de descanso semanal (Art. 160 CST). Nuevo valor de enum, debe ir
-- antes de cualquier uso. Correccion P2 (item 11) de la auditoria de
-- asistencia 2026-10-16: el motor no tenia ningun mecanismo que detectara
-- a un trabajador que acumula varios dias calendario consecutivos sin
-- ningun dia de descanso, pese a que el dato (marcas dia tras dia) ya
-- estaba disponible.
-- =====================================================================

ALTER TYPE novelty_code_enum ADD VALUE IF NOT EXISTS 'SIN_DESCANSO_SEMANAL';
