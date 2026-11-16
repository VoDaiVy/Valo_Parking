# Android push notifications for the development APK

## Firebase setup

1. Open https://console.firebase.google.com/ and create a Firebase project. You can add Firebase to the Google Cloud project already used for OAuth.
2. Add an Android app with package `com.valoparking.mobile`. Download `google-services.json` and save it as `mobile/google-services.json`.
3. In Firebase Project settings > Service accounts, generate a private key. Store this outside the repository; it is separate from google-services.json.
4. From `mobile`, run `npx eas-cli credentials`. Select Android, the development profile, Google Service Account, then Manage your Google Service Account Key for Push Notifications (FCM V1). Upload the service-account key.
5. For cloud builds, add an EAS environment variable of type File named `GOOGLE_SERVICES_JSON` in the `preview` environment and upload google-services.json. Both development and preview builds use this environment. Alternatively, the local google-services.json is included by the existing .easignore.

App config reads GOOGLE_SERVICES_JSON first, then mobile/google-services.json. Without either, OAuth can still run, but Android remote push cannot work. Do not put service-account keys in EXPO_PUBLIC variables or Git.

## Build and test

From `mobile`, run:

```powershell
npx eas-cli build --platform android --profile development
npx expo start --dev-client
```

Install the new APK, log in, and allow notifications. The backend must be reachable from the phone. Native Firebase configuration requires rebuilding the APK. For a standalone test APK without Metro, use `--profile preview` instead.

Ensure backend EXPO_PUSH_ENABLED is not false. If Expo push security is enabled, configure backend EXPO_PUSH_ACCESS_TOKEN.

Lock the phone with the app in the background. Send a notification to the test user using the existing admin notification screen. Verify the title, body and sound, then tap the notification to check navigation while the app is running in the background. Also deny permission, re-enable it in Android Settings, and return to the app to check registration.

Registration failures appear in Metro as `[Notifications] Push registration failed`. Android channels are created even if permission was already granted. Registration retries when the app becomes active.

The OS controls lock-screen visibility, sound and pop-up presentation. Do Not Disturb or force-stopping the app can prevent alerts. Notifications use private visibility so the OS can hide content on a secure lock screen.

Not verified here: Firebase credentials, delivery on a physical phone, and navigation after tapping a notification that launches a terminated app.

References:
- https://docs.expo.dev/push-notifications/fcm-credentials/
- https://docs.expo.dev/push-notifications/push-notifications-setup/
