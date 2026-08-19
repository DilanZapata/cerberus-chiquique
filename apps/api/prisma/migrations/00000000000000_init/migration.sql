-- =====================================================================
-- Cerberus - Gestion de Personal, Asistencia y Nomina (Colombia)
-- Migracion inicial
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------

CREATE TYPE user_role_enum AS ENUM ('ADMIN', 'HR', 'SUPERVISOR', 'EMPLOYEE');

CREATE TYPE contract_type_enum AS ENUM (
  'INDEFINIDO', 'FIJO', 'OBRA_LABOR', 'APRENDIZAJE', 'PRESTACION_SERVICIOS'
);

CREATE TYPE time_log_type_enum AS ENUM (
  'CHECK_IN',    -- Marca 1: Entrada inicial
  'LUNCH_OUT',   -- Marca 2: Salida a almuerzo
  'LUNCH_IN',    -- Marca 3: Reingreso de almuerzo
  'CHECK_OUT'    -- Marca 4: Salida final
);

CREATE TYPE time_log_source_enum AS ENUM ('KIOSK', 'MOBILE_GPS', 'WEB', 'MANUAL');

CREATE TYPE shift_rotation_enum AS ENUM ('DIURNO', 'NOCTURNO', 'MIXTO', 'DESCANSO');

CREATE TYPE day_of_week_enum AS ENUM (
  'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'
);

CREATE TYPE holiday_type_enum AS ENUM ('FIJO', 'LEY_EMILIANI', 'VARIABLE');

-- Catalogo legal de conceptos CST (columnas del reporte de nomina)
CREATE TYPE novelty_code_enum AS ENUM (
  'RNO',                     -- Recargo Nocturno Ordinario
  'DDCOF',                   -- Dominical / Festivo Ordinario (diurno)
  'DNCOF',                   -- Dominical / Festivo Nocturno
  'HEOD',                    -- Hora Extra Ordinaria Diurna
  'HEON',                    -- Hora Extra Ordinaria Nocturna
  'HEFD',                    -- Hora Extra Festiva/Dominical Diurna
  'HEFN',                    -- Hora Extra Festiva/Dominical Nocturna
  'LLEGADA_TARDE',           -- Llegada tarde a jornada
  'LLEGADA_TARDE_ALMUERZO',  -- Llegada tarde de almuerzo
  'ABANDONO_ALMUERZO',       -- Inasistencia/abandono tras almuerzo (no marco reingreso)
  'SALIDA_ANTICIPADA',       -- Salida antes de la hora programada
  'AUSENCIA_INJUSTIFICADA',
  'PERMISO_REMUNERADO',
  'PERMISO_NO_REMUNERADO',
  'PERMISO_SALIDA_TEMPORAL',
  'INCAPACIDAD_GENERAL',
  'INCAPACIDAD_ARL',
  'VACACIONES',
  'HORA_EXTRA_PENDIENTE'      -- Hora extra detectada sin autorizacion previa
);

CREATE TYPE novelty_status_enum AS ENUM ('PENDIENTE', 'APROBADA', 'RECHAZADA', 'AUTO_CALCULADA');

CREATE TYPE novelty_origin_enum AS ENUM ('SISTEMA', 'MANUAL', 'IMPORTADO');

CREATE TYPE smtp_security_enum AS ENUM ('NONE', 'TLS', 'SSL');

-- ---------------------------------------------------------------------
-- COMPANIES / ESTRUCTURA ORGANIZACIONAL
-- ---------------------------------------------------------------------

CREATE TABLE companies (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nit               VARCHAR(20) NOT NULL UNIQUE,
  legal_name        VARCHAR(255) NOT NULL,
  trade_name        VARCHAR(255),
  timezone          VARCHAR(64) NOT NULL DEFAULT 'America/Bogota',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE departments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name              VARCHAR(150) NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

-- Sedes / centros de trabajo, usados por el kiosko y validacion GPS movil
CREATE TABLE work_sites (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name              VARCHAR(150) NOT NULL,
  address           VARCHAR(255),
  latitude          DECIMAL(9,6),
  longitude         DECIMAL(9,6),
  gps_radius_meters INTEGER NOT NULL DEFAULT 150,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- USERS
-- ---------------------------------------------------------------------

CREATE TABLE users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  department_id       UUID REFERENCES departments(id) ON DELETE SET NULL,
  work_site_id        UUID REFERENCES work_sites(id) ON DELETE SET NULL,
  employee_code       VARCHAR(30) NOT NULL,
  national_id         VARCHAR(30) NOT NULL, -- Cedula
  full_name           VARCHAR(255) NOT NULL,
  email               VARCHAR(255),
  password_hash       VARCHAR(255),
  role                user_role_enum NOT NULL DEFAULT 'EMPLOYEE',
  contract_type       contract_type_enum NOT NULL DEFAULT 'INDEFINIDO',
  hire_date           DATE NOT NULL,
  termination_date    DATE,
  base_salary         DECIMAL(14,2) NOT NULL DEFAULT 0,
  allows_lunch_skip   BOOLEAN NOT NULL DEFAULT false, -- habilita omision de almuerzo con adelanto de salida
  supervisor_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, employee_code),
  UNIQUE (company_id, national_id)
);

