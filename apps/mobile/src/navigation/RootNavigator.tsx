import { ActivityIndicator, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from './types';
import { useAuth } from '../context/AuthContext';
import { isAdminRole } from '../services/auth';
import SelectModeScreen from '../screens/SelectModeScreen';
import LoginScreen from '../screens/LoginScreen';
import KioskScreen from '../screens/KioskScreen';
import EmployeeScreen from '../screens/EmployeeScreen';
import MyHistoryScreen from '../screens/MyHistoryScreen';
import AdminDashboardScreen from '../screens/admin/AdminDashboardScreen';
import EmployeesListScreen from '../screens/admin/EmployeesListScreen';
import EmployeeFormScreen from '../screens/admin/EmployeeFormScreen';
import FaceEnrollScreen from '../screens/admin/FaceEnrollScreen';
import EmployeeHistoryScreen from '../screens/admin/EmployeeHistoryScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * El stack de pantallas cambia segun el estado de sesion: sin sesion se
 * puede usar el kiosco (terminal compartida, sin login personal) o iniciar
 * sesion; con sesion, el rol decide si se entra al panel admin o al marcaje
 * personal de empleado. React Navigation reinicia solo al stack activo
 * cuando cambia la lista de pantallas.
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

  return (
    <Stack.Navigator>
      {!session ? (
        <>
          <Stack.Screen name="SelectMode" component={SelectModeScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Login" component={LoginScreen} options={{ title: 'Iniciar sesion' }} />
          <Stack.Screen name="Kiosk" component={KioskScreen} options={{ headerShown: false }} />
        </>
      ) : isAdminRole(session.user.role) ? (
        <>
          <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} options={{ title: 'Dashboard' }} />
          <Stack.Screen name="AdminEmployeesList" component={EmployeesListScreen} options={{ title: 'Empleados' }} />
          <Stack.Screen name="AdminEmployeeForm" component={EmployeeFormScreen} options={{ title: 'Empleado' }} />
          <Stack.Screen name="AdminFaceEnroll" component={FaceEnrollScreen} options={{ title: 'Enrolar rostro' }} />
          <Stack.Screen
            name="AdminEmployeeHistory"
            component={EmployeeHistoryScreen}
            options={({ route }) => ({ title: `Historial de ${route.params.employeeName}` })}
          />
        </>
      ) : (
        <>
          <Stack.Screen name="EmployeeClock" component={EmployeeScreen} options={{ title: 'Marcar asistencia', headerShown: false }} />
          <Stack.Screen name="MyHistory" component={MyHistoryScreen} options={{ title: 'Mi historial' }} />
        </>
      )}
    </Stack.Navigator>
  );
}
