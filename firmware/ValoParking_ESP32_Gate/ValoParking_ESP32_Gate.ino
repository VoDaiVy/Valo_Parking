#include <ESP32Servo.h>
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"

// ====================================================
// VALO PARKING - FIRMWARE ĐIỀU KHIỂN CỔNG BARRIER (ESP32)
// Hỗ trợ cả Quét Camera AI và Nhập tay trên Kiosk
// Tự động đóng khi Kiosk về trang chủ hoặc sau 20s an toàn
// ====================================================

Servo barrierServo;
#define SERVO_PIN 18 // Dây Cam/Vàng cắm vào chân G18

bool isBarrierOpen = false;
unsigned long barrierOpenedAt = 0;
const unsigned long SAFETY_TIMEOUT_MS = 20000; // Tự đóng sau 20s nếu kẹt

// Mở barrier êm ái từ 0 lên 90 độ (chống giật dòng điện)
void openBarrier() {
  if (isBarrierOpen) return;
  Serial.println("[ESP32] >> BAT DAU NANG CAN BARRIER (90 DO)...");
  for (int angle = 0; angle <= 90; angle += 5) {
    barrierServo.write(angle);
    delay(15);
  }
  isBarrierOpen = true;
  barrierOpenedAt = millis();
  Serial.println("[ESP32] >> BARRIER DA MO HOAN TOAN!");
}

// Đóng barrier êm ái từ 90 về 0 độ
void closeBarrier() {
  if (!isBarrierOpen) return;
  Serial.println("[ESP32] >> BAT DAU HA CAN BARRIER (0 DO)...");
  for (int angle = 90; angle >= 0; angle -= 5) {
    barrierServo.write(angle);
    delay(15);
  }
  isBarrierOpen = false;
  Serial.println("[ESP32] >> BARRIER DA DONG HOAN TOAN!");
}

void setup() {
  // 1. TẮT BẢO VỆ BROWNOUT ĐỂ ESP32 KHÔNG BỊ TỰ RESET KHI SERVO QUAY
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

  Serial.begin(115200);
  delay(300);

  // 2. Khởi tạo Servo
  ESP32PWM::allocateTimer(0);
  barrierServo.setPeriodHertz(50);
  barrierServo.attach(SERVO_PIN, 500, 2400);

  // 3. Đưa thanh chắn về vị trí 0 độ ban đầu
  barrierServo.write(0);
  isBarrierOpen = false;

  Serial.println("ESP32_BARRIER_READY");
}

void loop() {
  // 1. Lắng nghe lệnh gửi từ Python Bridge qua cổng USB Serial
  if (Serial.available() > 0) {
    String command = Serial.readStringUntil('\n');
    command.trim();

    if (command.length() == 0) return;

    Serial.println("[ESP32 REC]: " + command);

    // Mọi sự kiện mở cổng (từ Quét Camera AI hoặc Nhập tay)
    if (command.startsWith("CHECKIN") || command.startsWith("CHECKOUT") || command.startsWith("OPEN")) {
      openBarrier();
    }
    // Khi Kiosk kết thúc quay về màn hình chính
    else if (command.startsWith("CLOSE")) {
      closeBarrier();
    }
  }

  // 2. Tự động đóng an toàn sau 20s nếu Kiosk bị mất kết nối hoặc người dùng không thao tác
  if (isBarrierOpen && (millis() - barrierOpenedAt > SAFETY_TIMEOUT_MS)) {
    Serial.println("[ESP32] >> TIMEOUT AN TOAN 20S: TU DONG DONG BARRIER");
    closeBarrier();
  }
}