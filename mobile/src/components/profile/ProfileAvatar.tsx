import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Avatar } from '@/components/common';
import { colors } from '@/theme';
import { CONTROL, MOTION, RADIUS } from '@/constants/theme';

interface Props {
  uri?: string;
  name: string;
  editable?: boolean;
  size?: number;
  onPress?: () => void;
}

export const ProfileAvatar = ({ uri, name, editable = false, size = 80, onPress }: Props) => (
  <Pressable
    accessibilityRole={editable ? 'button' : 'image'}
    accessibilityLabel={editable ? `Edit profile photo: ${name}` : name}
    disabled={!editable}
    style={({ pressed }) => [styles.avatar, { height: size, width: size }, pressed && editable && styles.pressed]}
    onPress={onPress}
  >
    <Avatar name={name} size={size} uri={uri} />
    {editable ? (
      <View style={styles.badge}>
        <AppText color={colors.light.text.inverse} variant="caption">+</AppText>
      </View>
    ) : null}
  </Pressable>
);

const styles = StyleSheet.create({
  avatar: { minHeight: CONTROL.minTouchSize, minWidth: CONTROL.minTouchSize, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.88, transform: [{ scale: MOTION.pressedScale }] },
  badge: {
    alignItems: 'center',
    backgroundColor: colors.primary[500],
    borderRadius: RADIUS.round,
    borderWidth: 2,
    borderColor: colors.light.surface,
    bottom: 0,
    height: 28,
    justifyContent: 'center',
    position: 'absolute',
    right: 0,
    width: 28,
  },
});

