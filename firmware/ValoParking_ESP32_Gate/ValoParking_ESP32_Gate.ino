#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <ESP32Servo.h>
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"

// ====================================================================
// VALO PARKING - CỔNG BARRIER THÔNG MINH TÍCH HỢP CẢM BIẾN QUANG E3F-DS30C4
// HIỆU ỨNG CHỮ CHẠY DYNAMIC CHO CẢ WELCOME, CHECK-IN & CHECK-OUT (TAM BIET)
// --------------------------------------------------------------------
// MÀN HÌNH LCD I2C : SDA -> G21, SCL -> G22
// SERVO BARRIER    : SIGNAL -> G18
// CẢM BIẾN QUANG   : DÂY ĐEN (OUT) -> G19, NÂU -> VIN(5V), XANH -> GND
// ====================================================================

LiquidCrystal_I2C* lcd = nullptr;
Servo barrierServo;

#define SERVO_PIN 18
#define SENSOR_PIN 19 // Chân tín hiệu cảm biến quang E3F-DS30C4

bool isBarrierOpen = false;
unsigned long barrierOpenedAt = 0;
const unsigned long SAFETY_TIMEOUT_MS = 30000; // Timeout 30s nếu xe không đi qua

// Trạng thái theo dõi xe đi qua cảm biến
bool vehicleDetectedUnderGate = false;
bool vehicleHasPassed = false;
unsigned long vehiclePassedTime = 0;
const unsigned long CLOSE_DELAY_AFTER_PASS_MS = 1500; // Đợi 1.5s sau khi xe qua hẳn mới đóng

// --- CẤU HÌNH HIỆU ỨNG CHỮ CHẠY ĐA NĂNG (DYNAMIC MARQUEE) ---
String currentLine1 = "  VALO PARKING  ";
String currentMarqueeMsg = "   WELCOME TO VALO PARKING - CHUC QUY KHACH MOT NGAY TOT LANH!   ";
int marqueeIndex = 0;
unsigned long lastMarqueeUpdate = 0;
const unsigned long MARQUEE_SPEED_MS = 250; // Tốc độ chạy chữ mượt mà (250ms/ký tự)

// Đổi nội dung chữ chạy
void setMarqueeContent(String line1, String marqueeMsg) {
  currentLine1 = line1;
  currentMarqueeMsg = "   " + marqueeMsg + "   ";
  marqueeIndex = 0;
  lastMarqueeUpdate = 0;
  if (lcd) {
    lcd->clear();
    lcd->setCursor(0, 0);
    lcd->print(currentLine1);
  }
}

// Khởi tạo lại màn hình chờ mặc định
void showDefaultScreen() {
  setMarqueeContent("  VALO PARKING  ", "WELCOME TO VALO PARKING - CHUC QUY KHACH MOT NGAY TOT LANH!");
}

// Xử lý chạy chữ dòng 2 (Non-blocking)
void handleMarqueeEffect() {
  if (!lcd) return;

  if (millis() - lastMarqueeUpdate >= MARQUEE_SPEED_MS) {
    lastMarqueeUpdate = millis();

    String displayStr = "";
    int msgLen = currentMarqueeMsg.length();
    for (int i = 0; i < 16; i++) {
      int charPos = (marqueeIndex + i) % msgLen;
      displayStr += currentMarqueeMsg[charPos];
    }

    lcd->setCursor(0, 0);
    lcd->print(currentLine1);
    lcd->setCursor(0, 1);
    lcd->print(displayStr);

    marqueeIndex = (marqueeIndex + 1) % msgLen;
  }
}

