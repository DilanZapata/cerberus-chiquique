import { ActivityIndicator, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from './types';
import { useAuth } from '../context/AuthContext';
import { IS_MANAGERS } from '../config/variant';
import LoginScreen from '../screens/LoginScreen';
import KioskScreen from '../screens/KioskScreen';
import AdminDashboardScreen from '../screens/admin/AdminDashboardScreen';
import OvertimeApprovalScreen from '../screens/admin/OvertimeApprovalScreen';
import OvertimeAuthorizeScreen from '../screens/admin/OvertimeAuthorizeScreen';
import EmployeesListScreen from '../screens/admin/EmployeesListScreen';
import EmployeeFormScreen from '../screens/admin/EmployeeFormScreen';
import FaceEnrollScreen from '../screens/admin/FaceEnrollScreen';
import EmployeeHistoryScreen from '../screens/admin/EmployeeHistoryScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Las pantallas dependen de cual app es (ver src/config/variant.ts) y de si
 * hay sesion:
 *
 *  - Cerberus Staff: solo el kiosco de registro de asistencia (terminal
 *    compartida). No tiene inicio de sesion.
 *  - Cerberus Managers: sin sesion solo hay login (que rechaza a quien no
 *    administra); con sesion, el panel: asistencia del dia, horas extra,
 *    empleados y rostros.
 *
 * React Navigation reinicia solo al stack activo cuando cambia la lista de
 * pantallas.
 */
export default function RootNavigator() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (IS_MANAGERS) {
    return (
      <Stack.Navigator>
        {!session ? (
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} options={{ title: 'Cerberus Managers' }} />
            <Stack.Screen name="AdminOvertime" component={OvertimeApprovalScreen} options={{ title: 'Horas extra' }} />
            <Stack.Screen
              name="AdminOvertimeAuthorize"
              component={OvertimeAuthorizeScreen}
              options={{ title: 'Autorizar horas extra' }}
            />
            <Stack.Screen name="AdminEmployeesList" component={EmployeesListScreen} options={{ title: 'Empleados' }} />
            <Stack.Screen name="AdminEmployeeForm" component={EmployeeFormScreen} options={{ title: 'Empleado' }} />
            <Stack.Screen name="AdminFaceEnroll" component={FaceEnrollScreen} options={{ title: 'Enrolar rostro' }} />
            <Stack.Screen
              name="AdminEmployeeHistory"
              component={EmployeeHistoryScreen}
              options={({ route }) => ({ title: `Historial de ${route.params.employeeName}` })}
            />
          </>
        )}
      </Stack.Navigator>
    );
  }

  // Cerberus Staff es solo para registrar asistencia: una unica pantalla, sin
  // inicio de sesion (una sesion guardada por una version anterior se ignora).
  return (
    <Stack.Navigator>
      <Stack.Screen name="Kiosk" component={KioskScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}
