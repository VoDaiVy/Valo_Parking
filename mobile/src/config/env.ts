import Constants from 'expo-constants';

const trimTrailingSlash = (value: string) => value.replace(/\/$/, '');

const envName = process.env.EXPO_PUBLIC_ENV || 'development';

const defaults = {
  development: {
    // Android Emulator maps the host machine to 10.0.2.2.
    apiBaseUrl: 'http://10.0.2.2:5001/api',
    socketUrl: 'http://10.0.2.2:5001',
  },
  staging: {
    apiBaseUrl: 'https://staging-api.valoparking.com/api',
    socketUrl: 'https://staging-api.valoparking.com',
  },
  production: {
    apiBaseUrl: 'https://api.valoparking.com/api',
    socketUrl: 'https://api.valoparking.com',
  },
} as const;

type EnvName = keyof typeof defaults;

const selectedEnv: EnvName =
  envName === 'staging' || envName === 'production' ? envName : 'development';

const expoHostUri =
  Constants.expoConfig?.hostUri ??
  (Constants as unknown as { manifest?: { debuggerHost?: string } }).manifest?.debuggerHost;

const expoDevHost = expoHostUri?.split(':')[0];
const runtimeDevelopmentUrls = expoDevHost
  ? {
      apiBaseUrl: `http://${expoDevHost}:5001/api`,
      socketUrl: `http://${expoDevHost}:5001`,
    }
  : undefined;

const apiBaseUrl =
  process.env.EXPO_PUBLIC_API_URL ||
  Constants.expoConfig?.extra?.apiBaseUrl ||
  (selectedEnv === 'development' ? runtimeDevelopmentUrls?.apiBaseUrl : undefined) ||
  defaults[selectedEnv].apiBaseUrl;

const socketUrl =
  process.env.EXPO_PUBLIC_SOCKET_URL ||
  Constants.expoConfig?.extra?.socketUrl ||
  (selectedEnv === 'development' ? runtimeDevelopmentUrls?.socketUrl : undefined) ||
  defaults[selectedEnv].socketUrl;

export const config = {
  envName: selectedEnv,
  apiBaseUrl: trimTrailingSlash(apiBaseUrl),
  socketUrl: trimTrailingSlash(socketUrl),
  googleClientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || '',
  googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '',
  googleAndroidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || '',
};

export const API_BASE_URL = config.apiBaseUrl;
export const SOCKET_URL = config.socketUrl;

export const validateConfig = () => {
  const missing: string[] = [];

  if (!API_BASE_URL) {
    missing.push('EXPO_PUBLIC_API_URL');
  }

  if (!SOCKET_URL) {
    missing.push('EXPO_PUBLIC_SOCKET_URL');
  }

  if (selectedEnv === 'production' && !API_BASE_URL.startsWith('https://')) {
    missing.push('EXPO_PUBLIC_API_URL must use HTTPS in production');
  }

  return missing;
};
