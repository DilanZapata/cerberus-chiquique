export type RootStackParamList = {
  Login: undefined;
  Kiosk: undefined;
  EmployeeClock: undefined;
  MyHistory: undefined;
  AdminDashboard: undefined;
  AdminEmployeesList: undefined;
  AdminEmployeeForm: { employeeId?: string } | undefined;
  AdminFaceEnroll: { employeeId: string; employeeName: string };
  AdminEmployeeHistory: { employeeId: string; employeeName: string };
};
