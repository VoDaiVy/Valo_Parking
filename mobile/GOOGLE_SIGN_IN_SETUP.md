# Thiết lập Google Login cho APK

Android/iOS dùng `@react-native-google-signin/google-signin` để lấy Google ID token, sau đó gửi token đến `POST /api/auth/google`. Backend xác minh token và trả token đăng nhập của VALO. Web giữ luồng trình duyệt hiện có.

Google Login cần APK hoặc development build có module native; Expo Go không chứa module này. Các bước bên dưới không yêu cầu Firebase hoặc phát hành lên Google Play.

## 1. Tạo OAuth client trong Google Cloud

Mở [Google Cloud Console](https://console.cloud.google.com/), chọn cùng một project cho các client:

1. Trong Google Auth Platform → Branding, điền tên ứng dụng và email hỗ trợ.
2. Trong Audience, chọn External nếu cho phép tài khoản Gmail thông thường. Khi đang Testing, thêm tài khoản thử nghiệm vào Test users nếu màn hình consent yêu cầu.
3. Chỉ sử dụng quyền thông tin cơ bản: `openid`, `email`, `profile`.
4. Trong Clients, tạo các client sau:

| Client | Giá trị cần nhập | Cách sử dụng |
| --- | --- | --- |
| Web application | Tên tùy chọn | Client ID dùng chung cho mobile và backend |
| Android | Package `com.valoparking.mobile` và SHA-1 của chứng thư ký APK | Google nhận diện bản Android |
| iOS (nếu build iOS) | Bundle ID `com.valoparking.mobile` | Client ID riêng cho iOS |

Không nhập Android Client ID vào biến Web Client ID. Không đưa Client Secret vào app.

### Lấy đúng SHA-1

Với APK ký bằng EAS, chạy trong thư mục `mobile`:

```powershell
npx eas-cli@latest credentials -p android
```

Chọn profile `preview` và xem Android keystore/certificate fingerprint. Nếu chưa có keystore, tạo credentials bằng trình tương tác của EAS, rồi đăng ký SHA-1 trước khi thử đăng nhập.

Với bản debug local, sau khi đã tạo thư mục native `android`:

```powershell
cd android
.\gradlew signingReport
```

Đọc SHA-1 của variant thực sự đang cài. Debug local, EAS preview và Google Play App Signing có thể dùng chứng thư khác nhau. Tạo thêm Android OAuth client cho mỗi cặp package/SHA-1 cần hỗ trợ, trong cùng Google Cloud project. Với bản cài qua Play, dùng SHA-1 của **App signing certificate** trên Play Console.

## 2. Cấu hình backend

Đặt trong `backend/.env` hoặc biến môi trường của dịch vụ backend:

```dotenv
GOOGLE_CLIENT_ID=YOUR_WEB_CLIENT_ID.apps.googleusercontent.com
```

Khởi động lại backend. Giá trị này phải giống `EXPO_PUBLIC_GOOGLE_CLIENT_ID` của mobile: native SDK yêu cầu token dành cho Web client này và backend kiểm tra đúng audience đó.

## 3. Cấu hình mobile và EAS

Khi chạy local, đặt trong `mobile/.env`:

```dotenv
EXPO_PUBLIC_GOOGLE_CLIENT_ID=YOUR_WEB_CLIENT_ID.apps.googleusercontent.com
EXPO_PUBLIC_API_URL=https://your-backend.example.com/api
EXPO_PUBLIC_SOCKET_URL=https://your-backend.example.com
EXPO_PUBLIC_ENV=production
```

Thay domain minh họa bằng backend đang triển khai của bạn. Điện thoại cần truy cập được backend; IP `192.168.x.x` chỉ phù hợp khi cùng mạng LAN. Không giữ URL mặc định của dự án cho APK gửi cho người khác.

Nếu build iOS, thêm:

```dotenv
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=YOUR_IOS_CLIENT_ID.apps.googleusercontent.com
```

`app.config.js` tự suy ra URL scheme đảo ngược từ iOS Client ID và thêm plugin iOS khi có biến này. Android dùng autolinking; không cần iOS Client ID để build APK. Native login không sử dụng `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`; vẫn phải tạo Android OAuth client trên Google Cloud.

`.env` bị Git bỏ qua nên không tự có trên EAS Build. Vào project trên [Expo dashboard](https://expo.dev/), mục Environment variables, tạo các biến trên cho environment **preview**, visibility **Plain text**. Đây là các giá trị public được đóng gói trong app.

Hoặc dùng EAS CLI, lặp lại cho từng biến:

```powershell
npx eas-cli@latest env:set --environment preview --name EXPO_PUBLIC_GOOGLE_CLIENT_ID --value YOUR_WEB_CLIENT_ID.apps.googleusercontent.com --visibility plaintext
```

Một số phiên bản CLI cũ dùng `env:create` thay cho `env:set`; dashboard dùng được cho cả hai trường hợp. Đặt cùng các biến API, socket và môi trường trên EAS, không chỉ Google Client ID.

## 4. Build APK và cài thử

Chạy từ thư mục `mobile`:

```powershell
npm install
npx eas-cli@latest login
npx eas-cli@latest build --platform android --profile preview
```

Profile `preview` trong `eas.json` chọn environment `preview` và `android.buildType: "apk"`. Tải APK từ link EAS trả về rồi cài lên thiết bị Android có Google Play services.

Kiểm tra nút đăng nhập Google, chọn tài khoản, xác nhận vào app và thử đăng xuất/đăng nhập lại. Thử hủy hộp thoại Google để kiểm tra app trở về màn hình đăng nhập bình thường. Dùng tài khoản khác để kiểm tra tạo/liên kết tài khoản trên backend.

Sau khi đổi native dependency hoặc cấu hình plugin, cần build lại. Với APK preview, đổi biến `EXPO_PUBLIC_*` cũng cần tạo bản APK mới để đóng gói giá trị mới.

## Xử lý lỗi

| Hiện tượng | Kiểm tra |
| --- | --- |
| `DEVELOPER_ERROR` / mã 10 | Package, SHA-1 của APK đang cài, Web Client ID và Android OAuth client có thuộc cùng project không |
| Backend trả `Invalid Google token` | `GOOGLE_CLIENT_ID` backend phải bằng Web Client ID mobile; restart backend sau khi đổi |
| Thiếu Web Client ID | Đặt `EXPO_PUBLIC_GOOGLE_CLIENT_ID` ở đúng environment EAS và build lại |
| Không tìm thấy native module | Cài bản APK/development build mới có dependency; không dùng Expo Go |
| Google Play services không khả dụng | Dùng thiết bị/emulator có Google Play services và cập nhật dịch vụ |
| Đăng nhập Google xong nhưng app báo lỗi mạng | Kiểm tra URL `/api`, HTTPS, backend đang chạy và điện thoại truy cập được domain |
| Google chặn tài khoản thử nghiệm | Kiểm tra Audience, trạng thái Testing và Test users trên Google Cloud |

## Giới hạn và tài liệu

Module Original của thư viện dùng Google Sign-In Android SDK cũ đã deprecated; tài liệu thư viện ghi nhận SDK vẫn hoạt động. Cần theo dõi hướng chuyển sang Credential Manager/Universal khi thư viện hoặc Google thay đổi hỗ trợ. [Tài liệu Original](https://react-native-google-signin.github.io/docs/original)

Hướng dẫn này chưa xác nhận đăng nhập thực tế với credentials của bạn, chưa tạo APK và chưa kiểm thử web từ đầu đến cuối. Việc xác nhận cuối cùng cần Google Cloud, backend và bản APK ký bằng credentials thực tế.

- [Expo: Google authentication](https://docs.expo.dev/guides/google-authentication/)
- [Cấu hình thư viện với Expo](https://react-native-google-signin.github.io/docs/setting-up/expo)
- [Biến môi trường EAS](https://docs.expo.dev/eas/environment-variables/)
- [Google: xác minh ID token phía server](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)
