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
const unsigned long SETTLE_DELAY_MS = 500;    // 0.5s sau khi mở là sẵn sàng nhận diện
const unsigned long OBSTACLE_CONFIRM_MS = 80; // Nhạy: cắt tia 80ms là nhận diện ngay
const unsigned long CLEAR_CONFIRM_MS = 150;   // Hết che tia 150ms là nhận diện đã qua xong
const unsigned long CLOSE_DELAY_MS = 1000;    // Đợi 1s sau khi xe qua hẳn mới đóng

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

int currentServoAngle = 0;
GateState stateBeforePause = GATE_IDLE_CLOSED;

// Mở barrier thông thường
void openBarrier(String line1, String marqueeText) {
  setMarqueeContent(line1, marqueeText);
  Serial.println("[ESP32] >> BAT DAU NANG CAN BARRIER (90 DO)...");

  barrierServo.attach(SERVO_PIN, 500, 2400);
  for (int angle = currentServoAngle; angle <= 90; angle += 10) {
    barrierServo.write(angle);
    currentServoAngle = angle;
    delay(20);
  }
  delay(100);
  barrierServo.detach();
  currentServoAngle = 90;

  currentGateState = GATE_OPEN_WAITING;
  barrierOpenedAt = millis();
  obstacleDetectedStart = 0;
  obstacleClearStart = 0;
  lastSensorLogTime = millis();

  Serial.println("[ESP32] >> BARRIER DA MO! DANG CHO XE DI QUA CAM BIEN...");
}

// Kích hoạt chế độ Tạm dừng (Vô hiệu hóa cảm biến & Timeout, giữ nguyên vị trí thanh chắn)
void pauseBarrier() {
  if (currentGateState != GATE_HOLD_MAINTENANCE) {
    stateBeforePause = currentGateState;
  }
  barrierServo.detach();
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
      barrierServo.attach(SERVO_PIN, 500, 2400);
      for (int angle = currentServoAngle; angle <= 90; angle += 10) {
        barrierServo.write(angle);
        currentServoAngle = angle;
        delay(20);
      }
      delay(100);
      barrierServo.detach();
      currentServoAngle = 90;
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

  barrierServo.attach(SERVO_PIN, 500, 2400);
  for (int angle = currentServoAngle; angle >= 0; angle -= 10) {
    barrierServo.write(angle);
    currentServoAngle = angle;
    delay(20);
  }
  delay(100);
  barrierServo.detach();
  currentServoAngle = 0;

  currentGateState = GATE_IDLE_CLOSED;
  Serial.println("[ESP32] >> BARRIER DA DONG HOAN TOAN!");
  Serial.println("GATE_CLOSED");
  delay(500);
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

  ESP32PWM::allocateTimer(0);
  barrierServo.setPeriodHertz(50);
  barrierServo.attach(SERVO_PIN, 500, 2400);
  barrierServo.write(0);
  delay(300);
  barrierServo.detach();
  
  currentGateState = GATE_IDLE_CLOSED;
  showDefaultScreen();
  Serial.println("ESP32_BARRIER_READY");
}

void loop() {
  // 1. Luôn duy trì hiệu ứng chạy chữ
  handleMarqueeEffect();

  // 2. QUẢN LÝ TIẾN TRÌNH CẢM BIẾN XE QUA CỔNG (CHỈ KHI ĐANG Ở CHẾ ĐỘ TỰ ĐỘNG)
  if (currentGateState != GATE_IDLE_CLOSED && currentGateState != GATE_HOLD_MAINTENANCE) {
    // Chỉ đọc cảm biến sau khi mở xong 1.5s để loại trừ rung giật/nhiễu dòng điện của servo
    if (millis() - barrierOpenedAt >= SETTLE_DELAY_MS) {
      bool isObstacle = (digitalRead(SENSOR_PIN) == LOW);

      // Giai đoạn 1: Cổng đang mở, xe bắt đầu tiến vào cắt tia hồng ngoại
      if (currentGateState == GATE_OPEN_WAITING) {
        if (isObstacle) {
          currentGateState = GATE_CAR_UNDER;
          Serial.println("\n🚗 [ESP32-SENSOR] >> ĐÃ CẮT TIA HỒNG NGOẠI: XE ĐANG QUA CỔNG!");
        }
      }

      // Giai đoạn 2: Xe đang ở dưới thanh chắn -> chờ xe đi qua hẳn (hết vật cản)
      else if (currentGateState == GATE_CAR_UNDER) {
        if (!isObstacle) {
          currentGateState = GATE_CAR_PASSED;
          carPassedAt = millis();
          Serial.println("\n✅ [ESP32-SENSOR] >> XE ĐÃ QUA KHỎI TIA HỒNG NGOẠI! ĐÓNG SAU 1 GIÂY...");
        }
      }

      // Giai đoạn 3: Đang đếm 1s để đóng -> nếu có vật cản lại thì giữ cổng, nếu hết 1s thì đóng dứt khoát
      else if (currentGateState == GATE_CAR_PASSED) {
        if (isObstacle) {
          currentGateState = GATE_CAR_UNDER;
          Serial.println("\n⚠️ [ESP32-SENSOR] >> CÓ VẬT CẢN TRỞ LẠI -> GIỮ NGUYÊN CỔNG MỞ AN TOÀN!");
        } else if (millis() - carPassedAt >= CLOSE_DELAY_MS) {
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