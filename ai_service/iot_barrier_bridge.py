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
    was_hold = False
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
                    if "GATE_CLOSED" in msg:
                        is_currently_open = False
                        # Đồng bộ ngược lại cho Backend & Web App biết cổng đã đóng xong
                        print("🔒 [BRIDGE] Cổng đã đóng -> Gửi tín hiệu đóng về Backend & Web App...")
                        try:
                            res_close = requests.post(
                                'http://localhost:5001/api/iot/close-barrier',
                                json={'fromBridge': True},
                                timeout=2
                            )
                            if res_close.status_code == 200:
                                data_close = res_close.json()
                                last_trigger_id = data_close.get('data', {}).get('triggerId', last_trigger_id)
                                print("✅ [BRIDGE SYNC] Đã đồng bộ trạng thái ĐÓNG CỔNG về Web App thành công!")
                        except Exception as e_close:
                            print(f"⚠️ Lỗi gửi close-barrier: {e_close}")

            # 2. Đồng bộ trạng thái mở/đóng Barrier từ Backend
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
                    is_hold = info.get('holdOpen', False)

                    # Lần đầu khởi động bridge: Ghi nhớ triggerId hiện tại để không chạy lại lệnh cũ
                    if last_trigger_id == 0:
                        last_trigger_id = trigger_id

                    # A. LỆNH TẠM DỪNG / BẢO TRÌ (VÔ HIỆU HÓA CẢM BIẾN, GIỮ NGUYÊN VỊ TRÍ)
                    if is_hold and trigger_id != last_trigger_id:
                        last_trigger_id = trigger_id
                        was_hold = True
                        print(f"\n⏸️ [PAUSE] Bật chế độ TẠM DỪNG (Vô hiệu hóa cảm biến hồng ngoại) tại {gate}...")
                        ser.write(b"PAUSE\n")
                        ser.flush()

                    # B. LỆNH ĐÓNG CỔNG TỪ STAFF (CHỈ GỬI KHI CỔNG ĐANG MỞ VÀ CÓ LỆNH MỚI)
                    elif (not should_open) and info.get('forceClose', False) and is_currently_open and trigger_id != last_trigger_id:
                        last_trigger_id = trigger_id
                        is_currently_open = False
                        print(f"\n🔒 [CLOSE GATE] Gửi lệnh đóng cổng -> FORCE_CLOSE tại {gate}")
                        ser.write(b"FORCE_CLOSE\n")
                        ser.flush()

                    # C. LỆNH MỞ CỔNG TỪ KIOSK HOẶC STAFF PANEL
                    elif should_open and trigger_id != last_trigger_id:
                        last_trigger_id = trigger_id
                        is_currently_open = True
                        was_hold = False
                        print(f"\n🎉 [GATE OPEN] Mở cổng từ Web/App! Biển số: {plate} | Ô: {slot} | Cổng: {gate}")
                        cmd = f"OPEN|{plate}|{slot}|{gate}\n"
                        print(f"👉 Gửi lệnh: {cmd.strip()} -> ESP32...")
                        ser.write(cmd.encode('utf-8'))
                        ser.flush()

                    # D. LỆNH TIẾP TỤC HOẠT ĐỘNG (CHỈ KHI TRƯỚC ĐÓ ĐANG TẠM DỪNG)
                    elif (not is_hold) and was_hold and trigger_id != last_trigger_id:
                        last_trigger_id = trigger_id
                        was_hold = False
                        print(f"\n▶️ [RESUME] Tiếp tục hoạt động bình thường tại {gate}...")
                        ser.write(b"RESUME\n")
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
