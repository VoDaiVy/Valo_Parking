import { Text, type TextProps } from 'react-native';

export function PackageText({ style, ...props }: TextProps) {
  return <Text {...props} style={[{ fontFamily: 'Montserrat' }, style]} />;
}
