-- =====================================================================
-- Cargo: agrupa empleados con el mismo puesto y les asocia un horario
-- comun (schedules). Asignar el cargo a un empleado es lo que fija su
-- horario de entrada/salida, en vez de asignarlo uno por uno.
-- =====================================================================

CREATE TABLE positions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        VARCHAR(150) NOT NULL,
  schedule_id UUID REFERENCES schedules(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

ALTER TABLE users ADD COLUMN position_id UUID REFERENCES positions(id);
