#include "soc/rtc_cntl_reg.h"
#include "soc/soc.h"
#include <ESP32Servo.h>
#include <Wire.h>

// ====================================================================
// VALO PARKING - CỔNG BARRIER THÔNG MINH DUAL-GATE (2 CỔNG ĐỘC LẬP)
// --------------------------------------------------------------------
// • CỔNG VÀO (ENTRY_1) : Servo PIN 13, Cảm biến PIN 19, LCD 1 (SDA 21, SCL 22)
// • CỔNG RA  (EXIT_1)  : Servo PIN 17, Cảm biến PIN 27, LCD 2 (SDA 25, SCL 26)
// ====================================================================

#define ENTRY_SERVO_PIN 13  // GPIO 13 (D13)
#define ENTRY_SENSOR_PIN 19 // GPIO 19 (D19)
#define ENTRY_I2C_SDA 21
#define ENTRY_I2C_SCL 22

#define EXIT_SERVO_PIN 17  // GPIO 17 (D17)
#define EXIT_SENSOR_PIN 27 // GPIO 27 (D27)
#define EXIT_I2C_SDA 25
#define EXIT_I2C_SCL 26

// Khởi tạo 2 bộ I2C phần cứng riêng biệt của ESP32
TwoWire I2C_Entry = TwoWire(0); // Bus 0 cho Cổng Vào (chân 21, 22)
TwoWire I2C_Exit = TwoWire(1);  // Bus 1 cho Cổng Ra  (chân 25, 26)

// ════════════════════════════════════════════════════════════════════
// BỘ ĐIỀU KHIỂN LCD 1602 QUA I2C HỖ TRỢ DUAL-WIRE ĐỘC LẬP
// ════════════════════════════════════════════════════════════════════
class SafeI2CLCD {
private:
  uint8_t _addr;
  uint8_t _cols;
  uint8_t _rows;
  uint8_t _backlight;
  TwoWire *_wire;
  bool _isAvailable;

  void sendNibble(uint8_t nibble, uint8_t mode) {
    if (!_isAvailable)
      return;
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
  SafeI2CLCD(uint8_t addr, uint8_t cols, uint8_t rows, TwoWire *wirePort) {
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
    if (!_isAvailable)
      return;
    sendByte(0x01, 0);
    delay(2);
  }

  void setCursor(uint8_t col, uint8_t row) {
    if (!_isAvailable)
      return;
    uint8_t rowOffsets[] = {0x00, 0x40};
    sendByte(0x80 | (col + rowOffsets[row % 2]), 0);
  }

  void print(String str) {
    if (!_isAvailable)
      return;
    for (unsigned int i = 0; i < str.length(); i++) {
      sendByte(str[i], 1); // mode = 1 (Data)
    }
  }
};

SafeI2CLCD lcdEntry(0x27, 16, 2, &I2C_Entry);
SafeI2CLCD lcdExit(0x27, 16, 2, &I2C_Exit);

// ====================================================================
// CẤU HÌNH CHO MÀN HÌNH LCD THỨ 3 (BẢNG HIỂN THỊ CÔNG SUẤT BÃI XE)
// ====================================================================
#define CAPACITY_I2C_SDA 32    // GPIO 32 (D32)
#define CAPACITY_I2C_SCL 33    // GPIO 33 (D33)
#define CAPACITY_I2C_ADDR 0x27 // Địa chỉ I2C mặc định (0x27 hoặc 0x3F)

#define SENSOR_AUTO_DETECT -1

// ════════════════════════════════════════════════════════════════════
// BỘ ĐIỀU KHIỂN LCD 1602 SOFTWARE I2C CHO MÀN HÌNH THỨ 3 (PIN 32, 33)
// Chuẩn xung clock, hỗ trợ Auto-Detect 0x27 / 0x3F, triệt tiêu nhiễu ký tự lạ
// ════════════════════════════════════════════════════════════════════
class SoftSafeI2CLCD {
private:
  uint8_t _addr;
  int _sda;
  int _scl;
  uint8_t _backlight;
  bool _isAvailable;

  void i2cDelay() { delayMicroseconds(8); } // Tần số ~60kHz ổn định, sườn xung vuông sạch

