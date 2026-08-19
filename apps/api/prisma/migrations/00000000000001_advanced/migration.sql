-- =====================================================================
-- Cerberus - Turnos rotativos, permisos/incapacidades, auth, nomina
-- versionada por vigencia legal, kiosco por PIN, SMTP/notificaciones.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Nuevos valores de NoveltyCode (deben ir antes de cualquier uso)
-- ---------------------------------------------------------------------
ALTER TYPE novelty_code_enum ADD VALUE IF NOT EXISTS 'DESCANSO_COMPENSATORIO_PENDIENTE';
ALTER TYPE novelty_code_enum ADD VALUE IF NOT EXISTS 'LIMITE_HORAS_EXTRA_EXCEDIDO';

-- ---------------------------------------------------------------------
-- Auth / Kiosco
-- ---------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_hash VARCHAR(255);
ALTER TABLE work_sites ADD COLUMN IF NOT EXISTS kiosk_token VARCHAR(100) UNIQUE;

-- ---------------------------------------------------------------------
-- Nomina versionada por vigencia legal (Ley 2466 de 2025 y sucesoras)
-- ---------------------------------------------------------------------

-- Ajustes operativos (no legales) de la empresa, 1:1.
CREATE TABLE payroll_settings (
  id                                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                          UUID NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  overtime_requires_preauthorization  BOOLEAN NOT NULL DEFAULT true,
  overtime_pending_alert_days         INTEGER NOT NULL DEFAULT 7,
  created_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                          TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO payroll_settings (company_id, overtime_requires_preauthorization, overtime_pending_alert_days)
SELECT company_id, overtime_requires_preauthorization, overtime_pending_alert_days FROM payroll_config;

-- Parametros legales con vigencia por fecha: la version efectiva de una fecha X
-- es la de mayor effective_from que sea <= X.
CREATE TABLE payroll_config_versions (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  effective_from                  DATE NOT NULL,
  day_start_time                  TIME NOT NULL DEFAULT '06:00',
  night_start_time                TIME NOT NULL DEFAULT '19:00',
  max_weekly_hours                DECIMAL(5,2) NOT NULL DEFAULT 42.00,
  max_daily_ordinary_hours        DECIMAL(5,2) NOT NULL DEFAULT 8.00,
  max_daily_overtime_hours        DECIMAL(5,2) NOT NULL DEFAULT 2.00,
  max_weekly_overtime_hours       DECIMAL(5,2) NOT NULL DEFAULT 12.00,
  dominical_ocasional_max_per_month INTEGER NOT NULL DEFAULT 2,
  pct_recargo_nocturno            DECIMAL(6,4) NOT NULL DEFAULT 0.35,
  pct_dominical_festivo           DECIMAL(6,4) NOT NULL DEFAULT 0.90,
  pct_dominical_festivo_nocturno  DECIMAL(6,4) NOT NULL DEFAULT 1.25,
  pct_hora_extra_diurna           DECIMAL(6,4) NOT NULL DEFAULT 0.25,
  pct_hora_extra_nocturna         DECIMAL(6,4) NOT NULL DEFAULT 0.75,
  pct_hora_extra_festiva_diurna   DECIMAL(6,4) NOT NULL DEFAULT 1.15,
  pct_hora_extra_festiva_nocturna DECIMAL(6,4) NOT NULL DEFAULT 1.65,
  notes                           VARCHAR(500),
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, effective_from)
);

CREATE INDEX idx_payroll_config_versions_company_date ON payroll_config_versions(company_id, effective_from);

DROP TABLE payroll_config;

-- ---------------------------------------------------------------------
-- Descanso compensatorio (Art. 179/180 CST: domingo/festivo habitual)
-- ---------------------------------------------------------------------
CREATE TABLE compensatory_rest_credits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  earned_for_date DATE NOT NULL,
  status          novelty_status_enum NOT NULL DEFAULT 'PENDIENTE',
  taken_date      DATE,
  notes           VARCHAR(500),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, earned_for_date)
);

CREATE INDEX idx_compensatory_rest_user_status ON compensatory_rest_credits(user_id, status);

-- ---------------------------------------------------------------------
-- Rutinas de turnos rotativos (plantillas ciclicas)
-- ---------------------------------------------------------------------
CREATE TABLE shift_patterns (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name              VARCHAR(150) NOT NULL,
  cycle_length_days INTEGER NOT NULL CHECK (cycle_length_days > 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE shift_pattern_days (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_id    UUID NOT NULL REFERENCES shift_patterns(id) ON DELETE CASCADE,
  day_offset    INTEGER NOT NULL CHECK (day_offset >= 0),
  is_rest_day   BOOLEAN NOT NULL DEFAULT false,
  rotation_type shift_rotation_enum NOT NULL DEFAULT 'DIURNO',
  start_time    TIME,
  end_time      TIME,
  lunch_minutes INTEGER NOT NULL DEFAULT 60,
  UNIQUE (pattern_id, day_offset)
);

CREATE TABLE user_shift_pattern_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pattern_id  UUID NOT NULL REFERENCES shift_patterns(id) ON DELETE CASCADE,
  anchor_date DATE NOT NULL,
  valid_from  DATE NOT NULL,
  valid_to    DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_shift_pattern_assignments_user ON user_shift_pattern_assignments(user_id, valid_from, valid_to);

-- ---------------------------------------------------------------------
-- Totales diarios de asistencia (para el reporte de nomina: total de horas
-- trabajadas incluye horas ordinarias sin recargo, que no se guardan como
-- novedad individual porque no llevan un factor de pago distinto).
-- ---------------------------------------------------------------------
CREATE TABLE attendance_daily_totals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date             DATE NOT NULL,
  total_ordinary_hours  DECIMAL(6,3) NOT NULL DEFAULT 0,
  total_overtime_hours  DECIMAL(6,3) NOT NULL DEFAULT 0,
  total_worked_hours    DECIMAL(6,3) NOT NULL DEFAULT 0,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, work_date)
);

CREATE INDEX idx_attendance_daily_totals_user_date ON attendance_daily_totals(user_id, work_date);

-- ---------------------------------------------------------------------
-- Triggers de updated_at para las tablas nuevas que lo requieren
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_payroll_settings_updated_at BEFORE UPDATE ON payroll_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
