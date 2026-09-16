#include <Wire.h>
#include <ESP32Servo.h>
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"

// ====================================================================
// VALO PARKING - CỔNG BARRIER THÔNG MINH DUAL-GATE (2 CỔNG ĐỘC LẬP)
// --------------------------------------------------------------------
// • CỔNG VÀO (ENTRY_1) : Servo PIN 13, Cảm biến PIN 19, LCD 1 (SDA 21, SCL 22)
// • CỔNG RA  (EXIT_1)  : Servo PIN 17, Cảm biến PIN 27, LCD 2 (SDA 25, SCL 26)
// ====================================================================

#define ENTRY_SERVO_PIN   13  // GPIO 13 (D13)
#define ENTRY_SENSOR_PIN  19  // GPIO 19 (D19)
#define ENTRY_I2C_SDA     21
#define ENTRY_I2C_SCL     22

#define EXIT_SERVO_PIN    17  // GPIO 17 (D17)
#define EXIT_SENSOR_PIN   27  // GPIO 27 (D27)
#define EXIT_I2C_SDA      25
#define EXIT_I2C_SCL      26

// Khởi tạo 2 bộ I2C phần cứng riêng biệt của ESP32
TwoWire I2C_Entry = TwoWire(0); // Bus 0 cho Cổng Vào (chân 21, 22)
TwoWire I2C_Exit  = TwoWire(1); // Bus 1 cho Cổng Ra  (chân 25, 26)

// ════════════════════════════════════════════════════════════════════
// BỘ ĐIỀU KHIỂN LCD 1602 QUA I2C HỖ TRỢ DUAL-WIRE ĐỘC LẬP
// ════════════════════════════════════════════════════════════════════
class SafeI2CLCD {
private:
  uint8_t _addr;
  uint8_t _cols;
  uint8_t _rows;
  uint8_t _backlight;
  TwoWire* _wire;
  bool _isAvailable;

  void sendNibble(uint8_t nibble, uint8_t mode) {
    if (!_isAvailable) return;
    uint8_t data = (nibble << 4) | _backlight | mode;
    _wire->beginTransmission(_addr);
    _wire->write(data | 0x04); // EN = 1 (Pulse)
    _wire->endTransmission();
    delayMicroseconds(1);
    _wire->beginTransmission(_addr);
    _wire->write(data & ~0x04); // EN = 0
    _wire->endTransmission();
    delayMicroseconds(50);
  }

  void sendByte(uint8_t val, uint8_t mode) {
    sendNibble(val >> 4, mode);
    sendNibble(val & 0x0F, mode);
  }

public:
  SafeI2CLCD(uint8_t addr, uint8_t cols, uint8_t rows, TwoWire* wirePort) {
    _addr = addr;
    _cols = cols;
    _rows = rows;
    _wire = wirePort;
    _backlight = 0x08; // Bật đèn nền (Backlight ON)
    _isAvailable = false;
  }

  bool init() {
    _wire->beginTransmission(_addr);
    if (_wire->endTransmission() != 0) {
      _isAvailable = false;
      return false;
    }
    _isAvailable = true;

    delay(50);
    sendNibble(0x03, 0);
    delay(5);
    sendNibble(0x03, 0);
    delayMicroseconds(150);
    sendNibble(0x03, 0);
    sendNibble(0x02, 0); // Chuyển sang chế độ 4-bit

    sendByte(0x28, 0); // 2 dòng, font 5x8
    sendByte(0x08, 0); // Tắt hiển thị
    clear();
    sendByte(0x06, 0); // Tự động tăng con trỏ
    sendByte(0x0C, 0); // Bật hiển thị, tắt con trỏ nhấp nháy
    return true;
  }

  void clear() {
    if (!_isAvailable) return;
    sendByte(0x01, 0);
    delay(2);
  }

  void setCursor(uint8_t col, uint8_t row) {
    if (!_isAvailable) return;
    uint8_t rowOffsets[] = { 0x00, 0x40 };
    sendByte(0x80 | (col + rowOffsets[row % 2]), 0);
  }

