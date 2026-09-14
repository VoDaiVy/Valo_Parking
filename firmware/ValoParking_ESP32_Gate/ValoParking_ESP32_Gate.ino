#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <ESP32Servo.h>
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"

// ====================================================================
// VALO PARKING - CỔNG BARRIER THÔNG MINH (FSM & MAINTENANCE HOLD)
// --------------------------------------------------------------------
// 1. CHỈ MỞ khi nhận lệnh từ Kiosk Web hoặc Nút bấm Staff
// 2. CHỈ ĐÓNG khi xe đã qua khỏi cảm biến hồng ngoại (hoặc hết 25s an toàn)
// 3. KHI ĐÃ ĐÓNG: Vô hiệu hóa cảm biến 100%, có quẹt tay cũng KHÔNG tự mở/đóng
// 4. CHẾ ĐỘ BẢO TRÌ (HOLD): Giữ cổng mở cố định, TẮT cảm biến để bảo trì/vệ sinh
// ====================================================================

LiquidCrystal_I2C* lcd = nullptr;
Servo barrierServo;

#define SERVO_PIN 18
#define SENSOR_PIN 19 // Chân tín hiệu cảm biến quang E3F-DS30C4

enum GateState {
  GATE_IDLE_CLOSED,      // 0. Cổng đang đóng, chờ lệnh mở từ Kiosk/Staff (Cảm biến KHÔNG kích hoạt)
  GATE_OPEN_WAITING,     // 1. Cổng đã mở lên 90 độ, đang chờ xe tiến vào cảm biến
  GATE_CAR_UNDER,        // 2. Xe đang ở dưới thanh chắn (đang cắt tia hồng ngoại)
  GATE_CAR_PASSED,       // 3. Xe đã vượt qua khỏi tia hồng ngoại -> Chuẩn bị đóng cổng
  GATE_HOLD_MAINTENANCE  // 4. Chế độ bảo trì / giữ cổng: Mở đứng yên, TẮT CẢM BIẾN, không tự đóng
};

GateState currentGateState = GATE_IDLE_CLOSED;
unsigned long barrierOpenedAt = 0;
unsigned long carPassedAt = 0;
unsigned long obstacleDetectedStart = 0;
unsigned long obstacleClearStart = 0;
unsigned long lastSensorLogTime = 0;
const unsigned long SETTLE_DELAY_MS = 1500;  // Đợi 1.5s sau khi mở để triệt tiêu 100% xung nhiễu điện của Servo
const unsigned long OBSTACLE_CONFIRM_MS = 100; // Che tia liên tục 100ms (0.1s) để tránh nhiễu xung kim
const unsigned long CLEAR_CONFIRM_MS = 150;    // Rút tay/xe qua thông thoáng liên tục 150ms
const unsigned long CLOSE_DELAY_MS = 1000;    // Đợi 1s sau khi xe qua hẳn mới hạ cổng

unsigned long obstacleDetectionStart = 0;
unsigned long clearDetectionStart = 0;

// --- CẤU HÌNH HIỆU ỨNG CHỮ CHẠY ĐA NĂNG (DYNAMIC MARQUEE) ---
String currentLine1 = "  VALO PARKING  ";
String currentMarqueeMsg = "   WELCOME TO VALO PARKING - CHUC QUY KHACH MOT NGAY TOT LANH!   ";
int marqueeIndex = 0;
unsigned long lastMarqueeUpdate = 0;
const unsigned long MARQUEE_SPEED_MS = 250;

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

void showDefaultScreen() {
  setMarqueeContent("  VALO PARKING  ", "WELCOME TO VALO PARKING - CHUC QUY KHACH MOT NGAY TOT LANH!");
}

