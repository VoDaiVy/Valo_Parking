import Svg, { Path } from 'react-native-svg';

// Vector artwork stays sharp and works offline in native development builds.
export function GoogleIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 48 48" accessible={false}>
      <Path fill="#4285F4" d="M43.61 24.46c0-1.36-.12-2.66-.35-3.92H24v7.42h11a9.4 9.4 0 0 1-4.08 6.18v5.14h6.61c3.87-3.56 6.08-8.81 6.08-14.82Z" />
      <Path fill="#34A853" d="M24 44c5.5 0 10.11-1.82 13.53-4.72l-6.61-5.14c-1.83 1.23-4.17 1.97-6.92 1.97-5.31 0-9.81-3.59-11.42-8.42H5.75v5.3A20 20 0 0 0 24 44Z" />
      <Path fill="#FBBC05" d="M12.58 27.69a12 12 0 0 1 0-7.38v-5.3H5.75a20 20 0 0 0 0 17.98l6.83-5.3Z" />
      <Path fill="#EA4335" d="M24 11.89c3 0 5.69 1.03 7.81 3.05l5.86-5.86C34.1 5.75 29.5 4 24 4A20 20 0 0 0 5.75 15.01l6.83 5.3C14.19 15.48 18.69 11.89 24 11.89Z" />
    </Svg>
  );
}
