import time
import serial
import requests

# ====================================================
# 1. CẤU HÌNH CỔNG SERIAL VÀ BACKEND
# ====================================================
SERIAL_PORT = '/dev/cu.SLAB_USBtoUART'  # Cổng ESP32 trên Mac
BAUD_RATE = 115200
BACKEND_URL = 'http://localhost:5001/api/iot/barrier-status'

def init_serial():
    try:
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
        time.sleep(2) # Chờ kết nối ổn định
        print(f"✅ Đã kết nối thành công với ESP32 tại cổng: {SERIAL_PORT}")
        return ser
    except Exception as e:
        print(f"❌ Không thể kết nối với ESP32 tại {SERIAL_PORT}: {e}")
        return None

def main():
    print("=" * 55)
    print("🚗 VALO PARKING - PYTHON IOT BARRIER CONTROLLER 🚗")
    print("=" * 55)
    
    ser = init_serial()
    if not ser:
        print("⚠️ Vui lòng kiểm tra lại cáp USB kết nối ESP32.")
        return

    last_trigger_id = 0
    print("📡 Đang lắng nghe sự kiện Check-in / Check-out từ Kiosk Web...\n")

    while True:
        try:
            response = requests.get(BACKEND_URL, timeout=2)
            if response.status_code == 200:
                data = response.json()
                if data.get('success'):
                    barrier_info = data.get('data', {})
                    should_open = barrier_info.get('open', False)
                    trigger_id = barrier_info.get('triggerId', 0)
                    plate = barrier_info.get('licensePlate', 'N/A')
                    slot = barrier_info.get('slotCode', 'N/A')
                    gate = barrier_info.get('gate', 'ENTRY_1')

                    # Phát hiện lệnh mở mới từ Backend Kiosk
                    if should_open and trigger_id != 0 and trigger_id != last_trigger_id:
                        last_trigger_id = trigger_id
                        print(f"\n🎉 [KIOSK EVENT] Xe hợp lệ! Biển số: {plate} | Slot: {slot} | Cổng: {gate}")
                        print("👉 Python gửi lệnh: 'OPEN' -> ESP32...")
                        
                        ser.write(b"OPEN\n")
                        ser.flush()
                        
                        # Đọc phản hồi từ ESP32
                        time.sleep(0.5)
                        while ser.in_waiting:
                            esp_msg = ser.readline().decode('utf-8', errors='ignore').strip()
                            if esp_msg:
                                print(f"   [ESP32]: {esp_msg}")
                        
                        print("✅ Đã hoàn tất chu trình mở/đóng Barrier.\n")

        except requests.exceptions.RequestException:
            pass # Backend đang khởi động hoặc tạm thời chưa sẵn sàng
        except Exception as e:
            print(f"⚠️ Lỗi: {e}")

        time.sleep(1) # Quét mỗi 1 giây

if __name__ == '__main__':
    main()
