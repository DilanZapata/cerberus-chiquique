import * as LocalAuthentication from 'expo-local-authentication';

/**
 * Face ID / huella dactilar del propio telefono (nunca identifica entre
 * varios empleados, solo confirma "el dueño de este telefono esta aqui") —
 * por eso solo tiene sentido en Modo Empleado (sesion personal), no en el
 * kiosco compartido, donde de todas formas nadie tiene el telefono
 * registrado a su nombre.
 */
export async function isBiometricAvailable(): Promise<boolean> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  if (!hasHardware) return false;
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();
  return isEnrolled;
}

export async function authenticateWithBiometrics(promptMessage: string): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage,
    cancelLabel: 'Cancelar',
    disableDeviceFallback: false,
  });
  return result.success;
}
