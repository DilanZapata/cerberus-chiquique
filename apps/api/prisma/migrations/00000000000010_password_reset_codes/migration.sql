-- =====================================================================
-- Restablecer contrasena por codigo enviado al correo. El codigo se
-- guarda SOLO como hash bcrypt (igual que password_hash/pin_hash), nunca
-- en claro; expiracion corta + contador de intentos para que no se pueda
-- adivinar por fuerza bruta.
-- =====================================================================
CREATE TABLE password_reset_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  VARCHAR(255) NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_password_reset_codes_user ON password_reset_codes(user_id);
