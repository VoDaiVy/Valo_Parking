const fs = require('node:fs');
const path = require('node:path');
// Android Google Sign-In is autolinked. The plugin registers the iOS URL scheme
// when an iOS OAuth client is supplied; Android-only builds need no iOS client.
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

// Preview APKs use the local HTTP API. Production keeps Android's HTTPS default.
const withDevelopmentHttp = (config) => withAndroidManifest(config, (modConfig) => {
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(modConfig.modResults);
  application.$['android:usesCleartextTraffic'] = 'true';
  return modConfig;
});

module.exports = ({ config }) => {
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const allowDevelopmentHttp = process.env.EXPO_PUBLIC_ENV === 'development'
    && process.env.EXPO_PUBLIC_API_URL?.startsWith('http://');
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON
    || (fs.existsSync(path.join(__dirname, 'google-services.json')) ? './google-services.json' : undefined);
  return {
    ...config,
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
    plugins: [
      ...(config.plugins || []),
      ...(allowDevelopmentHttp ? [withDevelopmentHttp] : []),
      ...(iosClientId
        ? [[
            '@react-native-google-signin/google-signin',
            { iosUrlScheme: `com.googleusercontent.apps.${iosClientId.replace(/\.apps\.googleusercontent\.com$/, '')}` },
          ]]
        : []),
    ],
  };
};