CREATE INDEX idx_users_company ON users(company_id);
CREATE INDEX idx_users_supervisor ON users(supervisor_id);

-- ---------------------------------------------------------------------
-- SCHEDULES (horarios base) Y SCHEDULE_DETAILS (por dia de semana)
-- ---------------------------------------------------------------------

CREATE TABLE schedules (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name                  VARCHAR(150) NOT NULL,
  weekly_hours_target   DECIMAL(5,2) NOT NULL DEFAULT 42.00, -- jornada legal vigente (Ley 2101/2021)
  default_lunch_minutes INTEGER NOT NULL DEFAULT 60,
  lunch_window_start    TIME NOT NULL DEFAULT '12:00',
  lunch_window_end      TIME NOT NULL DEFAULT '14:00',
  lunch_tolerance_minutes INTEGER NOT NULL DEFAULT 10, -- tolerancia antes de "llegada tarde de almuerzo"
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE schedule_details (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id       UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  day_of_week       day_of_week_enum NOT NULL,
  is_working_day    BOOLEAN NOT NULL DEFAULT true,
  start_time        TIME,
  end_time          TIME,
  lunch_minutes     INTEGER, -- override del default de schedules, si aplica
  UNIQUE (schedule_id, day_of_week)
);

-- Asignacion de horario a un empleado (vigencia)
CREATE TABLE user_schedules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  schedule_id       UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  valid_from        DATE NOT NULL,
  valid_to          DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_schedules_user ON user_schedules(user_id, valid_from, valid_to);

-- Turnos rotativos: override puntual de un dia especifico para un empleado
CREATE TABLE shifts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date         DATE NOT NULL,
  rotation_type     shift_rotation_enum NOT NULL DEFAULT 'DIURNO',
  planned_start     TIMESTAMPTZ NOT NULL,
  planned_end       TIMESTAMPTZ NOT NULL,
  planned_lunch_minutes INTEGER NOT NULL DEFAULT 60,
  is_rest_day       BOOLEAN NOT NULL DEFAULT false,
  notes             VARCHAR(500),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, work_date)
);

CREATE INDEX idx_shifts_user_date ON shifts(user_id, work_date);

-- ---------------------------------------------------------------------
-- HOLIDAYS (festivos Colombia - Ley Emiliani)
-- ---------------------------------------------------------------------

CREATE TABLE holidays (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code      VARCHAR(2) NOT NULL DEFAULT 'CO',
  holiday_date      DATE NOT NULL,
  name              VARCHAR(150) NOT NULL,
  holiday_type      holiday_type_enum NOT NULL DEFAULT 'FIJO',
  UNIQUE (country_code, holiday_date)
);

CREATE INDEX idx_holidays_date ON holidays(holiday_date);

-- ---------------------------------------------------------------------
-- TIME LOGS (marcas / fichajes)
-- ---------------------------------------------------------------------

CREATE TABLE time_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_site_id      UUID REFERENCES work_sites(id) ON DELETE SET NULL,
  log_type          time_log_type_enum NOT NULL,
  logged_at         TIMESTAMPTZ NOT NULL,
  source            time_log_source_enum NOT NULL DEFAULT 'MOBILE_GPS',
  latitude          DECIMAL(9,6),
  longitude          DECIMAL(9,6),
  gps_valid         BOOLEAN,
  device_id         VARCHAR(120),
  photo_url         VARCHAR(500),
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL, -- para marcas manuales creadas por HR
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Una marca por tipo/usuario/dia (evita duplicados de la misma marca)
CREATE UNIQUE INDEX uq_time_logs_user_day_type
  ON time_logs (user_id, log_type, ((logged_at AT TIME ZONE 'America/Bogota')::date));

CREATE INDEX idx_time_logs_user_logged_at ON time_logs(user_id, logged_at);

-- ---------------------------------------------------------------------
-- PAYROLL CONFIG (parametros legales configurables)
-- ---------------------------------------------------------------------

