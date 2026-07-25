export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
};

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  ForgotPassword: undefined;
  VerifyOTP: { email: string; purpose: 'register' | 'reset' };
  ResetPassword: { email: string; otp: string };
};

export type MainTabParamList = {
  HomeTab: undefined;
  BookingsTab: undefined;
  NotificationsTab: undefined;
  WalletTab: undefined;
  ProfileTab: undefined;
};

export type HomeStackParamList = {
  Home: undefined;
};

export type BookingStackParamList = {
  BookingBrowse: undefined;
  BookingConfirmation: { bookingId: string };
  MyBookings: undefined;
  BookingDetails: { bookingId: string };
  QRScanner: { mode: 'check-in' | 'check-out'; bookingId?: string };
  ParkingMap: {
    floorId?: string;
    selectedTimeRange?: {
      startTime: string;
      endTime: string;
    };
  };
};

export type ProfileStackParamList = {
  Profile: undefined;
  PersonalProfile: undefined;
  EditProfile: undefined;
  ChangePassword: undefined;
  VehicleList: undefined;
  AddVehicle: undefined;
  EditVehicle: { vehicleId: string };
  Services: undefined;
  Policies: undefined;
  PolicyDetail: { slug: string };
  ParkingHistory: undefined;
  BookingList: undefined;
  BookingDetail: { bookingId: string };
};

export type NotificationStackParamList = {
  Notifications: undefined;
};

export type WalletStackParamList = {
  Wallet: undefined;
  TopUp: undefined;
  TransactionHistory: undefined;
  TransactionDetail: { transactionId: string };
  Membership: undefined;
  MembershipMarketplace: undefined;
  MembershipMarketplaceDetail: { transferId: string };
  SubscriptionPackages: undefined;
  SubscriptionCheckout: { packageId: string };
  SubscriptionPaymentStatus: {
    orderCode: number;
    checkoutUrl?: string;
    qrCode?: string;
    amount?: number;
    renewal?: boolean;
  };
};
