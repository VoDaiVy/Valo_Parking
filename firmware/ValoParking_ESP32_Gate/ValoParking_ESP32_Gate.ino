#include <ESP32Servo.h>

// ====================================================
// VALO PARKING - FIRMWARE NHẬN LỆNH SERIAL TỪ PYTHON
// ====================================================
Servo barrierServo;
#define SERVO_PIN 18

void setup() {
  Serial.begin(115200);

  // Khởi tạo Servo Barrier
  ESP32PWM::allocateTimer(0);
  barrierServo.setPeriodHertz(50);
  barrierServo.attach(SERVO_PIN, 500, 2400);
  barrierServo.write(0); // Ban đầu đóng thanh chắn (0 độ)

  Serial.println("ESP32_BARRIER_READY");
}

void loop() {
  // Lắng nghe lệnh gửi từ Python Bridge qua cổng USB
  if (Serial.available() > 0) {
    String command = Serial.readStringUntil('\n');
    command.trim();

    if (command == "OPEN") {
      Serial.println("[ESP32] >> NHAN LENH: MO BARRIER (90 DO)");
      barrierServo.write(90); // Mở Barrier lên 90 độ
      delay(6000);            // Giữ mở 6 giây cho xe qua

      Serial.println("[ESP32] >> DONG BARRIER (VE 0 DO)");
      barrierServo.write(0);  // Đóng Barrier về 0 độ
    }
  }
}
