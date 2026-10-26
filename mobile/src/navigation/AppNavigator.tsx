import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  LinkingOptions,
  NavigationContainer,
  NavigationState,
  PartialState,
} from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { Linking } from 'react-native';

import { LoadingSpinner } from '@/components/common';
import { useAppLifecycle } from '@/hooks/useAppLifecycle';
import { useAuth } from '@/hooks/useAuth';
import { NAVIGATION_STATE_KEY } from '@/utils/constants';

import { AuthNavigator } from './AuthNavigator';
import CustomerNavigator from './CustomerNavigator';
import StaffNavigator from './StaffNavigator';
import type { StaffTabParamList } from './StaffNavigator';
import type { CustomerTabParamList } from './CustomerNavigator';
import type { AuthStackParamList } from './types';
import { navigationRef } from './notificationNavigation';

type AppRoutes = AuthStackParamList & CustomerTabParamList & StaffTabParamList;
const customerLinking: LinkingOptions<AppRoutes> = {
  prefixes: ['valo://'],
  config: {
    screens: {
      Login: 'login',
      Register: 'register',
      ForgotPassword: 'forgot-password',
      Home: 'home',
      Bookings: { path: 'bookings', screens: { BookingList: '', BookingDetail: ':bookingId', FindParking: 'map', CreateBooking: 'new', BookingCart: 'cart', BookingAssistant: 'assistant' } },
      WalletTab: { path: 'wallet', screens: { Wallet: '', TopUp: 'top-up', Rewards: 'rewards', Membership: 'membership', MembershipMarketplace: 'marketplace', MembershipMarketplaceDetail: 'marketplace/:transferId' } },
      NotificationsTab: { path: 'notifications', screens: { Notifications: '' } },
      ProfileTab: { path: 'profile', screens: { Profile: '', VehicleList: 'vehicles', Policies: 'policies', PolicyDetail: 'policies/:slug' } },
    },
  },
};

const AppLifecycleBridge = () => {
  useAppLifecycle();
  return null;
};

export const AppNavigator = () => {
  const { isAuthenticated, isLoading, user } = useAuth();
  const isStaff = user?.role === 'staff' || user?.role === 'admin';
  const navigationKey = `${NAVIGATION_STATE_KEY}.v2.${user?.id || user?._id || 'guest'}.${user?.role || 'guest'}`;
  const [initialState, setInitialState] = useState<PartialState<NavigationState<AppRoutes>>>();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let active = true;
    setIsReady(false); setInitialState(undefined);
    const restoreState = async () => {
      try {
        const [savedState, initialUrl] = await Promise.all([AsyncStorage.getItem(navigationKey), Linking.getInitialURL()]);
        if (active && savedState && !initialUrl) {
          setInitialState(JSON.parse(savedState) as PartialState<NavigationState<AppRoutes>>);
        }
      } catch {
        if (active) setInitialState(undefined);
      } finally {
        if (active) setIsReady(true);
      }
    };

    void restoreState();
    return () => { active = false; };
  }, [navigationKey]);

  if (isLoading || !isReady) {
    return <LoadingSpinner />;
  }

  return (
    <NavigationContainer
      ref={navigationRef}
      key={navigationKey}
      initialState={initialState}
      linking={isStaff ? { prefixes: ['valo://'], config: { screens: {
        Dashboard: 'staff', LiveGrid: 'staff/parking', Sessions: 'staff/sessions',
        Manage: { path: 'staff/manage', screens: { ManagementHome: '', Bookings: 'bookings', BookingScanner: 'scan', Inbox: 'inbox', ParkingOperations: 'operations', StaffAssistant: 'assistant' } },
      } } } : customerLinking}
      onStateChange={(state) => {
        if (state) {
          void AsyncStorage.setItem(navigationKey, JSON.stringify(state)).catch(() => undefined);
        }
      }}
    >
      <AppLifecycleBridge />
      {!isAuthenticated ? (
        <AuthNavigator />
      ) : user?.role === 'staff' || user?.role === 'admin' ? (
        <StaffNavigator />
      ) : (
        <CustomerNavigator />
      )}
    </NavigationContainer>
  );
};