CREATE TABLE payroll_config (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  UUID NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  day_start_time              TIME NOT NULL DEFAULT '06:00',  -- inicio jornada diurna
  night_start_time             TIME NOT NULL DEFAULT '21:00',  -- inicio jornada nocturna (reforma laboral)
  max_weekly_hours            DECIMAL(5,2) NOT NULL DEFAULT 42.00,
  max_daily_ordinary_hours    DECIMAL(5,2) NOT NULL DEFAULT 8.00,
  -- Recargos (factor multiplicador sobre el valor hora ordinaria)
  pct_recargo_nocturno        DECIMAL(6,4) NOT NULL DEFAULT 0.35,  -- RNO
  pct_dominical_festivo       DECIMAL(6,4) NOT NULL DEFAULT 0.75,  -- DDCoF
  pct_dominical_festivo_nocturno DECIMAL(6,4) NOT NULL DEFAULT 1.10, -- DNCoF
  pct_hora_extra_diurna       DECIMAL(6,4) NOT NULL DEFAULT 0.25,  -- HEOD
  pct_hora_extra_nocturna     DECIMAL(6,4) NOT NULL DEFAULT 0.75,  -- HEON
  pct_hora_extra_festiva_diurna DECIMAL(6,4) NOT NULL DEFAULT 1.00, -- HEFD
  pct_hora_extra_festiva_nocturna DECIMAL(6,4) NOT NULL DEFAULT 1.50, -- HEFN
  overtime_requires_preauthorization BOOLEAN NOT NULL DEFAULT true,
  overtime_pending_alert_days  INTEGER NOT NULL DEFAULT 7,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- NOVELTIES (novedades de tiempo calculadas o manuales)
-- ---------------------------------------------------------------------

CREATE TABLE novelties (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date         DATE NOT NULL,
  code              novelty_code_enum NOT NULL,
  hours             DECIMAL(6,3) NOT NULL DEFAULT 0,
  status            novelty_status_enum NOT NULL DEFAULT 'AUTO_CALCULADA',
  origin            novelty_origin_enum NOT NULL DEFAULT 'SISTEMA',
  source_time_log_id UUID REFERENCES time_logs(id) ON DELETE SET NULL,
  notes             VARCHAR(500),
  reviewed_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_novelties_user_date ON novelties(user_id, work_date);
CREATE INDEX idx_novelties_status ON novelties(status);
CREATE INDEX idx_novelties_code ON novelties(code);

-- ---------------------------------------------------------------------
-- OVERTIME APPROVALS (flujo de aprobacion de horas extra)
-- ---------------------------------------------------------------------

CREATE TABLE overtime_approvals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  novelty_id        UUID NOT NULL REFERENCES novelties(id) ON DELETE CASCADE,
  requested_hours   DECIMAL(6,3) NOT NULL,
  approved_hours    DECIMAL(6,3),
  status            novelty_status_enum NOT NULL DEFAULT 'PENDIENTE',
  decided_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at        TIMESTAMPTZ,
  decision_notes    VARCHAR(500),
  alert_sent_at     TIMESTAMPTZ, -- ultima vez que se incluyo en la alerta semanal por correo
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_overtime_approvals_status ON overtime_approvals(status);

-- ---------------------------------------------------------------------
-- INCIDENCES (incapacidades, permisos)
-- ---------------------------------------------------------------------

CREATE TABLE incidences (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code              novelty_code_enum NOT NULL, -- INCAPACIDAD_GENERAL, INCAPACIDAD_ARL, PERMISO_*, VACACIONES
  start_date        DATE NOT NULL,
  end_date          DATE NOT NULL,
  hours_per_day     DECIMAL(5,2),
  supporting_doc_url VARCHAR(500),
  approved_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  status            novelty_status_enum NOT NULL DEFAULT 'PENDIENTE',
  notes             VARCHAR(500),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_incidences_user_range ON incidences(user_id, start_date, end_date);

-- ---------------------------------------------------------------------
-- EMAIL SETTINGS (SMTP configurable) Y LOGS DE NOTIFICACION
-- ---------------------------------------------------------------------

CREATE TABLE email_settings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  smtp_host         VARCHAR(255) NOT NULL,
  smtp_port         INTEGER NOT NULL DEFAULT 587,
  smtp_user         VARCHAR(255) NOT NULL,
  smtp_password_encrypted VARCHAR(500) NOT NULL,
  smtp_security     smtp_security_enum NOT NULL DEFAULT 'TLS',
  from_name         VARCHAR(150) NOT NULL DEFAULT 'Cerberus RRHH',
  from_email        VARCHAR(255) NOT NULL,
  admin_recipients  TEXT[] NOT NULL DEFAULT '{}',
  weekly_alert_enabled BOOLEAN NOT NULL DEFAULT true,
  weekly_alert_cron VARCHAR(50) NOT NULL DEFAULT '0 7 * * 1', -- lunes 7am
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notification_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  subject           VARCHAR(255) NOT NULL,
  recipients        TEXT[] NOT NULL,
  payload_summary   JSONB,
  status            VARCHAR(20) NOT NULL DEFAULT 'SENT',
  error_message      VARCHAR(500),
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- AUDIT LOG
-- ---------------------------------------------------------------------

CREATE TABLE audit_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID REFERENCES companies(id) ON DELETE CASCADE,
  user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  entity            VARCHAR(100) NOT NULL,
  entity_id         UUID,
  action            VARCHAR(50) NOT NULL,
  diff              JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_entity ON audit_log(entity, entity_id);

-- ---------------------------------------------------------------------
-- TRIGGERS: updated_at automatico
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_schedules_updated_at BEFORE UPDATE ON schedules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_payroll_config_updated_at BEFORE UPDATE ON payroll_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_novelties_updated_at BEFORE UPDATE ON novelties
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_email_settings_updated_at BEFORE UPDATE ON email_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
