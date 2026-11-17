/**
 * Cual de las dos apps es esta compilacion (ver app.config.js y eas.json).
 * Expo reemplaza EXPO_PUBLIC_* al empaquetar, asi que el valor queda fijo
 * dentro de cada APK.
 */
export type AppVariant = 'staff' | 'managers';

export const APP_VARIANT: AppVariant = process.env.EXPO_PUBLIC_APP_VARIANT === 'managers' ? 'managers' : 'staff';
export const IS_MANAGERS = APP_VARIANT === 'managers';
export const APP_NAME = IS_MANAGERS ? 'Cerberus Managers' : 'Cerberus Staff';
