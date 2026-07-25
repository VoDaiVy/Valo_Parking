import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { WalletScreen }                  from '../screens/wallet/WalletScreen';
import { TopUpScreen }                   from '../screens/wallet/TopUpScreen';
import { TransactionHistoryScreen }      from '../screens/wallet/TransactionHistoryScreen';
import { MembershipScreen }              from '../screens/wallet/MembershipScreen';
import { SubscriptionPackagesScreen }    from '../screens/wallet/SubscriptionPackagesScreen';
import { SubscriptionCheckoutScreen }    from '../screens/wallet/SubscriptionCheckoutScreen';
import { SubscriptionPaymentStatusScreen } from '../screens/wallet/SubscriptionPaymentStatusScreen';
import { MembershipTransferMarketplaceScreen } from '../screens/wallet/MembershipTransferMarketplaceScreen';
import { MembershipTransferMarketplaceDetailScreen } from '../screens/wallet/MembershipTransferMarketplaceDetailScreen';
import type { WalletStackParamList }     from './types';

const Stack = createNativeStackNavigator<WalletStackParamList>();

export const WalletStackNavigator = () => (
  <Stack.Navigator
    screenOptions={{
      headerShown: false,
      animation: 'slide_from_right',
      contentStyle: { backgroundColor: '#0D0D0D' },
    }}
  >
    <Stack.Screen name="Wallet"                     component={WalletScreen} />
    <Stack.Screen name="TopUp"                      component={TopUpScreen} />
    <Stack.Screen name="TransactionHistory"         component={TransactionHistoryScreen} />
    <Stack.Screen name="Membership"                 component={MembershipScreen} />
    <Stack.Screen name="MembershipMarketplace"      component={MembershipTransferMarketplaceScreen} />
    <Stack.Screen name="MembershipMarketplaceDetail" component={MembershipTransferMarketplaceDetailScreen} />
    <Stack.Screen name="SubscriptionPackages"       component={SubscriptionPackagesScreen} />
    <Stack.Screen name="SubscriptionCheckout"       component={SubscriptionCheckoutScreen} />
    <Stack.Screen name="SubscriptionPaymentStatus"  component={SubscriptionPaymentStatusScreen} />
  </Stack.Navigator>
);