  void print(String str) {
    if (!_isAvailable) return;
    for (unsigned int i = 0; i < str.length(); i++) {
      sendByte(str[i], 1); // mode = 1 (Data)
    }
  }
};

SafeI2CLCD lcdEntry(0x27, 16, 2, &I2C_Entry);
SafeI2CLCD lcdExit(0x27, 16, 2, &I2C_Exit);

// --- ENUM TRẠNG THÁI CỔNG ---
enum GateState {
  GATE_IDLE_CLOSED,
  GATE_OPEN_WAITING,
  GATE_CAR_UNDER,
  GATE_CAR_PASSED,
  GATE_HOLD_MAINTENANCE
};

String cleanAscii(String input) {
  String out = "";
  for (unsigned int i = 0; i < input.length(); i++) {
    char c = input[i];
    if ((uint8_t)c >= 32 && (uint8_t)c <= 126) {
      out += c;
    } else if (c == ' ' || c == '-' || c == ':' || c == '.' || c == '|' || c == '!') {
      out += c;
    }
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════
// CLASS GATE CONTROLLER (CHUẨN GỐC CHECK-IN & TỰ ĐỘNG HIỆU CHỈNH CẢM BIẾN)
// ════════════════════════════════════════════════════════════════════
class GateController {
public:
  String name;
  int servoPin;
  int sensorPin;
  SafeI2CLCD* lcd;
  Servo servo;

  GateState currentState;
  GateState stateBeforePause;
  int currentServoAngle;
  int sensorBaseline;

  unsigned long barrierOpenedAt;
  unsigned long clearDetectionStart;
  unsigned long carPassedAt;
  unsigned long lastSensorLogTime;

  String currentLine1;
  String currentMarqueeMsg;
  int marqueeIndex;
  unsigned long lastMarqueeUpdate;

  GateController(String gateName, int sPin, int irPin, SafeI2CLCD* display) {
    name = gateName;
    servoPin = sPin;
    sensorPin = irPin;
    lcd = display;
    currentState = GATE_IDLE_CLOSED;
    stateBeforePause = GATE_IDLE_CLOSED;
    currentServoAngle = 0;
    sensorBaseline = -1;
    barrierOpenedAt = 0;
    clearDetectionStart = 0;
    carPassedAt = 0;
    lastSensorLogTime = 0;
    marqueeIndex = 0;
    lastMarqueeUpdate = 0;
  }

  void init() {
    pinMode(sensorPin, INPUT_PULLUP);

    servo.setPeriodHertz(50);
    servo.attach(servoPin, 500, 2400);
    servo.write(0);
    currentServoAngle = 0;
    currentState = GATE_IDLE_CLOSED;
    stateBeforePause = GATE_IDLE_CLOSED;
    sensorBaseline = -1;

    Serial.printf("[ESP32] >> Khoi tao Cổng %s (Servo Pin %d, Sensor Pin %d) -> SAN SANG!\n", 
                  name.c_str(), servoPin, sensorPin);

    if (name == "ENTRY_1") {
      setMarqueeContent(" VALO - CONG VAO", "WELCOME TO VALO PARKING - HAVE A GREAT DAY!");
    } else {
      setMarqueeContent("  VALO - CONG RA ", "THANK YOU - SEE YOU AGAIN - HAVE A SAFE TRIP!");
    }
  }

  void setMarqueeContent(String line1, String marqueeMsg) {
    currentLine1 = cleanAscii(line1);
    while (currentLine1.length() < 16) currentLine1 += " ";
    if (currentLine1.length() > 16) currentLine1 = currentLine1.substring(0, 16);

    currentMarqueeMsg = "   " + cleanAscii(marqueeMsg) + "   ";
    marqueeIndex = 0;
    lastMarqueeUpdate = 0;

    if (lcd) {
      lcd->clear();
      lcd->setCursor(0, 0);
      lcd->print(currentLine1);
    }
  }

  void open(String line1, String marqueeText) {
    if (currentState != GATE_IDLE_CLOSED && currentState != GATE_HOLD_MAINTENANCE) return;

    setMarqueeContent(line1, marqueeText);
    Serial.printf("[ESP32] >> BAT DAU NANG CAN %s (90 DO) TAI PIN %d...\n", name.c_str(), servoPin);

    if (!servo.attached()) {
      servo.attach(servoPin, 500, 2400);
    }
    for (int angle = currentServoAngle; angle <= 90; angle += 5) {
      servo.write(angle);
      currentServoAngle = angle;
      delay(15);
    }
    servo.write(90);
    currentServoAngle = 90;
    delay(150);

    currentState = GATE_OPEN_WAITING;
    barrierOpenedAt = millis();
    clearDetectionStart = 0;
    carPassedAt = 0;
    sensorBaseline = -1; // Sẽ tự động lấy mẫu mức chuẩn khi chưa có xe
    lastSensorLogTime = millis();

    Serial.printf("[ESP32] >> %s DA MO! DANG CHO XE DI QUA CAM BIEN (PIN %d)...\n", name.c_str(), sensorPin);
  }

  void pause() {
    if (currentState != GATE_HOLD_MAINTENANCE) {
      stateBeforePause = currentState;
    }
    currentState = GATE_HOLD_MAINTENANCE;
    setMarqueeContent("  VALO PARKING  ", "* DANG TAM DUNG CONG (TAT CAM BIEN) *");
    Serial.printf("[ESP32] >> BAT CHE DO TAM DUNG %s (VO HIEU HOA CAM BIEN)!\n", name.c_str());
  }

  void resume() {
    Serial.printf("[ESP32] >> TIEP TUC HOAT DONG %s...\n", name.c_str());
    if (currentState == GATE_HOLD_MAINTENANCE) {
      if (currentServoAngle == 0 || stateBeforePause == GATE_IDLE_CLOSED) {
        currentState = GATE_IDLE_CLOSED;
        if (name == "ENTRY_1") {
          setMarqueeContent(" VALO - CONG VAO", "WELCOME TO VALO PARKING - HAVE A SAFE DRIVE!");
        } else {
          setMarqueeContent("  VALO - CONG RA ", "THANK YOU - SEE YOU AGAIN - HAVE A SAFE TRIP!");
        }
      } else {
        if (!servo.attached()) {
          servo.attach(servoPin, 500, 2400);
        }
        for (int angle = currentServoAngle; angle <= 90; angle += 5) {
          servo.write(angle);
          currentServoAngle = angle;
          delay(15);
        }
        servo.write(90);
        currentServoAngle = 90;
        delay(150);
        currentState = GATE_OPEN_WAITING;
        barrierOpenedAt = millis();
        setMarqueeContent("  VALO PARKING  ", "TIEP TUC HOAT DONG - VALO PARKING");
      }
    }
  }

  void close() {
    if (currentState == GATE_IDLE_CLOSED) return;

    if (lcd) {
      lcd->clear();
      lcd->setCursor(0, 0);
      lcd->print("  VALO PARKING  ");
      lcd->setCursor(0, 1);
      lcd->print(" DANG DONG CONG ");
    }

    Serial.printf("[ESP32] >> BAT DAU HA CAN %s (0 DO) TAI PIN %d...\n", name.c_str(), servoPin);

    if (!servo.attached()) {
      servo.attach(servoPin, 500, 2400);
    }
    for (int angle = currentServoAngle; angle >= 0; angle -= 5) {
      servo.write(angle);
      currentServoAngle = angle;
      delay(15);
    }
    servo.write(0);
    currentServoAngle = 0;
    delay(150);

    currentState = GATE_IDLE_CLOSED;

    Serial.printf("[ESP32] >> %s DA DONG HOAN TOAN!\n", name.c_str());
    Serial.printf("GATE_CLOSED_%s\n", name.c_str());
    if (name == "ENTRY_1") {
      Serial.println("GATE_CLOSED");
    }

    delay(200);
    if (name == "ENTRY_1") {
      setMarqueeContent(" VALO - CONG VAO", "WELCOME TO VALO PARKING - HAVE A SAFE DRIVE!");
    } else {
      setMarqueeContent("  VALO - CONG RA ", "THANK YOU - SEE YOU AGAIN - HAVE A SAFE TRIP!");
    }
  }

  // Chế độ tự kiểm tra khi cắm USB / Khởi động: Mở 90 độ -> Giữ 600ms -> Đóng 0 độ
  void selfTest() {
    if (lcd) {
      lcd->clear();
      lcd->setCursor(0, 0);
      lcd->print(name == "ENTRY_1" ? "  VALO - ENTRY  " : "  VALO - EXIT   ");
      lcd->setCursor(0, 1);
      lcd->print("* SELF-TEST ON *");
    }

    Serial.printf("🔧 [ESP32 SELF-TEST] >> DANG KIEM TRA %s (Servo PIN %d)...\n", name.c_str(), servoPin);

    if (!servo.attached()) {
      servo.attach(servoPin, 500, 2400);
    }
    
    // Mở cần lên 90 độ mượt mà
    for (int angle = 0; angle <= 90; angle += 5) {
      servo.write(angle);
      currentServoAngle = angle;
      delay(15);
    }
    servo.write(90);
    currentServoAngle = 90;
    delay(600); // Giữ cần mở 600ms để quan sát trực quan

    // Đóng cần về 0 độ mượt mà
    for (int angle = 90; angle >= 0; angle -= 5) {
      servo.write(angle);
      currentServoAngle = angle;
      delay(15);
    }
    servo.write(0);
    currentServoAngle = 0;
    delay(200);

    currentState = GATE_IDLE_CLOSED;
    Serial.printf("✅ [ESP32 SELF-TEST] >> %s HOAT DONG TOT (0 -> 90 -> 0 DO)!\n", name.c_str());

    // Khởi tạo lại màn hình chữ chạy mặc định
    if (name == "ENTRY_1") {
      setMarqueeContent(" VALO - CONG VAO", "WELCOME TO VALO PARKING - HAVE A GREAT DAY!");
    } else {
      setMarqueeContent("  VALO - CONG RA ", "THANK YOU - SEE YOU AGAIN - HAVE A SAFE TRIP!");
    }
  }

  void handleMarquee() {
    if (!lcd) return;
    int msgLen = currentMarqueeMsg.length();
    if (msgLen < 16) {
      lcd->setCursor(0, 1);
      lcd->print(currentMarqueeMsg);
      return;
    }

    if (millis() - lastMarqueeUpdate >= 250) {
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

  void update() {
    handleMarquee();

    if (currentState != GATE_IDLE_CLOSED && currentState != GATE_HOLD_MAINTENANCE) {
      // Đợi 800ms sau khi mở để triệt tiêu dao động cơ học ban đầu
      if (millis() - barrierOpenedAt >= 800) {
        int pinVal = digitalRead(sensorPin);

        // Tự động thiết lập mức chuẩn thông thoáng ban đầu khi chưa có xe
        if (sensorBaseline == -1) {
          sensorBaseline = pinVal;
          Serial.printf("   🎯 [%s - SENSOR PIN %d]: Da xac lap muc chuan thong thoang = %d\n",
                        name.c_str(), sensorPin, sensorBaseline);
        }

        // CÓ VẬT CẢN (XE QUA) = Khi mức điện áp thay đổi khác mức thông thoáng chuẩn
        bool isObstacle = (pinVal != sensorBaseline);

        // In log định kỳ mỗi 1.5 giây để theo dõi
        if (millis() - lastSensorLogTime >= 1500) {
          lastSensorLogTime = millis();
          const char* stateStr = "CHO XE QUA";
          if (currentState == GATE_CAR_UNDER) stateStr = "XE DANG DUOI CONG (GIU MO 100%)";
          else if (currentState == GATE_CAR_PASSED) stateStr = "XE DA QUA - DANG DEM 1S DONG";

          Serial.printf("   [%s - SENSOR PIN %d]: Muc=%d (Chuan=%d) | VatCan=%s | TT=%s\n",
                        name.c_str(), sensorPin, pinVal, sensorBaseline, isObstacle ? "CO" : "KHONG", stateStr);
        }

        // ── GIAI ĐOẠN 1: Cổng đang mở, chờ xe tiến vào che tia hồng ngoại ──
        if (currentState == GATE_OPEN_WAITING) {
          if (isObstacle) {
            currentState = GATE_CAR_UNDER;
            clearDetectionStart = 0;
            Serial.printf("\n🚗 [%s-SENSOR] >> ĐÃ CẮT TIA HỒNG NGOẠI: XE ĐANG QUA CỔNG!\n", name.c_str());
          } else {
            // Timeout 30s an toàn nếu mở cổng nhưng không có xe nào đi vào
            if (millis() - barrierOpenedAt >= 30000) {
              Serial.printf("\n⏳ [%s] >> HET 30S KHONG CO XE -> TU DONG DONG CONG AN TOAN!\n", name.c_str());
              close();
            }
          }
        }

        // ── GIAI ĐOẠN 2: Xe đang ở dưới thanh chắn -> chờ xe đi qua hẳn (hết che tia) ──
        else if (currentState == GATE_CAR_UNDER) {
          if (!isObstacle) {
            // Khi rút tay ra / xe qua khỏi -> yêu cầu thông thoáng liên tục 80ms
            if (clearDetectionStart == 0) {
              clearDetectionStart = millis();
            } else if (millis() - clearDetectionStart >= 80) {
              currentState = GATE_CAR_PASSED;
              carPassedAt = millis();
              Serial.printf("\n✅ [%s-SENSOR] >> XE ĐÃ QUA KHỎI TIA HỒNG NGOẠI! ĐÓNG SAU 1 GIÂY...\n", name.c_str());
            }
          } else {
            // CHỪNG NÀO CÒN VẬT CẢN CHE TIA -> LUÔN RESET BỘ ĐẾM THÔNG THOÁNG VỀ 0
            // KHÔNG BAO GIỜ TỰ ĐỘNG ĐÓNG DÙ CHE BAO LÂU!
            clearDetectionStart = 0;
          }
        }

        // ── GIAI ĐOẠN 3: Xe đã qua khỏi -> đợi đúng 1.0 giây thông thoáng -> đóng barrier ──
        else if (currentState == GATE_CAR_PASSED) {
          if (isObstacle) {
            // NẾU CÓ VẬT CẢN TRỞ LẠI TRONG LÚC ĐANG ĐẾM 1S:
            currentState = GATE_CAR_UNDER;
            clearDetectionStart = 0;
            Serial.printf("\n⚠️ [%s-SENSOR] >> CÓ VẬT CẢN TRỞ LẠI -> GIỮ NGUYÊN CỔNG MỞ AN TOÀN!\n", name.c_str());
          } else if (millis() - carPassedAt >= 1000) {
            Serial.printf("\n🔒 [%s] >> XE DA QUA HOAN TAT -> TIẾN HÀNH ĐÓNG CỔNG BARRIER!\n", name.c_str());
            close();
          }
        }
      }
    }
  }
};

GateController entryGate("ENTRY_1", ENTRY_SERVO_PIN, ENTRY_SENSOR_PIN, &lcdEntry);
GateController exitGate("EXIT_1", EXIT_SERVO_PIN, EXIT_SENSOR_PIN, &lcdExit);

// ════════════════════════════════════════════════════════════════════
// SETUP
// ════════════════════════════════════════════════════════════════════
void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

  Serial.begin(115200);
  Serial.setTimeout(50);
  delay(300);

  Serial.println("\n=======================================================");
  Serial.println("🚗 VALO PARKING - ESP32 DUAL-GATE CONTROLLER 🚗");
  Serial.println("=======================================================");

  // 1. Khởi tạo 2 bus I2C độc lập cho 2 LCD
  I2C_Entry.begin(ENTRY_I2C_SDA, ENTRY_I2C_SCL, 100000);
  I2C_Exit.begin(EXIT_I2C_SDA, EXIT_I2C_SCL, 100000);
  delay(150);

  lcdEntry.init();
  lcdExit.init();

  // 2. Cấp phát tất cả 4 Timer PWM cho ESP32Servo
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);

  // 3. Khởi tạo 2 cổng
  entryGate.init();
  exitGate.init();

  // 4. TỰ ĐỘNG CHẠY SELF-TEST LẦN LƯỢT 2 CỔNG KHI CẮM NGUỒN USB
  Serial.println("\n=======================================================");
  Serial.println("🔧 [ESP32 SELF-TEST] >> BAT DAU KIEM TRA 2 CONG...");
  Serial.println("=======================================================");

  entryGate.selfTest();
  delay(300);
  exitGate.selfTest();

  Serial.println("\n🎉 [ESP32 SELF-TEST] >> TOAN BO 2 CONG DUAL-GATE SAN SANG!");
  Serial.println("ESP32_BARRIER_READY");
}

// ════════════════════════════════════════════════════════════════════
// LOOP CHÍNH
// ════════════════════════════════════════════════════════════════════
void loop() {
  entryGate.update();
  exitGate.update();

  if (Serial.available() > 0) {
    String command = Serial.readStringUntil('\n');
    command.trim();
    if (command.length() == 0) return;

    Serial.println("[ESP32 REC]: " + command);

    bool isExit = (command.indexOf("EXIT") != -1 || command.indexOf("CHECKOUT") != -1);
    GateController& targetGate = isExit ? exitGate : entryGate;

    if (command.startsWith("HOLD") || command.startsWith("PAUSE")) {
      targetGate.pause();
    }
    else if (command.startsWith("RESUME")) {
      targetGate.resume();
    }
    else if (command.startsWith("OPEN")) {
      String plate = "";
      String slot = "";
      String gate = isExit ? "EXIT_1" : "ENTRY_1";

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

      String line1 = isExit ? "RA: " + plate : "VAO: " + plate;
      String scrollMsg = "WELCOME TO VALO PARKING!";

      if (isExit) {
        scrollMsg = "TAM BIET QUY KHACH - CHUC BAN THUONG LO BINH AN - HEN GAP LAI!";
      } else {
        if (slot.length() > 0 && slot != "STAFF" && slot != "N/A") {
          scrollMsg = "XIN CHAO! O DO CUA BAN LA: " + slot + " - VUI LONG DO DUNG VI TRI - CHUC MOT NGAY TOT LANH!";
        } else {
          scrollMsg = "XIN CHAO QUY KHACH - MO CONG CHECK-IN - CHUC MOT NGAY TOT LANH!";
        }
      }

      if (plate.length() == 0) {
        line1 = isExit ? "  VALO - CONG RA " : " VALO - CONG VAO";
      }

      if (gate.indexOf("EXIT") != -1) {
        exitGate.open(line1, scrollMsg);
      } else {
        entryGate.open(line1, scrollMsg);
      }
    }
    else if (command.startsWith("CHECKIN")) {
      entryGate.open("  XIN CHAO!  ", "CHAO MUNG DEN VALO PARKING - MO CONG CHECK-IN");
    }
    else if (command.startsWith("CHECKOUT")) {
      exitGate.open("  TAM BIET!  ", "TAM BIET QUY KHACH - CHUC BAN THUONG LO BINH AN - HEN GAP LAI!");
    }
    else if (command.startsWith("FORCE_CLOSE") || command.startsWith("CLOSE")) {
      targetGate.close();
    }
  }
}