void handleMarqueeEffect() {
  if (!lcd) return;

  int msgLen = currentMarqueeMsg.length();
  if (msgLen < 16) return;

  if (millis() - lastMarqueeUpdate >= MARQUEE_SPEED_MS) {
    lastMarqueeUpdate = millis();

    String displayStr = "";
    for (int i = 0; i < 16; i++) {
      int charPos = (marqueeIndex + i) % msgLen;
      displayStr += currentMarqueeMsg[charPos];
    }

    lcd->setCursor(0, 1);
    lcd->print(displayStr);

    marqueeIndex = (marqueeIndex + 1) % msgLen;
  }
}

int currentServoAngle = 0;
GateState stateBeforePause = GATE_IDLE_CLOSED;
int sensorBaseline = -1;

void openBarrier(String line1, String marqueeText) {
  setMarqueeContent(line1, marqueeText);
  Serial.println("[ESP32] >> BAT DAU NANG CAN BARRIER (90 DO)...");

  if (!barrierServo.attached()) {
    barrierServo.attach(SERVO_PIN, 500, 2400);
  }
  
  // Nâng cần dứt khoát và mượt mà lên 90 độ
  for (int angle = currentServoAngle; angle <= 90; angle += 5) {
    barrierServo.write(angle);
    delay(10);
  }
  barrierServo.write(90);
  currentServoAngle = 90;
  delay(100);

  currentGateState = GATE_OPEN_WAITING;
  barrierOpenedAt = millis();
  obstacleDetectionStart = 0;
  clearDetectionStart = 0;
  carPassedAt = 0;
  sensorBaseline = -1;
  lastSensorLogTime = millis();

  Serial.println("[ESP32] >> BARRIER DA MO! DANG CHO XE DI QUA CAM BIEN...");
}

// Kích hoạt chế độ Tạm dừng (Vô hiệu hóa cảm biến & Timeout, giữ nguyên vị trí thanh chắn)
void pauseBarrier() {
  if (currentGateState != GATE_HOLD_MAINTENANCE) {
    stateBeforePause = currentGateState;
  }
  currentGateState = GATE_HOLD_MAINTENANCE;
  setMarqueeContent("  VALO PARKING  ", "* DANG TAM DUNG BARRIER (TAT CAM BIEN) *");
  Serial.println("[ESP32] >> BAT CHE DO TAM DUNG (VO HIEU HOA CAM BIEN)!");
}

// Tiếp tục hoạt động thông minh theo vị trí thực tế
void resumeBarrier() {
  Serial.println("[ESP32] >> TIEP TUC HOAT DONG BINH THUONG...");
  if (currentGateState == GATE_HOLD_MAINTENANCE) {
    // 1. Nếu tạm dừng khi đang đóng (ở 0 độ) -> giữ nguyên 0 độ và về trạng thái sẵn sàng
    if (currentServoAngle == 0 || stateBeforePause == GATE_IDLE_CLOSED) {
      currentGateState = GATE_IDLE_CLOSED;
      showDefaultScreen();
      Serial.println("[ESP32] >> CONG DANG DONG: GIU NGUYEN VI TRI DONG!");
    }
    // 2. Nếu tạm dừng khi đã mở lên 90 độ -> giữ nguyên 90 độ và bật lại cảm biến
    else if (currentServoAngle >= 90 || stateBeforePause == GATE_OPEN_WAITING || stateBeforePause == GATE_CAR_UNDER || stateBeforePause == GATE_CAR_PASSED) {
      currentGateState = GATE_OPEN_WAITING;
      barrierOpenedAt = millis();
      setMarqueeContent("  VALO PARKING  ", "TIEP TUC HOAT DONG - VALO PARKING");
      Serial.println("[ESP32] >> CONG DANG MO: GIU NGUYEN VI TRI MO & BAT LAI CAM BIEN!");
    }
    // 3. Nếu tạm dừng giữa chừng khi đang nâng -> nâng tiếp cho hết lên 90 độ
    else {
      Serial.println("[ESP32] >> DANG O LUNG CHUNG: NANG TIEP LEN 90 DO...");
      if (!barrierServo.attached()) {
        barrierServo.attach(SERVO_PIN, 500, 2400);
      }
      for (int angle = currentServoAngle; angle <= 90; angle += 5) {
        barrierServo.write(angle);
        currentServoAngle = angle;
        delay(15);
      }
      barrierServo.write(90);
      currentServoAngle = 90;
      delay(150);
      currentGateState = GATE_OPEN_WAITING;
      barrierOpenedAt = millis();
      setMarqueeContent("  VALO PARKING  ", "TIEP TUC HOAT DONG - VALO PARKING");
    }
  }
}

