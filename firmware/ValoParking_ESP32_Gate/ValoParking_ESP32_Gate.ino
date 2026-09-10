#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <ESP32Servo.h>
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"

// ====================================================
// VALO PARKING - FIRMWARE CỔNG BARRIER & MÀN HÌNH LCD
// HIỆU ỨNG CHỮ CHẠY MARQUEE (WELCOME SCROLLING EFFECT)
// SDA -> GPIO 21, SCL -> GPIO 22, SERVO -> GPIO 18
// ====================================================

LiquidCrystal_I2C* lcd = nullptr;
Servo barrierServo;
#define SERVO_PIN 18

bool isBarrierOpen = false;
unsigned long barrierOpenedAt = 0;
const unsigned long SAFETY_TIMEOUT_MS = 20000;

// Cấu hình hiệu ứng chữ chạy Marquee
const String MARQUEE_MSG = "   WELCOME TO VALO PARKING - CHUC QUY KHACH MOT NGAY TOT LANH!   ";
int marqueeIndex = 0;
unsigned long lastMarqueeUpdate = 0;
const unsigned long MARQUEE_SPEED_MS = 300; // Tốc độ chạy chữ (300ms dịch 1 ký tự)

// Hàm cập nhật 2 dòng tĩnh
void updateLCD(String line1, String line2) {
  if (!lcd) return;
  lcd->clear();
  lcd->setCursor(0, 0);
  lcd->print(line1);
  lcd->setCursor(0, 1);
  lcd->print(line2);
}

// Khởi tạo lại màn hình chính
void showDefaultScreen() {
  if (!lcd) return;
  lcd->clear();
  lcd->setCursor(0, 0);
  lcd->print("  VALO PARKING  ");
  marqueeIndex = 0;
  lastMarqueeUpdate = 0;
}

// Xử lý hiệu ứng chữ chạy mượt mà ở dòng 2 (Non-blocking)
void handleMarqueeEffect() {
  if (isBarrierOpen || !lcd) return; // Khi đang mở barrier thì tạm dừng hiệu ứng

  if (millis() - lastMarqueeUpdate >= MARQUEE_SPEED_MS) {
    lastMarqueeUpdate = millis();

    // Cắt 1 đoạn 16 ký tự để hiển thị lên dòng 2
    String displayStr = "";
    for (int i = 0; i < 16; i++) {
      int charPos = (marqueeIndex + i) % MARQUEE_MSG.length();
      displayStr += MARQUEE_MSG[charPos];
    }

    lcd->setCursor(0, 0);
    lcd->print("  VALO PARKING  "); // Dòng 1 luôn cố định đẹp mắt
    lcd->setCursor(0, 1);
    lcd->print(displayStr);         // Dòng 2 chạy chữ Welcome

    marqueeIndex = (marqueeIndex + 1) % MARQUEE_MSG.length();
  }
}

// Mở barrier
void openBarrier(String title, String subtitle) {
  if (isBarrierOpen) return;

  updateLCD(title, subtitle);
  Serial.println("[ESP32] >> BAT DAU NANG CAN BARRIER (90 DO)...");

  barrierServo.attach(SERVO_PIN, 500, 2400);
  for (int angle = 0; angle <= 90; angle += 10) {
    barrierServo.write(angle);
    delay(20);
  }
  delay(100);
  barrierServo.detach(); // Ngắt điện giữ để chống sụt áp

  isBarrierOpen = true;
  barrierOpenedAt = millis();
  Serial.println("[ESP32] >> BARRIER DA MO HOAN TOAN!");
}

// Đóng barrier
void closeBarrier() {
  if (!isBarrierOpen) return;

  updateLCD("  VALO PARKING  ", " DANG DONG CONG ");
  Serial.println("[ESP32] >> BAT DAU HA CAN BARRIER (0 DO)...");

  barrierServo.attach(SERVO_PIN, 500, 2400);
  for (int angle = 90; angle >= 0; angle -= 10) {
    barrierServo.write(angle);
    delay(20);
  }
  delay(100);
  barrierServo.detach(); // Ngắt điện giữ

  isBarrierOpen = false;
  Serial.println("[ESP32] >> BARRIER DA DONG HOAN TOAN!");
  delay(1000);
  showDefaultScreen();
}

// Tự động quét tìm địa chỉ I2C của màn hình LCD
byte scanI2C() {
  byte foundAddress = 0;
  Serial.println("[ESP32] >> DANG QUET DIA CHI I2C LCD...");
  for (byte address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    if (Wire.endTransmission() == 0) {
      Serial.print("[ESP32] >> TIM THAY THIET BI I2C TAI: 0x");
      if (address < 16) Serial.print("0");
      Serial.println(address, HEX);
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

  // 1. Khởi tạo I2C
  Wire.begin(21, 22);
  delay(200);

  // 2. Tự động tìm địa chỉ I2C
  byte lcdAddr = scanI2C();
  if (lcdAddr == 0) {
    Serial.println("[ESP32] >> KHONG TIM THAY LCD! Dung mac dinh 0x27");
    lcdAddr = 0x27;
  }

  // 3. Khởi tạo LCD
  lcd = new LiquidCrystal_I2C(lcdAddr, 16, 2);
  lcd->init();
  lcd->backlight();
  updateLCD("  VALO PARKING  ", " KHOI DONG HE THONG");
  delay(1200);

  // 4. Khởi tạo Servo
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
  // 1. Chạy hiệu ứng chữ Marquee khi ở trạng thái chờ
  handleMarqueeEffect();

  // 2. Lắng nghe lệnh Serial từ Python Bridge
  if (Serial.available() > 0) {
    String command = Serial.readStringUntil('\n');
    command.trim();

    if (command.length() == 0) return;
    Serial.println("[ESP32 REC]: " + command);

    // Xử lý lệnh mở: OPEN|<plate>|<slot>|<gate>
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

      String line1 = "  MO CONG XE  ";
      String line2 = "  VALO PARKING  ";

      if (plate.length() > 0) {
        if (gate.indexOf("EXIT") != -1 || command.indexOf("CHECKOUT") != -1) {
          line1 = "RA: " + plate;
          line2 = " TAM BIET QUY KHACH";
        } else {
          line1 = "VAO: " + plate;
          line2 = (slot.length() > 0) ? ("O DO: " + slot + " (MO)") : " MO CONG VAO ";
        }
      }

      openBarrier(line1, line2);
    } 
    else if (command.startsWith("CHECKIN")) {
      openBarrier("  XIN CHAO!  ", "MO CONG CHECK-IN");
    } 
    else if (command.startsWith("CHECKOUT")) {
      openBarrier("  TAM BIET!  ", "MO CONG CHECKOUT");
    } 
    else if (command.startsWith("CLOSE")) {
      closeBarrier();
    }
  }

  // 3. Tự động đóng an toàn sau 20s nếu kẹt
  if (isBarrierOpen && (millis() - barrierOpenedAt > SAFETY_TIMEOUT_MS)) {
    Serial.println("[ESP32] >> TIMEOUT 20S: DONG CONG AN TOAN");
    closeBarrier();
  }
}