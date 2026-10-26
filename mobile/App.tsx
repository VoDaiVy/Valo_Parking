import { StatusBar } from 'expo-status-bar';
import 'react-native-gesture-handler';
import Toast from 'react-native-toast-message';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorBoundary } from './src/components/common';
import { NotificationHandler } from './src/components/notifications/NotificationHandler';
import { AuthProvider } from './src/contexts/AuthContext';
import { BookingCartProvider } from './src/contexts/BookingCartContext';
import { AppAlertProvider } from './src/contexts/AppAlertContext';
import { BookingProvider } from './src/contexts/BookingContext';
import { SocketProvider } from './src/contexts/SocketContext';
import { AppNavigator } from './src/navigation/AppNavigator';
import { validateConfig } from './src/config/env';

const configErrors = validateConfig();

export default function App() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <AppAlertProvider>
          <AuthProvider>
            <SocketProvider>
              <BookingProvider>
                <BookingCartProvider>
                <NotificationHandler />
                <AppNavigator />
                </BookingCartProvider>
              </BookingProvider>
            </SocketProvider>
          </AuthProvider>
        </AppAlertProvider>
      </ErrorBoundary>
      <StatusBar style="auto" />
      <Toast />
    </SafeAreaProvider>
  );
}

if (configErrors.length > 0 && __DEV__) {
  console.warn('[Config] Missing or invalid values:', configErrors.join(', '));
}
