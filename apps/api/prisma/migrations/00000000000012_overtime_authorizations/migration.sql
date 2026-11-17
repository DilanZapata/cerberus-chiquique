-- =====================================================================
-- Autorizacion de horas extra por persona y por dia.
--
-- Una fila = "a este empleado, este dia, se le autorizan N horas extra"
-- (antes o despues de trabajarlas). El calculo de nomina paga lo MENOR
-- entre lo autorizado y lo trabajado; lo que exceda queda pendiente (o
-- rechazado, si `excess_rejected`). La fila es la fuente de verdad de la
-- decision: sobrevive a cualquier recalculo del dia.
-- =====================================================================
CREATE TABLE IF NOT EXISTS overtime_authorizations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date             DATE NOT NULL,
  authorized_hours      NUMERIC(6,3) NOT NULL DEFAULT 0,
  excess_rejected       BOOLEAN NOT NULL DEFAULT false,
  authorized_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  notes                 VARCHAR(500),
  -- Ultimo excedente (horas trabajadas por encima de lo autorizado) del que
  -- ya se le aviso por correo a quien autorizo; evita avisos repetidos.
  excess_notified_hours NUMERIC(6,3) NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_overtime_authorizations_date ON overtime_authorizations(work_date);

-- Roles de la empresa que pueden autorizar horas extra (configurable).
ALTER TABLE payroll_settings
  ADD COLUMN IF NOT EXISTS overtime_approver_roles user_role_enum[] NOT NULL
  DEFAULT ARRAY['ADMIN','HR','SUPERVISOR']::user_role_enum[];

-- Decisiones ya tomadas con el esquema anterior (aprobar/rechazar una
-- solicitud) pasan a ser autorizaciones, para que no se pierdan en el
-- proximo recalculo de ese dia.
INSERT INTO overtime_authorizations (user_id, work_date, authorized_hours, excess_rejected, authorized_by, notes, created_at, updated_at)
SELECT n.user_id,
       n.work_date,
       CASE WHEN oa.status = 'APROBADA' THEN COALESCE(oa.approved_hours, oa.requested_hours) ELSE 0 END,
       oa.status = 'RECHAZADA',
       oa.decided_by,
       oa.decision_notes,
       COALESCE(oa.decided_at, now()),
       COALESCE(oa.decided_at, now())
FROM overtime_approvals oa
JOIN novelties n ON n.id = oa.novelty_id
WHERE oa.status IN ('APROBADA', 'RECHAZADA')
ON CONFLICT (user_id, work_date) DO NOTHING;
