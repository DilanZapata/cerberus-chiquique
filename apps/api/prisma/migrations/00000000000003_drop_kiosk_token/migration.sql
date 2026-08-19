-- =====================================================================
-- El kiosco deja de autenticarse con un token estatico por sede; en su
-- lugar identifica la sede (y por lo tanto la empresa) por proximidad GPS
-- del propio dispositivo, igual que el marcaje GPS de autoservicio movil.
-- =====================================================================

ALTER TABLE work_sites DROP COLUMN kiosk_token;
