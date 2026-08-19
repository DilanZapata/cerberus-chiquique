-- =====================================================================
-- Reconocimiento facial: enrolamiento con consentimiento explicito
-- (dato biometrico = dato sensible bajo la Ley 1581 de 2012, Colombia).
-- El descriptor (128 floats de face-api.js) y el procesamiento de fotos
-- viven enteramente en este backend; nunca se envian a un tercero.
-- =====================================================================

CREATE TABLE face_enrollments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  descriptor        JSONB NOT NULL,
  consent_given_at  TIMESTAMPTZ NOT NULL,
  consent_text      TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_face_enrollments_user ON face_enrollments(user_id);
