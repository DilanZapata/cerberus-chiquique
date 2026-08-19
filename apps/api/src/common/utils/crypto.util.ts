import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function deriveKey(secret: string): Buffer {
  return scryptSync(secret, 'cerberus-email-settings', 32);
}

/** Cifra un texto plano (ej. contrasena SMTP) usando AES-256-GCM. No es un hash: se necesita el valor real para autenticar contra el servidor SMTP. */
export function encryptSecret(plainText: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join(':');
}

export function decryptSecret(payload: string, secret: string): string {
  const [ivB64, authTagB64, dataB64] = payload.split(':');
  const key = deriveKey(secret);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
}
