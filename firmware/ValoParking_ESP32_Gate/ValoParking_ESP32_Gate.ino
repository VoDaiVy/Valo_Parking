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
  bool pendingRender;

  CapacityDisplayManager(SoftSafeI2CLCD *display) {
    lcd = display;
    availableSlots = -1;
    occupiedSlots = -1;
    totalSlots = -1;
    isFull = false;
    lastBlinkTime = 0;
    blinkState = false;
    pendingRender = false;
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

  void update(int avail, int occ, int total, bool deferRender = false) {
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
    if (deferRender) {
      pendingRender = true;
      return;
    }
    pendingRender = false;
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

  void serviceDisplay(bool anyGateMoving = false) {
    if (!lcd || anyGateMoving)
      return;
    if (pendingRender) {
      pendingRender = false;
      render();
      return;
    }
    if (!isFull)
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

// --- ENUM TRẠNG THÁI & HƯỚNG CỔNG ---
enum GateState {
  GATE_IDLE_CLOSED,
  GATE_MOVING_OPEN,
  GATE_OPEN_WAITING,
  GATE_CAR_UNDER,
  GATE_CAR_PASSED,
  GATE_MOVING_CLOSE,
  GATE_HOLD_MAINTENANCE
};

enum GateDirection {
  DIRECTION_FORWARD, // Chiều thuận: Cảm biến nằm SAU barrier (Mặc định cho Entry_1 vào, Exit_1 ra)
  DIRECTION_REVERSE  // Chiều nghịch: Cảm biến nằm TRƯỚC barrier (Khi đổi làn đảo chiều)
};

enum GateRole {
  ROLE_ENTRY,
  ROLE_EXIT
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
  GateDirection direction;
  GateRole role;
  int currentServoAngle;
  float currentAngleDeg;
  float motionStartAngle;
  float motionTargetAngle;
  unsigned long motionStartAt;
  unsigned long motionDurationMs;

  static const unsigned long SERVO_FRAME_MS = 20;
  static const unsigned long OPEN_DURATION_MS = 640;
  static const unsigned long CLOSE_DURATION_MS = 800;

  bool carHasEntered;          // Dùng cho REVERSE mode: đánh dấu xe đã bắt đầu che cảm biến
  const unsigned long REVERSE_CLEAR_BUFFER_MS = 1800; // Đệm 1.8s sau khi hết che để xe lọt qua hẳn rào chắn

  int configuredObstacleLevel; // Cấu hình ban đầu: LOW, HIGH hoặc SENSOR_AUTO_DETECT (-1)
  int activeObstacleLevel;     // Mức logic thực tế khi có vật cản (tự động nhận dạng)
  int sensorBaseline;          // Mức logic khi cổng đóng (thông thoáng)
  int lastRawSensor;           // Lưu giá trị gần nhất khi test lúc cổng đóng

  unsigned long barrierOpenedAt;
  unsigned long clearDetectionStart;
  unsigned long obstacleDebounceStart;
  unsigned long closeDebounceStart;
  unsigned long carPassedAt;
  unsigned long lastSensorLogTime;
  unsigned long lastServoStepAt;
  unsigned long closeSettleAt;
  unsigned long bounceLcdUntil;
  bool closeSettling;
  bool bounceLcdActive;
  bool marqueeEnabled;

  String currentLine1;
  String currentMarqueeMsg;
  int marqueeIndex;
  unsigned long lastMarqueeUpdate;

  GateController(String gateName, int sPin, int irPin, int obstLevel,
                 SafeI2CLCD *display, GateRole defaultRole = ROLE_ENTRY,
                 GateDirection defaultDir = DIRECTION_FORWARD) {
    name = gateName;
    servoPin = sPin;
    sensorPin = irPin;
    configuredObstacleLevel = obstLevel;
    activeObstacleLevel = obstLevel;
    lcd = display;
    role = defaultRole;
    direction = defaultDir;
    currentState = GATE_IDLE_CLOSED;
    stateBeforePause = GATE_IDLE_CLOSED;
    currentServoAngle = 0;
    currentAngleDeg = 0.0f;
    motionStartAngle = 0.0f;
    motionTargetAngle = 0.0f;
    motionStartAt = 0;
    motionDurationMs = OPEN_DURATION_MS;
    carHasEntered = false;
    sensorBaseline = -1;
    lastRawSensor = -1;
    barrierOpenedAt = 0;
    clearDetectionStart = 0;
    obstacleDebounceStart = 0;
    closeDebounceStart = 0;
    carPassedAt = 0;
    lastSensorLogTime = 0;
    lastServoStepAt = 0;
    closeSettleAt = 0;
    bounceLcdUntil = 0;
    closeSettling = false;
    bounceLcdActive = false;
    marqueeEnabled = true;
    marqueeIndex = 0;
    lastMarqueeUpdate = 0;
  }

  bool isMoving() const {
    return currentState == GATE_MOVING_OPEN || currentState == GATE_MOVING_CLOSE;
  }

  int angleToMicros(float deg) {
    if (deg < 0.0f) deg = 0.0f;
    if (deg > 180.0f) deg = 180.0f;
    return (int)(500.0f + (deg * (1900.0f / 180.0f)) + 0.5f);
  }

  void writeSmoothAngle(float deg) {
    currentAngleDeg = deg;
    currentServoAngle = (int)(deg + 0.5f);
    servo.writeMicroseconds(angleToMicros(deg));
  }

  void startSmoothMove(float targetAngle, unsigned long fullTravelDurationMs) {
    float delta = targetAngle - currentAngleDeg;
    if (delta < 0.0f) delta = -delta;
    motionStartAngle = currentAngleDeg;
    motionTargetAngle = targetAngle;
    unsigned long scaled = (unsigned long)((fullTravelDurationMs * (delta / 90.0f)) + 0.5f);
    motionDurationMs = (scaled < 80UL) ? 80UL : scaled;
    motionStartAt = millis();
    lastServoStepAt = 0;
  }

  bool stepSmoothMove(unsigned long now) {
    if (lastServoStepAt != 0 && (now - lastServoStepAt < SERVO_FRAME_MS)) {
      return false;
    }
    lastServoStepAt = now;
    unsigned long elapsed = now - motionStartAt;
    if (elapsed >= motionDurationMs) {
      writeSmoothAngle(motionTargetAngle);
      return true;
    }
    float t = (float)elapsed / (float)motionDurationMs;
    float u = t * t * (3.0f - 2.0f * t);
    float nextDeg = motionStartAngle + (motionTargetAngle - motionStartAngle) * u;
    writeSmoothAngle(nextDeg);
    return false;
  }

  void showDefaultMarquee() {
    if (role == ROLE_ENTRY) {
      setMarqueeContent(name == "ENTRY_1" ? "  VALO - ENTRY  " : " VALO - ENTRY 2 ",
                        "WELCOME TO VALO PARKING - HAVE A SAFE DRIVE!");
    } else {
      setMarqueeContent(name == "EXIT_1" ? "  VALO - EXIT   " : "  VALO - EXIT 2  ",
                        "THANK YOU - SEE YOU AGAIN - HAVE A SAFE TRIP!");
    }
  }

  void setMode(GateDirection newDir, GateRole newRole) {
    direction = newDir;
    role = newRole;
    Serial.printf("🔄 [ESP32 MODE SET] %s >> ROLE: %s | DIRECTION: %s (CamBien %s Barrier)\n",
                  name.c_str(),
                  (role == ROLE_ENTRY ? "ENTRY (VAO)" : "EXIT (RA)"),
                  (direction == DIRECTION_FORWARD ? "FORWARD (Thuan)" : "REVERSE (Nghich)"),
                  (direction == DIRECTION_FORWARD ? "SAU" : "TRUOC"));

    if (currentState == GATE_IDLE_CLOSED) {
      showDefaultMarquee();
    } else if (currentState == GATE_OPEN_WAITING && direction == DIRECTION_REVERSE) {
      if (digitalRead(sensorPin) == activeObstacleLevel) {
        carHasEntered = true;
        currentState = GATE_CAR_UNDER;
      }
    }
  }

  void printSensorDiagnostic() {
    int raw = digitalRead(sensorPin);
    bool isObst = (raw == activeObstacleLevel);
    Serial.printf("🔍 [SENSOR DIAG] %s (Pin %d): Raw=%d | MucCoXe=%d (%s) | HienTai=%s\n",
                  name.c_str(), sensorPin, raw, activeObstacleLevel,
                  (activeObstacleLevel == LOW) ? "Active LOW" : "Active HIGH",
                  isObst ? "CO VAT CAN (DANG BI CHE)" : "THONG THOANG");
  }

  void setObstacleLevel(int level) {
    configuredObstacleLevel = level;
    activeObstacleLevel = level;
    sensorBaseline = (activeObstacleLevel == LOW) ? HIGH : LOW;
    lastRawSensor = digitalRead(sensorPin);
    printSensorDiagnostic();
  }

  void calibrateSensor(bool forceAuto = false) {
    if (!forceAuto && configuredObstacleLevel != SENSOR_AUTO_DETECT) {
      activeObstacleLevel = configuredObstacleLevel;
      sensorBaseline = (activeObstacleLevel == LOW) ? HIGH : LOW;
      Serial.printf("🎯 [ESP32 CHUẨN CẢM BIẾN] %s (Pin %d): MUC CO XE = %d (%s) | Thong thoang = %d | RawHienTai = %d\n",
                    name.c_str(), sensorPin, activeObstacleLevel,
                    (activeObstacleLevel == LOW) ? "Active LOW (0V khi che)" : "Active HIGH (3.3V khi che)",
                    sensorBaseline, digitalRead(sensorPin));
      return;
    }

    // Đọc liên tiếp 8 mẫu khi cổng thông thoáng để xác định Baseline thực tế
    int countHigh = 0;
    for (int i = 0; i < 8; i++) {
      if (digitalRead(sensorPin) == HIGH)
        countHigh++;
      delay(5);
    }
    sensorBaseline = (countHigh >= 4) ? HIGH : LOW;

    activeObstacleLevel = (sensorBaseline == HIGH) ? LOW : HIGH;
    lastRawSensor = digitalRead(sensorPin);

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
    writeSmoothAngle(0.0f);
    currentState = GATE_IDLE_CLOSED;
    stateBeforePause = GATE_IDLE_CLOSED;

    Serial.printf("[ESP32] >> Khoi tao Cổng %s (Servo Pin %d, Sensor Pin %d) "
                  "-> SAN SANG!\n",
                  name.c_str(), servoPin, sensorPin);

    showDefaultMarquee();
  }

  void setMarqueeContent(String line1, String marqueeMsg) {
    currentLine1 = cleanAscii(line1);
    while (currentLine1.length() < 16)
      currentLine1 += " ";
    if (currentLine1.length() > 16)
      currentLine1 = currentLine1.substring(0, 16);

    currentMarqueeMsg = "   " + cleanAscii(marqueeMsg) + "   ";
    marqueeIndex = 0;
    marqueeEnabled = true;
    lastMarqueeUpdate = millis();

    if (lcd) {
      lcd->clear();
      lcd->setCursor(0, 0);
      lcd->print(currentLine1);
      String initialLine2 = currentMarqueeMsg.substring(0, min(16, (int)currentMarqueeMsg.length()));
      while (initialLine2.length() < 16)
        initialLine2 += " ";
      lcd->setCursor(0, 1);
      lcd->print(initialLine2);
    }
  }

  void open(String line1, String marqueeText) {
    bounceLcdActive = false;
    setMarqueeContent(line1, marqueeText);

    // Nếu cần đang mở hoặc đang chờ xe qua ở 90 độ, chỉ làm mới đồng hồ & màn hình
    if ((currentState == GATE_OPEN_WAITING || currentState == GATE_CAR_UNDER || currentState == GATE_CAR_PASSED) && currentServoAngle >= 90) {
      barrierOpenedAt = millis();
      clearDetectionStart = 0;
      carPassedAt = 0;
      obstacleDebounceStart = 0;
      Serial.printf("[ESP32] >> %s DANG MO SAN (90 DO) -> CAP NHAT THONG TIN XE MOI!\n", name.c_str());
      return;
    }

    if (currentState == GATE_MOVING_OPEN) {
      barrierOpenedAt = millis();
      return;
    }

    Serial.printf("[ESP32] >> BAT DAU NANG CAN %s (SMOOTH -> 90 DO) TAI PIN %d...\n", name.c_str(), servoPin);

    if (!servo.attached()) {
      servo.attach(servoPin, 500, 2400);
    }

    closeSettling = false;
    clearDetectionStart = 0;
    carPassedAt = 0;
    obstacleDebounceStart = 0;
    closeDebounceStart = 0;
    barrierOpenedAt = millis();
    lastSensorLogTime = millis();

    // Ghi nhận sẵn nếu xe đang đè cảm biến từ lúc mới bắt đầu mở (hữu ích cho REVERSE TH2)
    carHasEntered = (direction == DIRECTION_REVERSE && digitalRead(sensorPin) == activeObstacleLevel);
    currentState = GATE_MOVING_OPEN;
    startSmoothMove(90.0f, OPEN_DURATION_MS);
  }

  void pause() {
    if (currentState != GATE_HOLD_MAINTENANCE) {
      stateBeforePause = currentState;
    }
    currentState = GATE_HOLD_MAINTENANCE;
    bounceLcdActive = false;
    closeSettling = false;
    if (!servo.attached()) {
      servo.attach(servoPin, 500, 2400);
    }
    setMarqueeContent("  VALO PARKING  ", "* GATE PAUSED (MAINTENANCE) *");
    if (currentAngleDeg < 90.0f) {
      startSmoothMove(90.0f, OPEN_DURATION_MS);
    }
    Serial.printf("[ESP32] >> BAT CHE DO TAM DUNG %s (VO HIEU HOA CAM BIEN & GIU MO)!\n",
                  name.c_str());
  }

  void resume() {
    Serial.printf("[ESP32] >> TIEP TUC HOAT DONG %s...\n", name.c_str());
    if (currentState == GATE_HOLD_MAINTENANCE) {
      if (currentServoAngle == 0 || stateBeforePause == GATE_IDLE_CLOSED) {
        currentState = GATE_IDLE_CLOSED;
        showDefaultMarquee();
      } else {
        if (!servo.attached()) {
          servo.attach(servoPin, 500, 2400);
        }
        clearDetectionStart = 0;
        carPassedAt = 0;
        obstacleDebounceStart = 0;
        barrierOpenedAt = millis();
        setMarqueeContent("  VALO PARKING  ", "GATE RESUMED - VALO PARKING");
        if (currentServoAngle >= 90) {
          currentState = GATE_OPEN_WAITING;
        } else {
          currentState = GATE_MOVING_OPEN;
          startSmoothMove(90.0f, OPEN_DURATION_MS);
        }
      }
    }
  }

  void triggerBounceBack(const char *reasonTag = "BOUNCE BACK") {
    unsigned long now = millis();
    Serial.printf("\n🚨 [%s-%s] >> PHAT HIEN VAT CAN! BAT NGUOC LEN 90 DO KHAN CAP!\n",
                  name.c_str(), reasonTag);
    if (!servo.attached()) {
      servo.attach(servoPin, 500, 2400);
    }
    writeSmoothAngle(90.0f);
    currentState = GATE_CAR_UNDER;
    carHasEntered = true;
    closeSettling = false;
    marqueeEnabled = false;
    barrierOpenedAt = now;
    clearDetectionStart = 0;
    carPassedAt = 0;
    obstacleDebounceStart = 0;
    closeDebounceStart = 0;
    bounceLcdActive = true;
    bounceLcdUntil = now + 1200;
    if (lcd) {
      lcd->clear();
      lcd->setCursor(0, 0);
      lcd->print("  VALO PARKING  ");
      lcd->setCursor(0, 1);
      lcd->print("* BOUNCE BACK! *");
    }
  }

  // 🚗 BẢO VỆ CHỐNG KẸP TỰ ĐỘNG BẬT NGƯỢC LÊN 90 ĐỘ (BOUNCE-BACK):
  // Quét cảm biến quang liên tục từng mili-giây khi cần đang hạ!
  bool checkAntiPinchReverse(unsigned long now) {
    if (digitalRead(sensorPin) == activeObstacleLevel) {
      if (closeDebounceStart == 0) {
        closeDebounceStart = now;
      }
      if (now - closeDebounceStart >= 15) {
        triggerBounceBack("ANTI-PINCH");
        return true;
      }
    } else {
      closeDebounceStart = 0;
    }
    return false;
  }

  void close(bool isManual = false) {
    if (currentState == GATE_IDLE_CLOSED && currentServoAngle == 0)
      return;
    if (currentState == GATE_MOVING_CLOSE)
      return;

    // 🚗 BẢO VỆ TUYỆT ĐỐI SỐ 1: NẾU XE ĐANG ĐÈ CẢM BIẾN THÌ TỪ CHỐI ĐÓNG, GIỮ NGUYÊN 90 ĐỘ!
    if (digitalRead(sensorPin) == activeObstacleLevel) {
      triggerBounceBack("BLOCK-CLOSE");
      return;
    }

    marqueeEnabled = false;
    if (lcd) {
      lcd->clear();
      lcd->setCursor(0, 0);
      lcd->print("  VALO PARKING  ");
      lcd->setCursor(0, 1);
      lcd->print("  CLOSING GATE  ");
    }

    Serial.printf(
        "[ESP32] >> BAT DAU HA CAN %s (SMOOTH -> 0 DO) TAI PIN %d (Manual=%s)...\n",
        name.c_str(), servoPin, isManual ? "YES" : "NO");

    if (!servo.attached()) {
      servo.attach(servoPin, 500, 2400);
    }

    bounceLcdActive = false;
    closeSettling = false;
    closeDebounceStart = 0;
    currentState = GATE_MOVING_CLOSE;
    startSmoothMove(0.0f, CLOSE_DURATION_MS);
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

    // Mở cần lên 90 độ mượt mà theo đường cong S-curve
    startSmoothMove(90.0f, OPEN_DURATION_MS);
    while (!stepSmoothMove(millis())) {
      delay(5);
    }
    delay(600); // Giữ cần mở 600ms để quan sát trực quan

    // Đóng cần về 0 độ mượt mà theo đường cong S-curve
    startSmoothMove(0.0f, CLOSE_DURATION_MS);
    while (!stepSmoothMove(millis())) {
      delay(5);
    }
    delay(200);

    currentState = GATE_IDLE_CLOSED;
    Serial.printf(
        "✅ [ESP32 SELF-TEST] >> %s HOAT DONG TOT (0 -> 90 -> 0 DO)!\n",
        name.c_str());

    // Khởi tạo lại màn hình chữ chạy mặc định
    showDefaultMarquee();
  }

  void handleMarquee() {
    if (!lcd || !marqueeEnabled)
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
    unsigned long now = millis();
    if (bounceLcdActive) {
      if (now >= bounceLcdUntil) {
        bounceLcdActive = false;
        showDefaultMarquee();
      }
    } else if (marqueeEnabled && !isMoving()) {
      handleMarquee();
    }

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
      return;
    }

    // 0b. Chế độ HOLD / PAUSE: Nếu cần đang ở dưới 90 độ thì nhấc mượt lên 90 độ và giữ cố định
    if (currentState == GATE_HOLD_MAINTENANCE) {
      if (currentAngleDeg < 90.0f) {
        stepSmoothMove(now);
      }
      return;
    }

    // 1. Nâng cần Non-blocking mượt mà lên 90 độ
    if (currentState == GATE_MOVING_OPEN) {
      if (stepSmoothMove(now)) {
        barrierOpenedAt = now;
        clearDetectionStart = 0;
        carPassedAt = 0;
        obstacleDebounceStart = 0;
        lastSensorLogTime = now;

        bool isBlockedInitially = (digitalRead(sensorPin) == activeObstacleLevel);
        if (direction == DIRECTION_REVERSE) {
          if (isBlockedInitially || carHasEntered) {
            carHasEntered = true;
            currentState = GATE_CAR_UNDER;
            Serial.printf("🚗 [ESP32-REVERSE] %s >> XE DANG DE CAM BIEN SAN (TH2: Đỗ sát) -> GIU MO 90 DO DE BAO VE XE!\n", name.c_str());
          } else {
            carHasEntered = false;
            currentState = GATE_OPEN_WAITING;
            Serial.printf("⏳ [ESP32-REVERSE] %s >> XE CHUA CHAM CAM BIEN (TH1: Đỗ xa) -> GIU MO 90 DO, CHO XE TIEN LEN...\n", name.c_str());
          }
        } else {
          currentState = isBlockedInitially ? GATE_CAR_UNDER : GATE_OPEN_WAITING;
        }

        Serial.printf("[ESP32] >> %s DA MO 90 DO! HUONG: %s | DANG THEO DOI CAM BIEN PIN %d...\n",
                      name.c_str(), (direction == DIRECTION_REVERSE ? "REVERSE" : "FORWARD"), sensorPin);
      }
      return;
    }

    // 2. Hạ cần Non-blocking mượt mà về 0 độ + Quét chống kẹp liên tục từng vòng loop()
    if (currentState == GATE_MOVING_CLOSE) {
      if (checkAntiPinchReverse(now)) {
        return;
      }
      if (!closeSettling) {
        if (stepSmoothMove(now)) {
          closeSettling = true;
          closeSettleAt = now;
        }
      } else if (now - closeSettleAt >= 150) {
        closeSettling = false;
        currentState = GATE_IDLE_CLOSED;
        clearDetectionStart = 0;
        carPassedAt = 0;
        obstacleDebounceStart = 0;
        carHasEntered = false;
        lastRawSensor = digitalRead(sensorPin);

        Serial.printf("[ESP32] >> %s DA DONG HOAN TOAN!\n", name.c_str());
        Serial.printf("GATE_CLOSED_%s\n", name.c_str());
        if (name == "ENTRY_1") {
          Serial.println("GATE_CLOSED");
        }
        showDefaultMarquee();
      }
      return;
    }

    // 3. Giám sát cảm biến quang sau khi mở đủ 90 độ (đợi 450ms giảm rung cơ học ban đầu, trừ TH2 đã đè sẵn)
    if (currentState == GATE_CAR_UNDER || (now - barrierOpenedAt >= 450)) {
      int pinVal = digitalRead(sensorPin);
      bool isObstacleRaw = (pinVal == activeObstacleLevel);

      if (now - lastSensorLogTime >= 1500) {
        lastSensorLogTime = now;
        const char *stateStr = (currentState == GATE_OPEN_WAITING) ? "CHO XE QUA" :
                               (currentState == GATE_CAR_UNDER) ? "XE DANG DUOI CONG (GIU MO 90 DO)" :
                               "XE DA QUA - DANG DEM DONG";
        Serial.printf("   [%s - SENSOR PIN %d | %s]: Muc=%d (VatCan=%s) | TT=%s\n",
                      name.c_str(), sensorPin,
                      (direction == DIRECTION_REVERSE ? "REVERSE" : "FORWARD"),
                      pinVal, isObstacleRaw ? "CO" : "KHONG", stateStr);
      }

      // ─────────────────────────────────────────────────────────────
      // CHẾ ĐỘ 1: DIRECTION_FORWARD (Chiều thuận gốc: Cảm biến SAU barrier)
      // ─────────────────────────────────────────────────────────────
      if (direction == DIRECTION_FORWARD) {
        if (currentState == GATE_OPEN_WAITING) {
          if (isObstacleRaw) {
            if (obstacleDebounceStart == 0) obstacleDebounceStart = now;
            if (now - obstacleDebounceStart >= 40) {
              currentState = GATE_CAR_UNDER;
              clearDetectionStart = 0;
              obstacleDebounceStart = 0;
              Serial.printf("\n🚗 [%s-FORWARD] >> XE BẮT ĐẦU QUA RÀO CHẮN (CẮT TIA CẢM BIẾN)!\n", name.c_str());
            }
          } else {
            obstacleDebounceStart = 0;
            if (now - barrierOpenedAt >= 30000) {
              Serial.printf("\n⏳ [%s] >> HẾT 30S KHÔNG CÓ XE -> TỰ ĐỘNG ĐÓNG AN TOÀN!\n", name.c_str());
              close();
            }
          }
        } else if (currentState == GATE_CAR_UNDER) {
          if (!isObstacleRaw) {
            if (clearDetectionStart == 0) {
              clearDetectionStart = now;
            } else if (now - clearDetectionStart >= 250) {
              currentState = GATE_CAR_PASSED;
              carPassedAt = now;
              obstacleDebounceStart = 0;
              Serial.printf("\n✅ [%s-FORWARD] >> XE ĐÃ QUA KHỎI CẢM BIẾN! ĐÓNG SAU 1 GIÂY...\n", name.c_str());
            }
          } else {
            clearDetectionStart = 0;
          }
        } else if (currentState == GATE_CAR_PASSED) {
          if (isObstacleRaw) {
            if (obstacleDebounceStart == 0) obstacleDebounceStart = now;
            if (now - obstacleDebounceStart >= 25) {
              currentState = GATE_CAR_UNDER;
              clearDetectionStart = 0;
              obstacleDebounceStart = 0;
              Serial.printf("\n⚠️ [%s-FORWARD] >> CÓ VẬT CẢN TRỞ LẠI -> GIỮ NGUYÊN MỞ AN TOÀN!\n", name.c_str());
            }
          } else {
            obstacleDebounceStart = 0;
            if (now - carPassedAt >= 1000) {
              Serial.printf("\n🔒 [%s-FORWARD] >> XE ĐÃ QUA HOÀN TẤT -> TIẾN HÀNH ĐÓNG CỔNG!\n", name.c_str());
              close();
            }
          }
        }
      }

      // ─────────────────────────────────────────────────────────────
      // CHẾ ĐỘ 2: DIRECTION_REVERSE (Chiều nghịch: Cảm biến nằm TRƯỚC barrier)
      // Xử lý hoàn hảo cả 2 trường hợp: Xe đỗ xa (TH1) và Xe đỗ sát (TH2)
      // ─────────────────────────────────────────────────────────────
      else if (direction == DIRECTION_REVERSE) {
        if (currentState == GATE_OPEN_WAITING) {
          if (isObstacleRaw) {
            if (obstacleDebounceStart == 0) obstacleDebounceStart = now;
            if (now - obstacleDebounceStart >= 40) {
              carHasEntered = true;
              currentState = GATE_CAR_UNDER;
              clearDetectionStart = 0;
              obstacleDebounceStart = 0;
              Serial.printf("\n🚗 [%s-REVERSE] >> XE TIẾN LÊN CHE CẢM BIẾN (TH1) -> GIỮ MỞ CHO XE QUA!\n", name.c_str());
            }
          } else {
            obstacleDebounceStart = 0;
            if (now - barrierOpenedAt >= 30000) {
              Serial.printf("\n⏳ [%s-REVERSE] >> HẾT 30S KHÔNG CÓ XE TIẾN TỚI -> TỰ ĐỘNG ĐÓNG AN TOÀN!\n", name.c_str());
              close();
            }
          }
        } else if (currentState == GATE_CAR_UNDER) {
          if (!isObstacleRaw) {
            if (clearDetectionStart == 0) {
              clearDetectionStart = now;
            } else if (now - clearDetectionStart >= 250) {
              currentState = GATE_CAR_PASSED;
              carPassedAt = now;
              obstacleDebounceStart = 0;
              Serial.printf("\n✅ [%s-REVERSE] >> ĐUÔI XE ĐÃ QUA KHỎI CẢM BIẾN! ĐỆM 1.8S ĐỂ THÂN XE VƯỢT HẲN RÀO CHẮN...\n", name.c_str());
            }
          } else {
            clearDetectionStart = 0;
          }
        } else if (currentState == GATE_CAR_PASSED) {
          if (isObstacleRaw) {
            if (obstacleDebounceStart == 0) obstacleDebounceStart = now;
            if (now - obstacleDebounceStart >= 25) {
              currentState = GATE_CAR_UNDER;
              clearDetectionStart = 0;
              obstacleDebounceStart = 0;
              Serial.printf("\n⚠️ [%s-REVERSE] >> VẬT CẢN XUẤT HIỆN TRONG LÚC ĐỆM -> GIỮ MỞ AN TOÀN!\n", name.c_str());
            }
          } else {
            obstacleDebounceStart = 0;
            if (now - carPassedAt >= REVERSE_CLEAR_BUFFER_MS) {
              Serial.printf("\n🔒 [%s-REVERSE] >> XE ĐÃ VƯỢT HẲN RÀO CHẮN AN TOÀN -> TIẾN HÀNH ĐÓNG CỔNG!\n", name.c_str());
              close();
            }
          }
        }
      }
    }
  }
};

// Cổng Phải (Mặc định Cổng Vào): Cảm biến Active LOW, ROLE_ENTRY, DIRECTION_FORWARD
GateController entryGate("ENTRY_1", ENTRY_SERVO_PIN, ENTRY_SENSOR_PIN, LOW,
                         &lcdEntry, ROLE_ENTRY, DIRECTION_FORWARD);

// Cổng Trái (Mặc định Cổng Ra): Cảm biến Active HIGH, ROLE_EXIT, DIRECTION_FORWARD
GateController exitGate("EXIT_1", EXIT_SERVO_PIN, EXIT_SENSOR_PIN, HIGH,
                        &lcdExit, ROLE_EXIT, DIRECTION_FORWARD);

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

  // 1. Khởi tạo 2 bus I2C độc lập cho 2 LCD (timeout ngắn 10ms tránh đơ servo nếu nhiễu dây)
  I2C_Entry.begin(ENTRY_I2C_SDA, ENTRY_I2C_SCL, 100000);
  I2C_Exit.begin(EXIT_I2C_SDA, EXIT_I2C_SCL, 100000);
  I2C_Entry.setTimeOut(10);
  I2C_Exit.setTimeOut(10);
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
  entryGate.printSensorDiagnostic();
  exitGate.printSensorDiagnostic();

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
  capacityDisplay.serviceDisplay(entryGate.isMoving() || exitGate.isMoving());

  while (Serial.available() > 0) {
    String command = Serial.readStringUntil('\n');
    command.trim();
    if (command.length() == 0)
      continue;

    Serial.println("[ESP32 REC]: " + command);

    if (command == "CALIB" || command == "RECALIB") {
      Serial.println("\n🔄 [ESP32] >> TIEN HANH HIEU CHUAN LAI PHAN CUC CAM BIEN 2 CONG...");
      entryGate.calibrateSensor(true);
      exitGate.calibrateSensor(true);
      continue;
    }

    if (command == "SENSORS" || command == "STATUS") {
      entryGate.printSensorDiagnostic();
      exitGate.printSensorDiagnostic();
      continue;
    }

    if (command.startsWith("POLARITY|")) {
      int level = (command.indexOf("HIGH") != -1) ? HIGH : LOW;
      if (command.indexOf("EXIT") != -1) {
        exitGate.setObstacleLevel(level);
      } else {
        entryGate.setObstacleLevel(level);
      }
      continue;
    }

    // 🔄 LỆNH ĐỔI CHẾ ĐỘ LÀN ĐẢO CHIỀU CAO ĐIỂM (TIDAL REVERSIBLE LANES):
    // MODE|PEAK_ENTRY (2 Cổng Vào) | MODE|PEAK_EXIT (2 Cổng Ra) | MODE|STANDARD (1 Vào - 1 Ra)
    if (command.startsWith("MODE|") || command.startsWith("SET_MODE|")) {
      int pipe = command.indexOf('|');
      String subMode = command.substring(pipe + 1);
      subMode.toUpperCase();
      subMode.trim();

      if (subMode == "PEAK_ENTRY") {
        entryGate.setMode(DIRECTION_FORWARD, ROLE_ENTRY);
        exitGate.setMode(DIRECTION_REVERSE, ROLE_ENTRY); // Cổng Trái đổi sang làn Vào (Cảm biến trước rào)
        Serial.println("✅ [ESP32 MODE] >> DUAL-ENTRY ACTIVE (Cả 2 Cổng Vào)! Cổng Trái đổi sang REVERSE.");
      } else if (subMode == "PEAK_EXIT") {
        exitGate.setMode(DIRECTION_FORWARD, ROLE_EXIT);
        entryGate.setMode(DIRECTION_REVERSE, ROLE_EXIT); // Cổng Phải đổi sang làn Ra (Cảm biến trước rào)
        Serial.println("✅ [ESP32 MODE] >> DUAL-EXIT ACTIVE (Cả 2 Cổng Ra)! Cổng Phải đổi sang REVERSE.");
      } else if (subMode == "STANDARD" || subMode == "NORMAL") {
        entryGate.setMode(DIRECTION_FORWARD, ROLE_ENTRY);
        exitGate.setMode(DIRECTION_FORWARD, ROLE_EXIT);
        Serial.println("✅ [ESP32 MODE] >> STANDARD MODE (1 Vào - 1 Ra chuẩn) ACTIVE!");
      }
      continue;
    }

    if (command.startsWith("DIRECTION|")) {
      int p1 = command.indexOf('|');
      int p2 = command.indexOf('|', p1 + 1);
      if (p1 != -1 && p2 != -1) {
        String gName = command.substring(p1 + 1, p2);
        String dirStr = command.substring(p2 + 1);
        gName.toUpperCase();
        dirStr.toUpperCase();
        GateDirection newDir = (dirStr == "REVERSE") ? DIRECTION_REVERSE : DIRECTION_FORWARD;
        if (gName.indexOf("EXIT") != -1) {
          exitGate.setMode(newDir, exitGate.role);
        } else {
          entryGate.setMode(newDir, entryGate.role);
        }
      }
      continue;
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
          capacityDisplay.update(avail, occ, total, entryGate.isMoving() || exitGate.isMoving());
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

      GateController &openTarget = (gate.indexOf("EXIT") != -1) ? exitGate : entryGate;
      bool actAsExit = (openTarget.role == ROLE_EXIT);

      String line1 = actAsExit ? "OUT: " + plate : "IN: " + plate;
      String scrollMsg = "WELCOME TO VALO PARKING!";

      if (actAsExit) {
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
        line1 = actAsExit ? "  VALO - EXIT   " : "  VALO - ENTRY  ";
      }

      openTarget.open(line1, scrollMsg);
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
      // lệnh điều khiển (vẫn bảo vệ chống kẹp cảm biến quang)
      targetGate.close(true);
    }
  }
}