  void sdaHigh() {
    pinMode(_sda, OUTPUT);
    digitalWrite(_sda, HIGH);
  }
  void sdaLow() {
    pinMode(_sda, OUTPUT);
    digitalWrite(_sda, LOW);
  }
  void sclHigh() {
    pinMode(_scl, OUTPUT);
    digitalWrite(_scl, HIGH);
  }
  void sclLow() {
    pinMode(_scl, OUTPUT);
    digitalWrite(_scl, LOW);
  }

  void i2cStart() {
    sdaHigh();
    sclHigh();
    i2cDelay();
    sdaLow();
    i2cDelay();
    sclLow();
    i2cDelay();
  }

  void i2cStop() {
    sdaLow();
    sclHigh();
    i2cDelay();
    sdaHigh();
    i2cDelay();
  }

  bool i2cWriteByte(uint8_t data) {
    for (int i = 0; i < 8; i++) {
      if (data & 0x80)
        sdaHigh();
      else
        sdaLow();
      data <<= 1;
      i2cDelay();
      sclHigh();
      i2cDelay();
      sclLow();
      i2cDelay();
    }
    // Đọc xung ACK từ PCF8574
    pinMode(_sda, INPUT_PULLUP);
    i2cDelay();
    sclHigh();
    i2cDelay();
    bool ack = (digitalRead(_sda) == LOW);
    sclLow();
    i2cDelay();
    pinMode(_sda, OUTPUT);
    return ack;
  }

  void writeExpander(uint8_t data) {
    i2cStart();
    i2cWriteByte(_addr << 1);
    i2cWriteByte(data);
    i2cStop();
  }

  void sendNibble(uint8_t nibble, uint8_t mode) {
    if (!_isAvailable)
      return;
    uint8_t data = (nibble << 4) | _backlight | mode;
    // 1. Setup dữ liệu trước khi kéo EN lên (HD44780 tAS > 140ns)
    writeExpander(data);
    delayMicroseconds(2);
    // 2. Kéo xung EN = 1 (HD44780 pulse width > 450ns)
    writeExpander(data | 0x04);
    delayMicroseconds(4);
    // 3. Hạ EN = 0 để chốt dữ liệu (Falling edge latch)
    writeExpander(data & ~0x04);
    delayMicroseconds(50);
  }

  void sendByte(uint8_t val, uint8_t mode) {
    sendNibble(val >> 4, mode);
    sendNibble(val & 0x0F, mode);
  }

public:
  SoftSafeI2CLCD(uint8_t addr, int sdaPin, int sclPin) {
    _addr = addr;
    _sda = sdaPin;
    _scl = sclPin;
    _backlight = 0x08;
    _isAvailable = false;
  }

  bool testAddress(uint8_t addr) {
    i2cStart();
    bool ack = i2cWriteByte(addr << 1);
    i2cStop();
    return ack;
  }

  bool init() {
    pinMode(_sda, OUTPUT);
    pinMode(_scl, OUTPUT);
    digitalWrite(_sda, HIGH);
    digitalWrite(_scl, HIGH);
    delay(50);

    // Tự động kiểm tra địa chỉ 0x27 hoặc 0x3F cho module PCF8574
    if (testAddress(0x27)) {
      _addr = 0x27;
      _isAvailable = true;
    } else if (testAddress(0x3F)) {
      _addr = 0x3F;
      _isAvailable = true;
    } else {
      _addr = CAPACITY_I2C_ADDR;
      _isAvailable = true;
    }

    delay(60);
    // Chu kỳ khởi tạo 4-bit tiêu chuẩn HD44780 chống lệch Nibble
    sendNibble(0x03, 0);
    delay(5);
    sendNibble(0x03, 0);
    delayMicroseconds(150);
    sendNibble(0x03, 0);
    delayMicroseconds(150);
    sendNibble(0x02, 0); // Chuyển sang 4-bit mode

    sendByte(0x28, 0); // 2 dòng, font 5x8
    delayMicroseconds(50);
    sendByte(0x08, 0); // Tắt màn hình
    delayMicroseconds(50);
    clear();           // Xoá màn hình sạch sẽ
    sendByte(0x06, 0); // Auto increment
    delayMicroseconds(50);
    sendByte(0x0C, 0); // Bật hiển thị, tắt cursor
    delayMicroseconds(50);
    return true;
  }

  void clear() {
    if (!_isAvailable)
      return;
    sendByte(0x01, 0);
    delay(3);
  }

  void setCursor(uint8_t col, uint8_t row) {
    if (!_isAvailable)
      return;
    uint8_t rowOffsets[] = {0x00, 0x40};
    sendByte(0x80 | (col + rowOffsets[row % 2]), 0);
    delayMicroseconds(50);
  }

