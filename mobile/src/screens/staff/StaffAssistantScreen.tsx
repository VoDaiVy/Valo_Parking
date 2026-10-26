import { useEffect } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useStaffAssistant } from '@/contexts/StaffAssistantContext';
import type { StaffManagementStackParamList } from '@/navigation/StaffNavigator';

// Keep existing deep links working while the assistant lives above staff navigation.
export function StaffAssistantScreen({
  navigation,
}: NativeStackScreenProps<StaffManagementStackParamList, 'StaffAssistant'>) {
  const { openAssistant } = useStaffAssistant();
  useEffect(() => {
    navigation.replace('ManagementHome');
    openAssistant();
  }, [navigation, openAssistant]);
  return null;
}
