import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { NavigatorScreenParams } from '@react-navigation/native';
import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { COLORS, FONT_SIZES, RADIUS } from '../constants/theme';
import { BookingStackNavigator, type BookingStackParamList } from './BookingStackNavigator';
import { NotificationsStackNavigator } from './NotificationsStackNavigator';
import { ProfileStackNavigator } from './ProfileStackNavigator';
import { WalletStackNavigator } from './WalletStackNavigator';
import type { NotificationStackParamList, ProfileStackParamList, WalletStackParamList } from './types';
import HomeScreen from '../screens/customer/HomeScreen';
import { useLanguage } from '@/contexts/LanguageContext';

export type CustomerTabParamList = {
  Home: undefined;
  Bookings: NavigatorScreenParams<BookingStackParamList> | undefined;
  WalletTab: NavigatorScreenParams<WalletStackParamList> | undefined;
  NotificationsTab: NavigatorScreenParams<NotificationStackParamList> | undefined;
  ProfileTab: NavigatorScreenParams<ProfileStackParamList> | undefined;
};

const Tab = createBottomTabNavigator<CustomerTabParamList>();
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

function tabIcon(focused: boolean, activeIcon: IoniconName, inactiveIcon: IoniconName, color: string) {
  return (
    <View style={[tabStyles.iconWrap, focused && tabStyles.iconWrapActive]}>
      <Ionicons name={focused ? activeIcon : inactiveIcon} size={22} color={color} />
    </View>
  );
}

export default function CustomerNavigator() {
  const { t } = useLanguage();
  return (
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
        name="Home"
        component={HomeScreen}
        options={{
          tabBarLabel: t('home'),
          tabBarIcon: ({ focused, color }) => tabIcon(focused, 'home', 'home-outline', color),
        }}
      />
      <Tab.Screen
        name="Bookings"
        component={BookingStackNavigator}
        options={{
          tabBarLabel: t('bookings'),
          tabBarIcon: ({ focused, color }) => tabIcon(focused, 'calendar', 'calendar-outline', color),
        }}
      />
      <Tab.Screen
        name="WalletTab"
        component={WalletStackNavigator}
        options={{
          tabBarLabel: t('wallet'),
          tabBarIcon: ({ focused, color }) => tabIcon(focused, 'wallet', 'wallet-outline', color),
        }}
      />
      <Tab.Screen
        name="NotificationsTab"
        component={NotificationsStackNavigator}
        options={{
          tabBarLabel: t('alerts'),
          tabBarBadge: undefined,
          tabBarIcon: ({ focused, color }) => tabIcon(focused, 'notifications', 'notifications-outline', color),
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileStackNavigator}
        options={{
          tabBarLabel: t('account'),
          tabBarIcon: ({ focused, color }) => tabIcon(focused, 'person', 'person-outline', color),
        }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            navigation.navigate('ProfileTab', { screen: 'Profile' });
          },
        })}
      />
    </Tab.Navigator>
  );
}

const tabStyles = StyleSheet.create({
  bar: {
    backgroundColor: COLORS.surface,
    borderTopColor: 'rgba(226,186,75,0.16)',
    borderTopWidth: 1,
    height: Platform.OS === 'ios' ? 88 : 72,
    paddingBottom: Platform.OS === 'ios' ? 24 : 10,
    paddingTop: 10,
  },
  label: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
    marginTop: 2,
  },
  iconWrap: {
    alignItems: 'center',
    borderRadius: RADIUS.md,
    height: 40,
    justifyContent: 'center',
    width: 44,
  },
  iconWrapActive: {
    backgroundColor: 'rgba(226,186,75,0.14)',
  },
});
