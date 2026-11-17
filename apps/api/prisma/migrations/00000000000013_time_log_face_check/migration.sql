-- =====================================================================
-- Verificacion de rostro en las marcas del kiosco.
--
-- Cuando alguien marca digitando su cedula/codigo/PIN, la foto de evidencia
-- se compara con el rostro enrolado de ESA persona. La marca se registra de
-- todas formas; aqui queda el resultado para revisarlo despues:
--   MATCH        -> el rostro de la foto coincide con el enrolado
--   MISMATCH     -> NO coincide (se avisa por correo a la empresa)
--   NOT_ENROLLED -> la persona no tiene rostro enrolado (no se puede comparar)
--   NULL         -> marca sin verificacion (manual, web, anterior a este cambio)
-- face_distance: que tan distintos son los dos rostros (0 = identicos;
-- por encima de 0.6 se considera otra persona).
-- =====================================================================
ALTER TABLE time_logs
  ADD COLUMN IF NOT EXISTS face_check VARCHAR(20),
  ADD COLUMN IF NOT EXISTS face_distance NUMERIC(5,3);