// Mở barrier
void openBarrier(String line1, String marqueeText) {
  if (isBarrierOpen) return;

  // Cập nhật chữ chạy cho sự kiện mở cổng (Check-in hoặc Check-out)
  setMarqueeContent(line1, marqueeText);

  Serial.println("[ESP32] >> BAT DAU NANG CAN BARRIER (90 DO)...");

  barrierServo.attach(SERVO_PIN, 500, 2400);
  for (int angle = 0; angle <= 90; angle += 10) {
    barrierServo.write(angle);
    delay(20);
  }
  delay(100);
  barrierServo.detach(); // Ngắt giữ chống sụt áp

  isBarrierOpen = true;
  barrierOpenedAt = millis();
  
  // Reset trạng thái cảm biến cho lượt xe mới
  vehicleDetectedUnderGate = false;
  vehicleHasPassed = false;
  vehiclePassedTime = 0;

  Serial.println("[ESP32] >> BARRIER DA MO! DANG CHO XE DI QUA CAM BIEN...");
}

// Đóng barrier
void closeBarrier() {
  if (!isBarrierOpen) return;

  if (lcd) {
    lcd->clear();
    lcd->setCursor(0, 0);
    lcd->print("  VALO PARKING  ");
    lcd->setCursor(0, 1);
    lcd->print(" DANG DONG CONG ");
  }

  Serial.println("[ESP32] >> BAT DAU HA CAN BARRIER (0 DO)...");

  barrierServo.attach(SERVO_PIN, 500, 2400);
  for (int angle = 90; angle >= 0; angle -= 10) {
    barrierServo.write(angle);
    delay(20);
  }
  delay(100);
  barrierServo.detach();

  isBarrierOpen = false;
  vehicleDetectedUnderGate = false;
  vehicleHasPassed = false;
  
  Serial.println("[ESP32] >> BARRIER DA DONG HOAN TOAN!");
  delay(1000);
  showDefaultScreen();
}

// Tự động dò địa chỉ I2C của LCD
byte scanI2C() {
  byte foundAddress = 0;
  for (byte address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    if (Wire.endTransmission() == 0) {
      foundAddress = address;
      break;
    }
  }
  return foundAddress;
}

void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

  Serial.begin(115200);
  delay(500);

  // 1. Cấu hình chân Cảm biến quang E3F-DS30C4
  pinMode(SENSOR_PIN, INPUT_PULLUP);

  // 2. Khởi tạo LCD I2C
  Wire.begin(21, 22);
  delay(200);
  byte lcdAddr = scanI2C();
  if (lcdAddr == 0) lcdAddr = 0x27;

  lcd = new LiquidCrystal_I2C(lcdAddr, 16, 2);
  lcd->init();
  lcd->backlight();
  lcd->clear();
  lcd->setCursor(0, 0);
  lcd->print("  VALO PARKING  ");
  lcd->setCursor(0, 1);
  lcd->print(" KHOI DONG HE THONG");
  delay(1000);

  // 3. Khởi tạo Servo
  ESP32PWM::allocateTimer(0);
  barrierServo.setPeriodHertz(50);
  barrierServo.attach(SERVO_PIN, 500, 2400);
  barrierServo.write(0);
  delay(300);
  barrierServo.detach();
  isBarrierOpen = false;

  showDefaultScreen();
  Serial.println("ESP32_BARRIER_READY");
}

