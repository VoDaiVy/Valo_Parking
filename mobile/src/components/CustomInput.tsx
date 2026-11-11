import React, { useState } from 'react';
import {
  StyleSheet,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  View,
} from 'react-native';

import { COLORS, CONTROL, RADIUS, SPACE } from '../constants/theme';
import { typography } from '@/theme';

interface CustomInputProps extends TextInputProps {
  icon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  onRightIconPress?: () => void;
}

export default function CustomInput({
  icon,
  rightIcon,
  onRightIconPress,
  style,
  onFocus,
  onBlur,
  ...props
}: CustomInputProps) {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <View
      style={[
        styles.container,
        props.editable === false && styles.disabled,
        isFocused ? styles.containerFocused : styles.containerDefault,
        style as object,
      ]}
    >
      {icon && <View style={styles.iconLeft}>{icon}</View>}

      <TextInput
        style={styles.input}
        placeholderTextColor={COLORS.textMuted}
        onFocus={(event) => { setIsFocused(true); onFocus?.(event); }}
        onBlur={(event) => { setIsFocused(false); onBlur?.(event); }}
        {...props}
      />

      {rightIcon && (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={onRightIconPress}
          style={styles.iconRight}
        >
          {rightIcon}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    backgroundColor: COLORS.surface,
    minHeight: CONTROL.minHeight,
    paddingHorizontal: SPACE[16],
    marginBottom: SPACE[16],
  },
  containerDefault: {
    borderColor: COLORS.border,
  },
  containerFocused: {
    borderColor: COLORS.gold,
    backgroundColor: COLORS.surfaceElevated,
  },
  iconLeft: {
    marginRight: SPACE[12],
  },
  iconRight: {
    marginLeft: SPACE[8],
    minWidth: CONTROL.minTouchSize,
    minHeight: CONTROL.minTouchSize,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    ...typography.body1,
    flex: 1,
    minWidth: 0,
    minHeight: CONTROL.minHeight,
    paddingVertical: SPACE[12],
    color: COLORS.textPrimary,
  },
  disabled: { opacity: 0.55 },
});
