/** Decodifica un data URL o un string base64 crudo a un Buffer de imagen. */
export function decodeBase64Image(imageBase64: string): Buffer {
  const commaIndex = imageBase64.indexOf(',');
  const raw = imageBase64.startsWith('data:') && commaIndex !== -1 ? imageBase64.slice(commaIndex + 1) : imageBase64;
  return Buffer.from(raw, 'base64');
}
