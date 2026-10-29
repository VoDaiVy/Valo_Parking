import { createNativeStackNavigator } from '@react-navigation/native-stack';

import ProfileScreen               from '../screens/customer/ProfileScreen';
import { PersonalProfileScreen }   from '../screens/profile/PersonalProfileScreen';
import { EditProfileScreen }       from '../screens/profile/EditProfileScreen';
import { ChangePasswordScreen }    from '../screens/profile/ChangePasswordScreen';
import { VehicleListScreen }       from '../screens/profile/VehicleListScreen';
import { AddVehicleScreen }        from '../screens/profile/AddVehicleScreen';
import { EditVehicleScreen }       from '../screens/profile/EditVehicleScreen';
import { ServiceListScreen }       from '../screens/profile/ServiceListScreen';
import { PoliciesListScreen }      from '../screens/profile/PoliciesListScreen';
import { PolicyDetailScreen }      from '../screens/profile/PolicyDetailScreen';
import { ParkingHistoryScreen }    from '../screens/customer/ParkingHistoryScreen';
import { BookingListScreen }       from '../screens/booking/BookingListScreen';
import { BookingDetailScreen }     from '../screens/booking/BookingDetailScreen';
import type { ProfileStackParamList } from './types';
import { TelegramSettingsScreen } from '../screens/profile/TelegramSettingsScreen';

const Stack = createNativeStackNavigator<ProfileStackParamList>();

export const ProfileStackNavigator = () => (
  <Stack.Navigator
    screenOptions={{
      headerShown: false,
      animation: 'slide_from_right',
      contentStyle: { backgroundColor: '#0D0D0D' },
    }}
  >
    <Stack.Screen name="Profile"         component={ProfileScreen} />
    <Stack.Screen name="TelegramSettings" component={TelegramSettingsScreen} />
    <Stack.Screen name="PersonalProfile" component={PersonalProfileScreen} />
    <Stack.Screen name="EditProfile"     component={EditProfileScreen} />
    <Stack.Screen name="ChangePassword"  component={ChangePasswordScreen} />
    <Stack.Screen name="VehicleList"     component={VehicleListScreen} />
    <Stack.Screen name="AddVehicle"      component={AddVehicleScreen} />
    <Stack.Screen name="EditVehicle"     component={EditVehicleScreen} />
    <Stack.Screen name="Services"        component={ServiceListScreen} />
    <Stack.Screen name="Policies"        component={PoliciesListScreen} />
    <Stack.Screen name="PolicyDetail"    component={PolicyDetailScreen} />
    <Stack.Screen name="ParkingHistory"  component={ParkingHistoryScreen} />
    <Stack.Screen name="BookingList"     component={BookingListScreen} />
    <Stack.Screen name="BookingDetail"   component={BookingDetailScreen} />
  </Stack.Navigator>
);