// Đóng barrier
void closeBarrier() {
  if (lcd) {
    lcd->clear();
    lcd->setCursor(0, 0);
    lcd->print("  VALO PARKING  ");
    lcd->setCursor(0, 1);
    lcd->print(" DANG DONG CONG ");
  }

  Serial.println("[ESP32] >> BAT DAU HA CAN BARRIER (0 DO)...");

  if (!barrierServo.attached()) {
    barrierServo.attach(SERVO_PIN, 500, 2400);
  }
  for (int angle = currentServoAngle; angle >= 0; angle -= 5) {
    barrierServo.write(angle);
    delay(10);
  }
  barrierServo.write(0);
  currentServoAngle = 0;
  delay(100);

  currentGateState = GATE_IDLE_CLOSED;
  Serial.println("[ESP32] >> BARRIER DA DONG HOAN TOAN!");
  Serial.println("GATE_CLOSED");
  delay(400);
  showDefaultScreen();
}

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

  pinMode(SENSOR_PIN, INPUT_PULLUP);

  Wire.begin(21, 22);
  Wire.setClock(100000);
  Wire.setTimeOut(25);
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

  // Cấp phát tất cả 4 Timer PWM cho ESP32Servo để tránh cạn kiệt kênh PWM
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);

  barrierServo.setPeriodHertz(50);
  barrierServo.attach(SERVO_PIN, 500, 2400);
  barrierServo.write(0);
  currentServoAngle = 0;
  delay(300);
  
  currentGateState = GATE_IDLE_CLOSED;
  showDefaultScreen();
  Serial.println("ESP32_BARRIER_READY");
}

