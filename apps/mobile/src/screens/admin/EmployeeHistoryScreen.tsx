import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import TimeLogHistoryList from '../../components/TimeLogHistoryList';

type Props = NativeStackScreenProps<RootStackParamList, 'AdminEmployeeHistory'>;

/** Panel admin: historial de marcas de un empleado especifico (el titulo de la pantalla ya muestra su nombre). */
export default function EmployeeHistoryScreen({ route }: Props) {
  return <TimeLogHistoryList userId={route.params.employeeId} />;
}