  void print(String str) {
    if (!_isAvailable)
      return;
    for (unsigned int i = 0; i < str.length(); i++) {
      sendByte((uint8_t)str[i], 1);
    }
  }
};

SoftSafeI2CLCD lcdCapacity(CAPACITY_I2C_ADDR, CAPACITY_I2C_SDA,
                           CAPACITY_I2C_SCL);

// ════════════════════════════════════════════════════════════════════
// QUẢN LÝ MÀN HÌNH LCD THỨ 3: BẢNG CÔNG SUẤT BÃI XE
// ════════════════════════════════════════════════════════════════════
class CapacityDisplayManager {
public:
  SoftSafeI2CLCD *lcd;
  int availableSlots;
  int occupiedSlots;
  int totalSlots;
  bool isFull;
  unsigned long lastBlinkTime;
  bool blinkState;

  CapacityDisplayManager(SoftSafeI2CLCD *display) {
    lcd = display;
    availableSlots = -1;
    occupiedSlots = -1;
    totalSlots = -1;
    isFull = false;
    lastBlinkTime = 0;
    blinkState = false;
  }

  void init() {
    if (lcd) {
      lcd->init();
      lcd->clear();
      lcd->setCursor(0, 0);
      lcd->print("  VALO PARKING  ");
      lcd->setCursor(0, 1);
      lcd->print("* CONNECTING... *");
    }
    Serial.printf("[ESP32] >> Khoi tao LCD 3 Bảng Công Suất (SDA Pin %d, SCL "
                  "Pin %d) -> SAN SANG!\n",
                  CAPACITY_I2C_SDA, CAPACITY_I2C_SCL);
  }

  void selfTest() {
    if (lcd) {
      lcd->clear();
      lcd->setCursor(0, 0);
      lcd->print(" VALO - DISPLAY ");
      lcd->setCursor(0, 1);
      lcd->print("* SELF-TEST ON *");
      delay(600);
      render();
    }
    Serial.println(
        "✅ [ESP32 SELF-TEST] >> LCD 3 Bang Cong Suat HOAT DONG TOT!");
  }

  void update(int avail, int occ, int total) {
    // Nếu dữ liệu không thay đổi -> không cần vẽ lại để triệt tiêu hoàn toàn
    // hiện tượng nhấp nháy màn hình
    if (avail == availableSlots && occ == occupiedSlots &&
        total == totalSlots) {
      return;
    }
    availableSlots = avail;
    occupiedSlots = occ;
    totalSlots = total;
    isFull = (avail <= 0 && total > 0);
    render();
  }

  void render() {
    if (!lcd)
      return;

    lcd->clear();
    delay(2);

    if (availableSlots < 0) {
      lcd->setCursor(0, 0);
      lcd->print("  VALO PARKING  ");
      lcd->setCursor(0, 1);
      lcd->print("* SYNCING DATA *");
      return;
    }

    if (isFull) {
      lcd->setCursor(0, 0);
      lcd->print("  VALO PARKING  ");
      lcd->setCursor(0, 1);
      lcd->print("*  LOT IS FULL *");
    } else {
      // Dòng 1: VALO: 24/27 FREE
      String line1 = "VALO: " + String(availableSlots) + "/" +
                     String(totalSlots) + " FREE";
      while (line1.length() < 16)
        line1 += " ";
      if (line1.length() > 16)
        line1 = line1.substring(0, 16);

      // Dòng 2: AVAIL:24 | OCC: 3
      String line2 =
          "AVAIL:" + String(availableSlots) + " | OCC:" + String(occupiedSlots);
      while (line2.length() < 16)
        line2 += " ";
      if (line2.length() > 16)
        line2 = line2.substring(0, 16);

      lcd->setCursor(0, 0);
      lcd->print(line1);
      lcd->setCursor(0, 1);
      lcd->print(line2);
    }
  }

