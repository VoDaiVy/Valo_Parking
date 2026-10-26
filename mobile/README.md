# VALO Parking Mobile App

Expo + React Native mobile foundation for the VALO PARKING ecosystem.

## What is included

- TypeScript strict mode and path aliases
- Environment configuration for API and Socket.IO URLs
- Secure token storage with Expo SecureStore
- Axios API client with auth headers, refresh-token retry, and normalized errors
- Auth, profile, vehicle, wallet, notification, policy, subscription, booking, and session API service modules
- Auth context, socket context, lifecycle handling, and reusable hooks
- React Navigation auth stack, bottom tabs, nested stacks, deep link config, and navigation persistence
- Core design tokens and reusable UI components
- Login, register, password recovery, profile, vehicle, and wallet starter screens
- Customer booking core: browse slots, select vehicle/services, wallet balance gate, create bookings
- Booking history with filters, booking details, QR confirmation, QR scanner fallback, and visual parking map
- Property-based tests for booking time, price, refund, wallet, QR, and vehicle-conflict rules

## Run

```bash
cd mobile
npm install
npx expo start
```

Use a development build, an emulator, or a simulator. Native Google Sign-In requires a custom build and is unavailable in Expo Go.

## Google Sign-In and Android APK

See [Google Sign-In setup](./GOOGLE_SIGN_IN_SETUP.md) for Google Cloud OAuth clients, APK signing SHA-1, backend audience, EAS environment variables, and APK build instructions.

## API URL

The API and Socket.IO URLs are read from `.env`:

```env
EXPO_PUBLIC_API_URL=http://localhost:5000/api
EXPO_PUBLIC_SOCKET_URL=http://localhost:5000
EXPO_PUBLIC_ENV=development
EXPO_PUBLIC_GOOGLE_CLIENT_ID=
```

Use the right host for your runtime:

- Web or iOS simulator: `http://localhost:5000/api`
- Android emulator: `http://10.0.2.2:5000/api`
- Real phone: use your computer LAN IP, for example `http://192.168.x.x:5000/api`

After changing `.env`, restart Expo. If the old value is still cached, run:

```bash
npx expo start -c
```

## Scripts

```bash
npm run typecheck
npm run lint
npm test
```

The legacy `src/api/*` API test files are still present, but the app entry now uses the production foundation under `src/services`, `src/contexts`, `src/navigation`, and `src/screens`.

## Customer Booking Flow

The Bookings tab starts at booking creation and links to My Bookings. It uses:

- `src/contexts/BookingContext.tsx` for booking state and real-time updates
- `src/services/BookingService.ts`, `ParkingFloorService.ts`, and `ServiceService.ts`
- `src/screens/booking/*` for browse, confirmation, details, scanner, and map screens
- `react-native-qrcode-svg` for QR display and `expo-barcode-scanner` for camera scanning
