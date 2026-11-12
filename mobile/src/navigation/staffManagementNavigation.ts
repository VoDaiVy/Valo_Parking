import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { StaffTabParamList } from './StaffNavigator';

export function openStaffManagementHome(
  event: { preventDefault: () => void },
  navigation: Pick<BottomTabNavigationProp<StaffTabParamList, 'Manage'>, 'navigate'>,
) {
  // Native-stack handles tab reselection on the next frame. Cancel its popToTop:
  // restored/deep-linked stacks can have the scanner as their oldest route.
  event.preventDefault();
  navigation.navigate('Manage', { screen: 'ManagementHome', initial: false });
}
