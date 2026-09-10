import time
import serial
import serial.tools.list_ports
import requests

# ====================================================
# VALO PARKING - PYTHON IOT BARRIER CONTROLLER
# Fix triệt để lỗi DTR/RTS gây Reset ESP32 vào Download Boot
# ====================================================

SERIAL_PORT = '/dev/cu.usbserial-0001'
BAUD_RATE = 115200
BACKEND_STATUS_URL = 'http://localhost:5001/api/iot/barrier-status'

def find_esp32_port():
    ports = list(serial.tools.list_ports.comports())
    for p in ports:
        dev = p.device
        if 'SLAB_USBtoUART' in dev or 'usbserial' in dev or 'CH340' in dev or 'CP210' in dev or 'ttyUSB' in dev:
            return dev
    return SERIAL_PORT

def connect_serial():
    port = find_esp32_port()
    try:
        # Cấu hình tắt DTR và RTS để Mac không kích hoạt mạch tự nạp (Bootloader) của ESP32
        ser = serial.Serial()
        ser.port = port
        ser.baudrate = BAUD_RATE
        ser.timeout = 0.1
        ser.dtr = False
        ser.rts = False
        ser.open()
        
        # Đảm bảo DTR/RTS ở mức LOW
        ser.setDTR(False)
        ser.setRTS(False)

        time.sleep(2) # Chờ ESP32 ổn định
        
        # Xóa sạch dữ liệu rác ban đầu trong buffer
        ser.reset_input_buffer()
        ser.reset_output_buffer()

        print(f"✅ ĐÃ KẾT NỐI THÀNH CÔNG VỚI ESP32 TẠI: {port}")
        return ser
    except Exception as e:
        return None

def main():
    print("=" * 60)
    print("🚗 VALO PARKING - BỘ ĐIỀU KHIỂN CỔNG BARRIER IOT 🚗")
    print("=" * 60)

    ser = None
    is_currently_open = False
    last_trigger_id = 0

    while True:
        # Tự động kết nối nếu chưa kết nối
        if ser is None or not ser.is_open:
            ser = connect_serial()
            if ser is None or not ser.is_open:
                print("⏳ Đang chờ cắm cáp ESP32 vào cổng USB...")
                time.sleep(2)
                continue
            else:
                print("📡 Sẵn sàng lắng nghe sự kiện từ Kiosk Web...\n")

        try:
            # 1. Đọc log phản hồi từ ESP32
            while ser.in_waiting:
                msg = ser.readline().decode('utf-8', errors='ignore').strip()
                if msg:
                    print(f"   [ESP32]: {msg}")

            # 2. Đồng bộ trạng thái mở/đóng Barrier từ Kiosk Backend
            res = requests.get(BACKEND_STATUS_URL, timeout=2)
            if res.status_code == 200:
                data = res.json()
                if data.get('success'):
                    info = data.get('data', {})
                    should_open = info.get('open', False)
                    trigger_id = info.get('triggerId', 0)
                    plate = info.get('licensePlate', 'N/A')
                    slot = info.get('slotCode', 'N/A')
                    gate = info.get('gate', 'ENTRY_1')

                    # A. LỆNH MỞ CỔNG KHI KIOSK XÁC NHẬN
                    if should_open and (not is_currently_open or trigger_id != last_trigger_id):
                        last_trigger_id = trigger_id
                        is_currently_open = True
                        print(f"\n🎉 [KIOSK] Xe hợp lệ! Biển số: {plate} | Ô đỗ: {slot} | Cổng: {gate}")
                        
                        cmd = f"OPEN|{plate}|{slot}|{gate}\n"
                        print(f"👉 Gửi lệnh: {cmd.strip()} -> ESP32...")
                        ser.write(cmd.encode('utf-8'))
                        ser.flush()

                    # B. LỆNH ĐÓNG CỔNG KHI KIOSK QUAY VỀ MÀN HÌNH CHÍNH
                    elif not should_open and is_currently_open:
                        is_currently_open = False
                        print("\n🔒 [KIOSK] Kiosk đã quay về màn hình chính -> ĐÓNG CỔNG")
                        print("👉 Gửi lệnh: CLOSE -> ESP32...")
                        ser.write(b"CLOSE\n")
                        ser.flush()

        except requests.exceptions.RequestException as req_err:
            # Backend chua bat, bo qua va tiep tuc lang nghe Serial, khong duoc ngat USB
            pass
        except (serial.SerialException, OSError) as se:
            print(f"⚠️ Mất kết nối USB ({se}). Đang tự động kết nối lại...")
            if ser:
                try:
                    ser.close()
                except Exception:
                    pass
            ser = None
            time.sleep(1.5)
        except Exception as e:
            print(f"⚠️ Lỗi: {e}")
            if "device not configured" in str(e).lower() or "bad file descriptor" in str(e).lower():
                ser = None

        time.sleep(0.5)

if __name__ == '__main__':
    main()
