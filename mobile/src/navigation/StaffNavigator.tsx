import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { NavigatorScreenParams } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { COLORS, FONT_SIZES, RADIUS } from '../constants/theme';
import { StaffAssistantProvider } from '@/contexts/StaffAssistantContext';
import { useLanguage } from '@/contexts/LanguageContext';
import LiveGridScreen from '../screens/staff/LiveGridScreen';
import { CustomerManagementScreen } from '../screens/staff/CustomerManagementScreen';
import { ManagementHubScreen } from '../screens/staff/ManagementHubScreen';
import { StaffBookingManagementScreen } from '../screens/staff/StaffBookingManagementScreen';
import StaffDashboardScreen from '../screens/staff/StaffDashboardScreen';
import { StaffParkingOperationsScreen } from '@/screens/staff/StaffParkingOperationsScreen';
import { StaffCommunicationScreen } from '@/screens/staff/StaffCommunicationScreen';
import { StaffAssistantScreen } from '@/screens/staff/StaffAssistantScreen';
import { NotificationsScreen } from '@/screens/notifications/NotificationsScreen';
import { StaffNotificationManagementScreen } from '../screens/staff/StaffNotificationManagementScreen';
import StaffProfileScreen from '../screens/staff/StaffProfileScreen';
import { StaffSubscriptionManagementScreen } from '../screens/staff/StaffSubscriptionManagementScreen';
import { StaffTicketPackagesScreen } from '../screens/staff/StaffTicketPackagesScreen';
import { StaffBookingQrScreen } from '../screens/staff/StaffBookingQrScreen';
import { SessionDetailScreen } from '../screens/staff/SessionDetailScreen';
import { SessionListScreen } from '../screens/staff/SessionListScreen';
import { EditProfileScreen } from '../screens/profile/EditProfileScreen';
import { ChangePasswordScreen } from '../screens/profile/ChangePasswordScreen';
import type { StaffSessionStackParamList } from '../screens/staff/SessionListScreen';

const SessionStack = createNativeStackNavigator<StaffSessionStackParamList>();

export type StaffManagementStackParamList = {
  ManagementHome: undefined;
  Customers: undefined;
  Bookings: undefined;
  BookingScanner: undefined;
  Subscriptions: undefined;
  TicketPackages: undefined;
  StaffNotifications: undefined;
  Inbox: undefined;
  Communication: undefined;
  StaffAssistant: undefined;
  ParkingOperations: undefined;
};

export type StaffProfileStackParamList = {
  StaffProfileHome: undefined;
  EditProfile: undefined;
  ChangePassword: undefined;
};

const ManagementStack = createNativeStackNavigator<StaffManagementStackParamList>();
const ProfileStack = createNativeStackNavigator<StaffProfileStackParamList>();

function SessionStackNavigator() {
  return (
    <SessionStack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: COLORS.background } }}>
      <SessionStack.Screen name="SessionList" component={SessionListScreen} />
      <SessionStack.Screen name="SessionDetail" component={SessionDetailScreen} />
    </SessionStack.Navigator>
  );
}

function ManagementStackNavigator() {
  return (
    <ManagementStack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: COLORS.background } }}>
      <ManagementStack.Screen name="ManagementHome" component={ManagementHubScreen} />
      <ManagementStack.Screen name="Inbox" component={NotificationsScreen} />
      <ManagementStack.Screen name="Communication" component={StaffCommunicationScreen} />
      <ManagementStack.Screen name="StaffAssistant" component={StaffAssistantScreen} />
      <ManagementStack.Screen name="ParkingOperations" component={StaffParkingOperationsScreen} />
      <ManagementStack.Screen name="Customers" component={CustomerManagementScreen} />
      <ManagementStack.Screen name="Bookings" component={StaffBookingManagementScreen} />
      <ManagementStack.Screen name="BookingScanner" component={StaffBookingQrScreen} />
      <ManagementStack.Screen name="Subscriptions" component={StaffSubscriptionManagementScreen} />
      <ManagementStack.Screen name="TicketPackages" component={StaffTicketPackagesScreen} />
      <ManagementStack.Screen name="StaffNotifications" component={StaffNotificationManagementScreen} />
    </ManagementStack.Navigator>
  );
}

