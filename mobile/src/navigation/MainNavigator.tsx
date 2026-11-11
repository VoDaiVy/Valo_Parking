import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAuth } from '@/hooks/useAuth';
import CustomerNavigator from './CustomerNavigator';
import StaffNavigator from './StaffNavigator';

const Stack = createNativeStackNavigator();

export const MainNavigator = () => {
  const { user } = useAuth();
  const isStaff = user?.role === 'staff';

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {isStaff ? (
        <Stack.Screen name="StaffRoot" component={StaffNavigator} />
      ) : (
        <Stack.Screen name="CustomerRoot" component={CustomerNavigator} />
      )}
    </Stack.Navigator>
  );
};
