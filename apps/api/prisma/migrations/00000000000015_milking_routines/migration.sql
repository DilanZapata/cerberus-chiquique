-- =====================================================================
-- Rutinas de ordeño guardadas.
--
-- Una rutina de ordeño por roles deja de ser "se crea y empieza a regir de
-- una vez": ahora se GUARDA (con las personas, su puesto y su dia de media
-- jornada) y despues se HABILITA desde una fecha. Solo al habilitarla pasa a
-- ser el horario de sus trabajadores.
--   GUARDADA  -> armada pero nunca ha regido
--   VIGENTE   -> es el horario actual de sus trabajadores (desde anchor_date)
--   INACTIVA  -> rigio hasta valid_to y fue reemplazada por otra
-- config: { workers: [{ userId, role, homeStation, shortDayOffset }],
--           morningStart, morningEnd, eveningStart, eveningEnd }
-- =====================================================================
CREATE TABLE IF NOT EXISTS milking_routines (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name           VARCHAR(200) NOT NULL,
  stations_count INT NOT NULL,
  config         JSONB NOT NULL,
  status         VARCHAR(20) NOT NULL DEFAULT 'GUARDADA',
  anchor_date    DATE,
  valid_to       DATE,
  schedule_id    UUID REFERENCES schedules(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_milking_routines_company ON milking_routines(company_id, status);

-- Plantillas que pertenecen a una rutina guardada (una por trabajador y por
-- cada vez que la rutina se habilita). NULL = plantilla de otro tipo.
ALTER TABLE shift_patterns
  ADD COLUMN IF NOT EXISTS milking_routine_id UUID REFERENCES milking_routines(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_shift_patterns_milking_routine ON shift_patterns(milking_routine_id);
