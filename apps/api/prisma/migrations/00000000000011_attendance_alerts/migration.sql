-- =====================================================================
-- Alertas de asistencia por correo (llegada tarde al instante + resumen
-- diario de llegadas tarde, salidas anticipadas, ausencias y jornadas sin
-- salida). Interruptor propio, separado del de novedades pendientes
-- (weekly_alert_enabled), para poder apagar uno sin el otro.
-- =====================================================================
ALTER TABLE email_settings
  ADD COLUMN IF NOT EXISTS attendance_alerts_enabled BOOLEAN NOT NULL DEFAULT true;