function ProfileStackNavigator() {
  return (
    <ProfileStack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: COLORS.background } }}>
      <ProfileStack.Screen name="StaffProfileHome" component={StaffProfileScreen} />
      <ProfileStack.Screen name="EditProfile" component={EditProfileScreen} />
      <ProfileStack.Screen name="ChangePassword" component={ChangePasswordScreen} />
    </ProfileStack.Navigator>
  );
}

export type StaffTabParamList = {
  Dashboard: undefined;
  LiveGrid: undefined;
  Sessions: undefined;
  Manage: NavigatorScreenParams<StaffManagementStackParamList>;
  StaffProfile: NavigatorScreenParams<StaffProfileStackParamList>;
};

const Tab = createBottomTabNavigator<StaffTabParamList>();
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

function tabIcon(focused: boolean, activeIcon: IoniconName, inactiveIcon: IoniconName, color: string) {
  return (
    <View style={[tabStyles.iconWrap, focused && tabStyles.iconWrapActive]}>
      <Ionicons name={focused ? activeIcon : inactiveIcon} size={22} color={color} />
    </View>
  );
}

export default function StaffNavigator() {
  const { t } = useLanguage();

  return (
    <StaffAssistantProvider>
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: tabStyles.bar,
        tabBarActiveTintColor: COLORS.gold,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarLabelStyle: tabStyles.label,
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={StaffDashboardScreen}
        options={{
          tabBarLabel: t('overview'),
          tabBarIcon: ({ focused, color }) => tabIcon(focused, 'grid', 'grid-outline', color),
        }}
      />
      <Tab.Screen
        name="LiveGrid"
        component={LiveGridScreen}
        options={{
          tabBarLabel: t('parking'),
          tabBarIcon: ({ focused, color }) => tabIcon(focused, 'map', 'map-outline', color),
        }}
      />
      <Tab.Screen
        name="Sessions"
        component={SessionStackNavigator}
        options={{
          tabBarLabel: t('sessions'),
          tabBarIcon: ({ focused, color }) => tabIcon(focused, 'car-sport', 'car-sport-outline', color),
        }}
      />
      <Tab.Screen
        name="Manage"
        component={ManagementStackNavigator}
        listeners={({ navigation }) => ({
          tabPress: () => {
            navigation.navigate('Manage', { screen: 'ManagementHome' });
          },
        })}
        options={{
          tabBarLabel: t('manage'),
          tabBarIcon: ({ focused, color }) => tabIcon(focused, 'briefcase', 'briefcase-outline', color),
        }}
      />
      <Tab.Screen
        name="StaffProfile"
        component={ProfileStackNavigator}
        options={{
          tabBarLabel: t('profile'),
          tabBarIcon: ({ focused, color }) => tabIcon(focused, 'person', 'person-outline', color),
        }}
      />
    </Tab.Navigator>
    </StaffAssistantProvider>
  );
}

const tabStyles = StyleSheet.create({
  bar: {
    backgroundColor: '#0F1013',
    borderTopColor: 'rgba(244,197,66,0.18)',
    borderTopWidth: 1,
    height: Platform.OS === 'ios' ? 90 : 76,
    paddingBottom: Platform.OS === 'ios' ? 25 : 12,
    paddingTop: 9,
  },
  label: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
    marginTop: 2,
  },
  iconWrap: {
    alignItems: 'center',
    borderRadius: RADIUS.round,
    height: 42,
    justifyContent: 'center',
    width: 48,
  },
  iconWrapActive: {
    backgroundColor: 'rgba(244,197,66,0.15)',
    borderColor: 'rgba(244,197,66,0.26)',
    borderWidth: 1,
  },
});
