import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { CreateBookingScreen } from '../screens/booking/CreateBookingScreen';
import { FindParkingScreen } from '../screens/booking/FindParkingScreen';
import { BookingListScreen } from '../screens/booking/BookingListScreen';
import { BookingDetailScreen } from '../screens/booking/BookingDetailScreen';
import { BookingCartScreen } from '../screens/booking/BookingCartScreen';
import { BookingAssistantScreen } from '@/screens/booking/BookingAssistantScreen';

export type BookingStackParamList = {
  BookingList: undefined;
  BookingCart: undefined;
  BookingAssistant: undefined;
  BookingDetail: { bookingId: string };
  CreateBooking:
    | {
        selectedFloorId?: string;
        selectedFloorName?: string;
        selectedSlotCode?: string;
        selectedServiceId?: string;
        selectedVoucherId?: string;
        initialStartTime?: string;
        initialEndTime?: string;
        initialLicensePlate?: string;
      }
    | undefined;
  FindParking: { floorId?: string; startTime?: string; endTime?: string };
};

const Stack = createNativeStackNavigator<BookingStackParamList>();

export const BookingStackNavigator = () => (
  <Stack.Navigator
    initialRouteName="BookingList"
    screenOptions={{
      headerShown: false,
      animation: 'slide_from_right',
      contentStyle: { backgroundColor: '#0D0D0D' },
    }}
  >
    <Stack.Screen name="BookingList" component={BookingListScreen} />
    <Stack.Screen name="BookingCart" component={BookingCartScreen} />
    <Stack.Screen name="BookingAssistant" component={BookingAssistantScreen} />
    <Stack.Screen name="BookingDetail" component={BookingDetailScreen} />
    <Stack.Screen name="CreateBooking" component={CreateBookingScreen} />
    <Stack.Screen name="FindParking" component={FindParkingScreen} />
  </Stack.Navigator>
);