  void updateBlink() {
    if (!isFull || !lcd)
      return;
    if (millis() - lastBlinkTime >= 700) {
      lastBlinkTime = millis();
      blinkState = !blinkState;
      lcd->setCursor(0, 1);
      if (blinkState) {
        lcd->print("*  LOT IS FULL *");
      } else {
        lcd->print("                ");
      }
    }
  }
};

CapacityDisplayManager capacityDisplay(&lcdCapacity);

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
    } else if (c == ' ' || c == '-' || c == ':' || c == '.' || c == '|' ||
               c == '!') {
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
  SafeI2CLCD *lcd;
  Servo servo;

  GateState currentState;
  GateState stateBeforePause;
  int currentServoAngle;

  int configuredObstacleLevel; // Cấu hình ban đầu: LOW, HIGH hoặc SENSOR_AUTO_DETECT (-1)
  int activeObstacleLevel;     // Mức logic thực tế khi có vật cản (tự động nhận dạng)
  int sensorBaseline;          // Mức logic khi cổng đóng (thông thoáng)
  int lastRawSensor;           // Lưu giá trị gần nhất khi test lúc cổng đóng

  unsigned long barrierOpenedAt;
  unsigned long clearDetectionStart;
  unsigned long carPassedAt;
  unsigned long lastSensorLogTime;

  String currentLine1;
  String currentMarqueeMsg;
  int marqueeIndex;
  unsigned long lastMarqueeUpdate;

  GateController(String gateName, int sPin, int irPin, int obstLevel,
                 SafeI2CLCD *display) {
    name = gateName;
    servoPin = sPin;
    sensorPin = irPin;
    configuredObstacleLevel = obstLevel;
    activeObstacleLevel = obstLevel;
    lcd = display;
    currentState = GATE_IDLE_CLOSED;
    stateBeforePause = GATE_IDLE_CLOSED;
    currentServoAngle = 0;
    sensorBaseline = -1;
    lastRawSensor = -1;
    barrierOpenedAt = 0;
    clearDetectionStart = 0;
    carPassedAt = 0;
    lastSensorLogTime = 0;
    marqueeIndex = 0;
    lastMarqueeUpdate = 0;
  }

  void calibrateSensor() {
    if (configuredObstacleLevel != SENSOR_AUTO_DETECT) {
      activeObstacleLevel = configuredObstacleLevel;
      sensorBaseline = (activeObstacleLevel == LOW) ? HIGH : LOW;
      Serial.printf("🎯 [ESP32 CHUẨN CẢM BIẾN] %s (Pin %d): MUC CO XE = %d (%s) | Thong thoang = %d\n",
                    name.c_str(), sensorPin, activeObstacleLevel,
                    (activeObstacleLevel == LOW) ? "Active LOW (0V khi che)" : "Active HIGH (3.3V khi che)",
                    sensorBaseline);
      return;
    }

    // Nếu để tự động: Đọc liên tiếp 8 mẫu khi cổng đóng để xác định mức thông thoáng chuẩn (Baseline)
    int countHigh = 0;
    for (int i = 0; i < 8; i++) {
      if (digitalRead(sensorPin) == HIGH)
        countHigh++;
      delay(5);
    }
    sensorBaseline = (countHigh >= 4) ? HIGH : LOW;

    activeObstacleLevel = (sensorBaseline == HIGH) ? LOW : HIGH;

    Serial.printf("🎯 [ESP32 AUTO-SENSOR] %s (Pin %d): Luc thong thoang = %d -> MUC CO XE = %d (%s)\n",
                  name.c_str(), sensorPin, sensorBaseline, activeObstacleLevel,
                  (activeObstacleLevel == LOW) ? "Active LOW (0V khi che)" : "Active HIGH (3.3V khi che)");
  }

  void init() {
    pinMode(sensorPin, INPUT_PULLUP);
    delay(20);
    calibrateSensor();
    lastRawSensor = digitalRead(sensorPin);

    servo.setPeriodHertz(50);
    servo.attach(servoPin, 500, 2400);
    servo.write(0);
    currentServoAngle = 0;
    currentState = GATE_IDLE_CLOSED;
    stateBeforePause = GATE_IDLE_CLOSED;

    Serial.printf("[ESP32] >> Khoi tao Cổng %s (Servo Pin %d, Sensor Pin %d) "
                  "-> SAN SANG!\n",
                  name.c_str(), servoPin, sensorPin);

    if (name == "ENTRY_1") {
      setMarqueeContent("  VALO - ENTRY  ",
                        "WELCOME TO VALO PARKING - HAVE A SAFE DRIVE!");
    } else {
      setMarqueeContent("  VALO - EXIT   ",
                        "THANK YOU - SEE YOU AGAIN - HAVE A SAFE TRIP!");
    }
  }

  void setMarqueeContent(String line1, String marqueeMsg) {
    currentLine1 = cleanAscii(line1);
    while (currentLine1.length() < 16)
      currentLine1 += " ";
    if (currentLine1.length() > 16)
      currentLine1 = currentLine1.substring(0, 16);

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
    setMarqueeContent(line1, marqueeText);

    // Nếu cần đã mở 90 độ và đang chờ xe qua, chỉ cần cập nhật nội dung màn
    // hình và làm mới thời gian chờ
    if (currentState == GATE_OPEN_WAITING && currentServoAngle >= 90) {
      barrierOpenedAt = millis();
      clearDetectionStart = 0;
      carPassedAt = 0;
      Serial.printf(
          "[ESP32] >> %s DANG MO SAN (90 DO) -> CAP NHAT THONG TIN XE MOI!\n",
          name.c_str());
      return;
    }

    Serial.printf("[ESP32] >> BAT DAU NANG CAN %s (90 DO) TAI PIN %d...\n",
                  name.c_str(), servoPin);

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
    lastSensorLogTime = millis();

    Serial.printf(
        "[ESP32] >> %s DA MO! DANG CHO XE DI QUA CAM BIEN (PIN %d)...\n",
        name.c_str(), sensorPin);
  }

  void pause() {
    if (currentState != GATE_HOLD_MAINTENANCE) {
      stateBeforePause = currentState;
    }
    currentState = GATE_HOLD_MAINTENANCE;
    setMarqueeContent("  VALO PARKING  ", "* GATE PAUSED (MAINTENANCE) *");
    Serial.printf("[ESP32] >> BAT CHE DO TAM DUNG %s (VO HIEU HOA CAM BIEN)!\n",
                  name.c_str());
  }

  void resume() {
    Serial.printf("[ESP32] >> TIEP TUC HOAT DONG %s...\n", name.c_str());
    if (currentState == GATE_HOLD_MAINTENANCE) {
      if (currentServoAngle == 0 || stateBeforePause == GATE_IDLE_CLOSED) {
        currentState = GATE_IDLE_CLOSED;
        if (name == "ENTRY_1") {
          setMarqueeContent("  VALO - ENTRY  ",
                            "WELCOME TO VALO PARKING - HAVE A SAFE DRIVE!");
        } else {
          setMarqueeContent("  VALO - EXIT   ",
                            "THANK YOU - SEE YOU AGAIN - HAVE A SAFE TRIP!");
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
        setMarqueeContent("  VALO PARKING  ", "GATE RESUMED - VALO PARKING");
      }
    }
  }

  void close(bool isManual = false) {
    if (currentState == GATE_IDLE_CLOSED && currentServoAngle == 0)
      return;

    if (lcd) {
      lcd->clear();
      lcd->setCursor(0, 0);
      lcd->print("  VALO PARKING  ");
      lcd->setCursor(0, 1);
      lcd->print("  CLOSING GATE  ");
    }

    Serial.printf(
        "[ESP32] >> BAT DAU HA CAN %s (0 DO) TAI PIN %d (Manual=%s)...\n",
        name.c_str(), servoPin, isManual ? "YES" : "NO");

    if (!servo.attached()) {
      servo.attach(servoPin, 500, 2400);
    }
    for (int angle = currentServoAngle; angle >= 0; angle -= 5) {
      // 🚗 CHỐNG KẸT XE TỰ ĐỘNG ĐẢO CHIỀU:
      // CHỈ kích hoạt khi đóng tự động (isManual == false).
      // Khi người dùng / admin chủ động bấm nút đóng cổng (isManual == true),
      // luôn hạ cần dứt khoát!
      if (!isManual && digitalRead(sensorPin) == activeObstacleLevel) {
        Serial.printf("\n🚨 [%s-CHỐNG KẸT] >> PHÁT HIỆN VẬT CẢN KHI ĐANG HẠ "
                      "CẦN! ĐẢO CHIỀU MỞ CẤP TỐC 90 ĐỘ!\n",
                      name.c_str());
        servo.write(90);
        currentServoAngle = 90;
        currentState = GATE_CAR_UNDER;
        clearDetectionStart = 0;
        if (lcd) {
          lcd->setCursor(0, 1);
          lcd->print(" OBSTACLE ALERT ");
        }
        return;
      }
      servo.write(angle);
      currentServoAngle = angle;
      delay(15);
    }
    servo.write(0);
    currentServoAngle = 0;
    delay(150);

    currentState = GATE_IDLE_CLOSED;
    clearDetectionStart = 0;
    carPassedAt = 0;

    Serial.printf("[ESP32] >> %s DA DONG HOAN TOAN!\n", name.c_str());
    Serial.printf("GATE_CLOSED_%s\n", name.c_str());
    if (name == "ENTRY_1") {
      Serial.println("GATE_CLOSED");
    }

    delay(200);
    if (name == "ENTRY_1") {
      setMarqueeContent("  VALO - ENTRY  ",
                        "WELCOME TO VALO PARKING - HAVE A SAFE DRIVE!");
    } else {
      setMarqueeContent("  VALO - EXIT   ",
                        "THANK YOU - SEE YOU AGAIN - HAVE A SAFE TRIP!");
    }
  }

  // Chế độ tự kiểm tra khi cắm USB / Khởi động: Mở 90 độ -> Giữ 600ms -> Đóng 0
  // độ
  void selfTest() {
    if (lcd) {
      lcd->clear();
      lcd->setCursor(0, 0);
      lcd->print(name == "ENTRY_1" ? "  VALO - ENTRY  " : "  VALO - EXIT   ");
      lcd->setCursor(0, 1);
      lcd->print("* SELF-TEST ON *");
    }

    Serial.printf(
        "🔧 [ESP32 SELF-TEST] >> DANG KIEM TRA %s (Servo PIN %d)...\n",
        name.c_str(), servoPin);

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
    Serial.printf(
        "✅ [ESP32 SELF-TEST] >> %s HOAT DONG TOT (0 -> 90 -> 0 DO)!\n",
        name.c_str());

    // Khởi tạo lại màn hình chữ chạy mặc định
    if (name == "ENTRY_1") {
      setMarqueeContent("  VALO - ENTRY  ",
                        "WELCOME TO VALO PARKING - HAVE A SAFE DRIVE!");
    } else {
      setMarqueeContent("  VALO - EXIT   ",
                        "THANK YOU - SEE YOU AGAIN - HAVE A SAFE TRIP!");
    }
  }

  void handleMarquee() {
    if (!lcd)
      return;
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

    // 0. Khi cổng đang đóng, giám sát thay đổi cảm biến theo thời gian thực để test
    if (currentState == GATE_IDLE_CLOSED) {
      int currentRaw = digitalRead(sensorPin);
      if (currentRaw != lastRawSensor) {
        lastRawSensor = currentRaw;
        bool isObst = (currentRaw == activeObstacleLevel);
        Serial.printf("🔍 [TEST CẢM BIẾN %s Pin %d]: Raw=%d -> %s (Đèn LED trên cảm biến: %s)\n",
                      name.c_str(), sensorPin, currentRaw,
                      isObst ? "PHÁT HIỆN VẬT CẢN" : "THÔNG THOÁNG",
                      isObst ? "SÁNG" : "TẮT");
      }
    }

    if (currentState != GATE_IDLE_CLOSED &&
        currentState != GATE_HOLD_MAINTENANCE) {
      // Đợi 800ms sau khi mở để triệt tiêu dao động cơ học ban đầu
      if (millis() - barrierOpenedAt >= 800) {
        int pinVal = digitalRead(sensorPin);
        bool isObstacle = (pinVal == activeObstacleLevel);

        // In log định kỳ mỗi 1.5 giây để theo dõi
        if (millis() - lastSensorLogTime >= 1500) {
          lastSensorLogTime = millis();
          const char *stateStr = "CHO XE QUA";
          if (currentState == GATE_CAR_UNDER)
            stateStr = "XE DANG DUOI CONG (CHONG KET - GIU MO 100%)";
          else if (currentState == GATE_CAR_PASSED)
            stateStr = "XE DA QUA - DANG DEM 1S DONG";

          Serial.printf("   [%s - SENSOR PIN %d]: Muc=%d (VatCan=%s) | TT=%s\n",
                        name.c_str(), sensorPin, pinVal,
                        isObstacle ? "CO" : "KHONG", stateStr);
        }

        // ── GIAI ĐOẠN 1: Cổng đang mở, chờ xe tiến vào che tia hồng ngoại ──
        if (currentState == GATE_OPEN_WAITING) {
          if (isObstacle) {
            currentState = GATE_CAR_UNDER;
            clearDetectionStart = 0;
            Serial.printf("\n🚗 [%s-SENSOR] >> ĐÃ CẮT TIA HỒNG NGOẠI: XE ĐANG "
                          "QUA CỔNG (CHỐNG KẸT KÍCH HOẠT)!\n",
                          name.c_str());
          } else {
            // Timeout 30s an toàn nếu mở cổng nhưng không có xe nào đi vào
            if (millis() - barrierOpenedAt >= 30000) {
              Serial.printf("\n⏳ [%s] >> HET 30S KHONG CO XE -> TU DONG DONG "
                            "CONG AN TOAN!\n",
                            name.c_str());
              close();
            }
          }
        }

        // ── GIAI ĐOẠN 2: Xe đang ở dưới thanh chắn / chưa qua cảm biến -> giữ
        // mở tuyệt đối ──
        else if (currentState == GATE_CAR_UNDER) {
          if (!isObstacle) {
            // Khi rút tay ra / xe qua khỏi -> yêu cầu thông thoáng liên tục
            // 200ms để lọc nhiễu
            if (clearDetectionStart == 0) {
              clearDetectionStart = millis();
            } else if (millis() - clearDetectionStart >= 200) {
              currentState = GATE_CAR_PASSED;
              carPassedAt = millis();
              Serial.printf("\n✅ [%s-SENSOR] >> XE ĐÃ QUA KHỎI CẢM BIẾN! ĐÓNG "
                            "SAU 1 GIÂY...\n",
                            name.c_str());
            }
          } else {
            // CHỪNG NÀO CÒN VẬT CẢN CHE TIA (XE CHƯA QUA CẢM BIẾN):
            // LUÔN RESET BỘ ĐẾM THÔNG THOÁNG VỀ 0 -> GIỮ NGUYÊN 90 ĐỘ KHÔNG BAO
            // GIỜ ĐÓNG!
            clearDetectionStart = 0;
            // Timeout an toàn: Nếu cảm biến bị kẹt che tia quá 45 giây liên
            // tục, tự động đóng an toàn
            if (millis() - barrierOpenedAt >= 45000) {
              Serial.printf("\n⏳ [%s] >> CẢM BIẾN CHE QUÁ 45S -> TIMEOUT ĐÓNG "
                            "CỔNG AN TOÀN!\n",
                            name.c_str());
              close(true);
            }
          }
        }

        // ── GIAI ĐOẠN 3: Xe đã qua khỏi -> đợi đúng 1.0 giây thông thoáng ->
        // đóng barrier ──
        else if (currentState == GATE_CAR_PASSED) {
          if (isObstacle) {
            // NẾU CÓ VẬT CẢN TRỞ LẠI TRONG LÚC ĐANG ĐẾM 1S (XE PHANH HOẶC LÙI
            // LẠI):
            currentState = GATE_CAR_UNDER;
            clearDetectionStart = 0;
            Serial.printf("\n⚠️ [%s-SENSOR] >> CÓ VẬT CẢN TRỞ LẠI -> GIỮ NGUYÊN "
                          "CỔNG MỞ AN TOÀN!\n",
                          name.c_str());
          } else if (millis() - carPassedAt >= 1000) {
            Serial.printf("\n🔒 [%s] >> XE DA QUA HOAN TAT -> TIẾN HÀNH ĐÓNG "
                          "CỔNG BARRIER!\n",
                          name.c_str());
            close();
          }
        }
      }
    }
  }
};

// Cổng Vào (ENTRY_1): Cảm biến Active LOW (Che tay = LOW 0V, Thông thoáng = HIGH 3.3V)
GateController entryGate("ENTRY_1", ENTRY_SERVO_PIN, ENTRY_SENSOR_PIN, LOW,
                         &lcdEntry);

// Cổng Ra (EXIT_1): Cảm biến Active LOW (Che tay = LOW 0V, Thông thoáng = HIGH 3.3V)
GateController exitGate("EXIT_1", EXIT_SERVO_PIN, EXIT_SENSOR_PIN, LOW,
                        &lcdExit);

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

  // 4. Khởi tạo và self-test LCD 3 (Bảng hiển thị công suất bãi xe)
  capacityDisplay.init();
  delay(150);
  capacityDisplay.selfTest();

  // 5. TỰ ĐỘNG CHẠY SELF-TEST LẦN LƯỢT 2 CỔNG KHI CẮM NGUỒN USB
  Serial.println("\n=======================================================");
  Serial.println("🔧 [ESP32 SELF-TEST] >> BAT DAU KIEM TRA 2 CONG...");
  Serial.println("=======================================================");

  entryGate.selfTest();
  delay(300);
  exitGate.selfTest();

  Serial.println(
      "\n🎉 [ESP32 SELF-TEST] >> TOAN BO 2 CONG DUAL-GATE & LCD 3 SAN SANG!");
  Serial.println("ESP32_BARRIER_READY");
}