void loop() {
  // 1. Luôn duy trì hiệu ứng chạy chữ
  handleMarqueeEffect();

  // 2. QUẢN LÝ TIẾN TRÌNH CẢM BIẾN XE QUA CỔNG (CHỈ KHI ĐANG Ở CHẾ ĐỘ TỰ ĐỘNG)
  if (currentGateState != GATE_IDLE_CLOSED && currentGateState != GATE_HOLD_MAINTENANCE) {
    // Đợi 800ms sau khi mở để triệt tiêu dao động servo ban đầu
    if (millis() - barrierOpenedAt >= 800) {
      int pinVal = digitalRead(SENSOR_PIN);
      bool isObstacle = (pinVal == LOW); // LOW (0) = đang che tia / có vật cản, HIGH (1) = thông thoáng

      static int lastReportedPin = -1;
      if (pinVal != lastReportedPin) {
        lastReportedPin = pinVal;
        Serial.printf("   ⚡ [SENSOR PIN 19 THAY ĐỔI]: Mức = %d -> %s\n",
                      pinVal, isObstacle ? "🚗 [ĐANG CHE TIA / CÓ VẬT CẢN]" : "✅ [ĐÃ RÚT TAY / THÔNG THOÁNG]");
      }

      // In log định kỳ mỗi 1.5 giây để theo dõi chân cảm biến
      if (millis() - lastSensorLogTime >= 1500) {
        lastSensorLogTime = millis();
        const char* stateStr = "CHO XE QUA";
        if (currentGateState == GATE_CAR_UNDER) stateStr = "XE DANG DUOI CONG";
        else if (currentGateState == GATE_CAR_PASSED) stateStr = "XE DA QUA - DANG DEM DONG";

        Serial.printf("   [SENSOR PIN 19]: Muc = %d | Vat can = %s | Trang thai = %s\n",
                      pinVal, isObstacle ? "CO" : "KHONG", stateStr);
      }

      // Giai đoạn 1: Cổng đang mở, chờ xe tiến vào che tia hồng ngoại
      if (currentGateState == GATE_OPEN_WAITING) {
        if (isObstacle) {
          currentGateState = GATE_CAR_UNDER;
          clearDetectionStart = 0;
          Serial.println("\n🚗 [ESP32-SENSOR] >> ĐÃ CẮT TIA HỒNG NGOẠI: XE ĐANG QUA CỔNG!");
        } else if (millis() - barrierOpenedAt >= 25000) { // 25s an toàn tự đóng nếu không có xe vào
          Serial.println("\n⏳ [ESP32] >> HẾT 25S CHỜ - TỰ ĐỘNG ĐÓNG CỔNG AN TOÀN!");
          closeBarrier();
        }
      }

      // Giai đoạn 2: Xe đang ở dưới thanh chắn -> chờ xe đi qua hẳn (hết che tia)
      else if (currentGateState == GATE_CAR_UNDER) {
        if (!isObstacle) {
          if (clearDetectionStart == 0) {
            clearDetectionStart = millis();
          } else if (millis() - clearDetectionStart >= 80) { // 80ms thông thoáng liên tục
            currentGateState = GATE_CAR_PASSED;
            carPassedAt = millis();
            Serial.println("\n✅ [ESP32-SENSOR] >> XE ĐÃ QUA KHỎI TIA HỒNG NGOẠI! ĐÓNG SAU 1 GIÂY...");
          }
        } else {
          clearDetectionStart = 0;
        }
      }

      // Giai đoạn 3: Đang đếm 1s để đóng -> nếu có vật cản lại thì giữ cổng, nếu hết 1s thì đóng dứt khoát
      else if (currentGateState == GATE_CAR_PASSED) {
        if (isObstacle) {
          currentGateState = GATE_CAR_UNDER;
          clearDetectionStart = 0;
          Serial.println("\n⚠️ [ESP32-SENSOR] >> CÓ VẬT CẢN TRỞ LẠI -> GIỮ NGUYÊN CỔNG MỞ AN TOÀN!");
        } else if (millis() - carPassedAt >= 1000) {
          Serial.println("\n🔒 [ESP32] >> TIẾN HÀNH ĐÓNG CỔNG BARRIER!");
          closeBarrier();
        }
      }
    }
  }

  // 3. LẮNG NGHE LỆNH TỪ KIOSK HOẶC STAFF PANEL
  if (Serial.available() > 0) {
    String command = Serial.readStringUntil('\n');
    command.trim();

    if (command.length() == 0) return;
    Serial.println("[ESP32 REC]: " + command);

    // Lệnh tạm dừng / bảo trì (VÔ HIỆU HÓA CẢM BIẾN, GIỮ NGUYÊN VỊ TRÍ)
    if (command.startsWith("HOLD") || command.startsWith("PAUSE")) {
      pauseBarrier();
    }
    // Lệnh tiếp tục hoạt động
    else if (command.startsWith("RESUME")) {
      resumeBarrier();
    }
    // Lệnh mở tự động: OPEN|<plate>|<slot>|<gate>
    else if (command.startsWith("OPEN")) {
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
        if (gate.indexOf("EXIT") != -1 || command.indexOf("CHECKOUT") != -1) {
          line1 = "RA: " + plate;
          scrollMsg = "TAM BIET QUY KHACH - CHUC BAN THUONG LO BINH AN - HEN GAP LAI!";
        } else {
          line1 = "VAO: " + plate;
          if (slot.length() > 0 && slot != "STAFF") {
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
    else if (command.startsWith("FORCE_CLOSE") || command.startsWith("CLOSE")) {
      closeBarrier();
    }
  }
}