void loop() {
  // 1. Luôn duy trì hiệu ứng chạy chữ mượt mà (cả khi chờ, checkin hoặc checkout)
  handleMarqueeEffect();

  // 2. ĐỌC TÍN HIỆU CẢM BIẾN QUANG KHI BARRIER ĐANG MỞ
  if (isBarrierOpen) {
    bool isObstaclePresent = (digitalRead(SENSOR_PIN) == LOW);

    // Giai đoạn 1: Xe bắt đầu đi vào phạm vi cảm biến
    if (isObstaclePresent && !vehicleDetectedUnderGate) {
      vehicleDetectedUnderGate = true;
      Serial.println("[ESP32-SENSOR] >> PHAT HIEN XE DANG DI QUA CONG BARRIER...");
    }

    // Giai đoạn 2: Xe đã đi qua khỏi cảm biến (từ LOW chuyển lại thành HIGH)
    if (!isObstaclePresent && vehicleDetectedUnderGate && !vehicleHasPassed) {
      vehicleHasPassed = true;
      vehiclePassedTime = millis();
      Serial.println("[ESP32-SENSOR] >> XE DA QUA KHOI CONG! CHUAN BI DONG BARRIER...");
    }

    // Giai đoạn 3: Đợi 1.5 giây an toàn sau khi xe qua hẳn -> Tự động đóng barrier
    if (vehicleHasPassed && (millis() - vehiclePassedTime >= CLOSE_DELAY_AFTER_PASS_MS)) {
      Serial.println("[ESP32] >> XE QUA HOAN TAT -> DONG CONG!");
      closeBarrier();
    }

    // Giai đoạn dự phòng: Tự động đóng an toàn sau 30s nếu xe kẹt hoặc không vào
    if (millis() - barrierOpenedAt > SAFETY_TIMEOUT_MS) {
      Serial.println("[ESP32] >> TIMEOUT 30S: TU DONG DONG CONG AN TOAN");
      closeBarrier();
    }
  }

  // 3. LẮNG NGHE LỆNH SERIAL TỪ KIOSK / PYTHON
  if (Serial.available() > 0) {
    String command = Serial.readStringUntil('\n');
    command.trim();

    if (command.length() == 0) return;
    Serial.println("[ESP32 REC]: " + command);

    // Format lệnh mở: OPEN|<plate>|<slot>|<gate>
    if (command.startsWith("OPEN")) {
      String plate = "";
      String slot = "";
      String gate = "";

      int firstPipe = command.indexOf('|');
      if (firstPipe != -1) {
        int secondPipe = command.indexOf('|', firstPipe + 1);
        if (secondPipe != -1) {
          int thirdPipe = command.indexOf('|', secondPipe + 1);
          plate = command.substring(firstPipe + 1, secondPipe);
          if (thirdPipe != -1) {
            slot = command.substring(secondPipe + 1, thirdPipe);
            gate = command.substring(thirdPipe + 1);
          } else {
            slot = command.substring(secondPipe + 1);
          }
        } else {
          plate = command.substring(firstPipe + 1);
        }
      }

      String line1 = "  VALO PARKING  ";
      String scrollMsg = "MO CONG XE VAO - CHAO MUNG QUY KHACH!";

      if (plate.length() > 0) {
        // TRƯỜNG HỢP CHECK-OUT (XE RA): Chạy chữ TẠM BIỆT QUÝ KHÁCH
        if (gate.indexOf("EXIT") != -1 || command.indexOf("CHECKOUT") != -1) {
          line1 = "RA: " + plate;
          scrollMsg = "TAM BIET QUY KHACH - CHUC BAN THUONG LO BINH AN - HEN GAP LAI!";
        } 
        // TRƯỜNG HỢP CHECK-IN (XE VÀO): Chạy chữ CHÀO MỪNG + Ô ĐỖ
        else {
          line1 = "VAO: " + plate;
          if (slot.length() > 0) {
            scrollMsg = "XIN CHAO! O DO CUA BAN LA: " + slot + " - VUI LONG DO DUNG VI TRI - CHUC MOT NGAY TOT LANH!";
          } else {
            scrollMsg = "XIN CHAO QUY KHACH - MO CONG CHECK-IN - CHUC MOT NGAY TOT LANH!";
          }
        }
      }

      openBarrier(line1, scrollMsg);
    } 
    else if (command.startsWith("CHECKIN")) {
      openBarrier("  XIN CHAO!  ", "CHAO MUNG DEN VALO PARKING - MO CONG CHECK-IN");
    } 
    else if (command.startsWith("CHECKOUT")) {
      openBarrier("  TAM BIET!  ", "TAM BIET QUY KHACH - CHUC BAN THUONG LO BINH AN - HEN GAP LAI!");
    } 
    else if (command.startsWith("CLOSE")) {
      // Khi web gửi CLOSE, cảm biến sẽ quyết định đóng khi xe qua hẳn
    }
  }
}