// ════════════════════════════════════════════════════════════════════
// LOOP CHÍNH
// ════════════════════════════════════════════════════════════════════
void loop() {
  entryGate.update();
  exitGate.update();
  capacityDisplay.updateBlink();

  if (Serial.available() > 0) {
    String command = Serial.readStringUntil('\n');
    command.trim();
    if (command.length() == 0)
      return;

    Serial.println("[ESP32 REC]: " + command);

    if (command == "CALIB" || command == "RECALIB") {
      Serial.println("\n🔄 [ESP32] >> TIEN HANH HIEU CHUAN LAI PHAN CUC CAM BIEN 2 CONG...");
      entryGate.calibrateSensor();
      exitGate.calibrateSensor();
      return;
    }

    bool isExit =
        (command.indexOf("EXIT") != -1 || command.indexOf("CHECKOUT") != -1);
    GateController &targetGate = isExit ? exitGate : entryGate;

    if (command.startsWith("HOLD") || command.startsWith("PAUSE")) {
      targetGate.pause();
    } else if (command.startsWith("RESUME")) {
      targetGate.resume();
    } else if (command.startsWith("CAPACITY")) {
      // Lệnh cập nhật công suất bãi xe: CAPACITY|<available>|<occupied>|<total>
      int firstPipe = command.indexOf('|');
      if (firstPipe != -1) {
        int secondPipe = command.indexOf('|', firstPipe + 1);
        if (secondPipe != -1) {
          int thirdPipe = command.indexOf('|', secondPipe + 1);
          int avail = command.substring(firstPipe + 1, secondPipe).toInt();
          int occ =
              command
                  .substring(secondPipe + 1,
                             thirdPipe != -1 ? thirdPipe : command.length())
                  .toInt();
          int total = thirdPipe != -1 ? command.substring(thirdPipe + 1).toInt()
                                      : (avail + occ);
          capacityDisplay.update(avail, occ, total);
          Serial.printf("[ESP32] >> BANG LCD 3 CONG SUAT: Trong %d | Dang do "
                        "%d | Tong %d\n",
                        avail, occ, total);
        }
      }
    } else if (command.startsWith("OPEN")) {
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

      String line1 = isExit ? "OUT: " + plate : "IN: " + plate;
      String scrollMsg = "WELCOME TO VALO PARKING!";

      if (isExit) {
        scrollMsg =
            "THANK YOU FOR VISITING - HAVE A SAFE JOURNEY - SEE YOU AGAIN!";
      } else {
        if (slot.length() > 0 && slot != "STAFF" && slot != "N/A") {
          scrollMsg = "WELCOME! YOUR ASSIGNED SLOT: " + slot +
                      " - PLEASE PARK CAREFULLY - HAVE A NICE DAY!";
        } else {
          scrollMsg =
              "WELCOME TO VALO PARKING - GATE OPENING - HAVE A NICE DAY!";
        }
      }

      if (plate.length() == 0) {
        line1 = isExit ? "  VALO - EXIT   " : "  VALO - ENTRY  ";
      }

      if (gate.indexOf("EXIT") != -1) {
        exitGate.open(line1, scrollMsg);
      } else {
        entryGate.open(line1, scrollMsg);
      }
    } else if (command.startsWith("CHECKIN")) {
      entryGate.open("    WELCOME!    ",
                     "WELCOME TO VALO PARKING - GATE OPENING");
    } else if (command.startsWith("CHECKOUT")) {
      exitGate.open(
          "    GOODBYE!    ",
          "THANK YOU FOR VISITING - HAVE A SAFE JOURNEY - SEE YOU AGAIN!");
    } else if (command.startsWith("CLOSE") ||
               command.startsWith("FORCE_CLOSE")) {
      // Khi nhận lệnh đóng cổng thủ công từ Web/Staff: Đóng cần dứt khoát theo
      // lệnh điều khiển
      targetGate.close(true);
    }
  }
}