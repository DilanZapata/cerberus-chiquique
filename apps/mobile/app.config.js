/**
 * Una sola base de codigo, dos apps instalables:
 *
 *  - Cerberus Staff    (EXPO_PUBLIC_APP_VARIANT=staff, por defecto): el kiosco de
 *    marcacion tal cual + el marcaje personal del empleado. Conserva el paquete
 *    original, asi que se instala como actualizacion de la app que ya esta en
 *    los telefonos/tabletas.
 *  - Cerberus Managers (EXPO_PUBLIC_APP_VARIANT=managers): solo para
 *    administradores, RRHH y supervisores (horas extra, empleados, rostros).
 *    Paquete distinto, asi que convive con Staff en el mismo telefono.
 *
 * La variante se elige al compilar (perfiles de eas.json). El codigo la lee
 * en src/config/variant.ts.
 */
module.exports = ({ config }) => {
  const isManagers = process.env.EXPO_PUBLIC_APP_VARIANT === 'managers';
  return {
    ...config,
    name: isManagers ? 'Cerberus Managers' : 'Cerberus Staff',
    android: {
      ...config.android,
      package: isManagers ? 'com.chiquique.cerberus.managers' : 'com.chiquique.cerberus',
    },
    ios: {
      ...config.ios,
      bundleIdentifier: isManagers ? 'com.chiquique.cerberus.managers' : 'com.chiquique.cerberus',
    },
    // Dictado por voz del asistente: solo Managers pide permiso de microfono.
    plugins: [
      ...(config.plugins ?? []),
      ...(isManagers
        ? [
            [
              'expo-speech-recognition',
              {
                microphonePermission: 'Cerberus usa el microfono para que puedas dictarle al asistente.',
                speechRecognitionPermission: 'Cerberus convierte tu voz en texto para el asistente.',
                androidSpeechServicePackages: ['com.google.android.googlequicksearchbox'],
              },
            ],
          ]
        : []),
    ],
  };
};
