// Android Google Sign-In is autolinked. The plugin registers the iOS URL scheme
// when an iOS OAuth client is supplied; Android-only builds need no iOS client.
module.exports = ({ config }) => {
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  return {
    ...config,
    plugins: [
      ...(config.plugins || []),
      ...(iosClientId
        ? [[
            '@react-native-google-signin/google-signin',
            { iosUrlScheme: `com.googleusercontent.apps.${iosClientId.replace(/\.apps\.googleusercontent\.com$/, '')}` },
          ]]
        : []),
    ],
  };
};
