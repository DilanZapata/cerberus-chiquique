import TimeLogHistoryList from '../components/TimeLogHistoryList';

/** Modo Empleado: historial propio de marcas (sin pasar userId, el backend infiere que es el usuario autenticado). */
export default function MyHistoryScreen() {
  return <TimeLogHistoryList />;
}
