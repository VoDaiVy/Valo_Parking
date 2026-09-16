import time
import serial
import serial.tools.list_ports
import requests

# ====================================================
# VALO PARKING - PYTHON IOT DUAL-GATE CONTROLLER
# Quản lý đồng thời 2 Cổng độc lập: ENTRY_1 & EXIT_1
# ====================================================

SERIAL_PORT = '/dev/cu.usbserial-0001'
BAUD_RATE = 115200
BACKEND_STATUS_URL = 'http://localhost:5001/api/iot/barrier-status'
BACKEND_CLOSE_URL = 'http://localhost:5001/api/iot/close-barrier'

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
        ser = serial.Serial()
        ser.port = port
        ser.baudrate = BAUD_RATE
        ser.timeout = 0.1
        ser.dtr = False
        ser.rts = False
        ser.open()
        
        ser.setDTR(False)
        ser.setRTS(False)

        time.sleep(2)
        ser.reset_input_buffer()
        ser.reset_output_buffer()

        print(f"✅ ĐÃ KẾT NỐI THÀNH CÔNG VỚI ESP32 DUAL-GATE TẠI: {port}")
        return ser
    except Exception:
        return None

def main():
    print("=" * 65)
    print("🚗 VALO PARKING - BỘ ĐIỀU KHIỂN CỔNG BARRIER DUAL-GATE (2 CỔNG) 🚗")
    print("=" * 65)

    ser = None
    last_trigger_ids = {
        'ENTRY_1': 0,
        'EXIT_1': 0
    }
    was_hold_states = {
        'ENTRY_1': False,
        'EXIT_1': False
    }

    while True:
        if ser is None or not ser.is_open:
            ser = connect_serial()
            if ser is None or not ser.is_open:
                print("⏳ Đang chờ cắm cáp ESP32 vào cổng USB...")
                time.sleep(2)
                continue
            else:
                print("📡 Sẵn sàng lắng nghe sự kiện từ Kiosk Web & Staff Panel...\n")

        try:
            # 1. ĐỌC PHẢN HỒI TỪ ESP32 KHI CÓ XE QUA CỔNG
            while ser.in_waiting:
                raw_line = ser.readline()
                if raw_line:
                    msg = raw_line.decode('utf-8', errors='ignore').strip()
                    if msg:
                        print(f"   [ESP32]: {msg}")

                        # Kiểm tra xem cổng nào vừa đóng xong
                        closed_gate = None
                        if "GATE_CLOSED_EXIT_1" in msg:
                            closed_gate = 'EXIT_1'
                        elif "GATE_CLOSED_ENTRY_1" in msg or msg == "GATE_CLOSED":
                            closed_gate = 'ENTRY_1'

                        if closed_gate:
                            print(f"🔒 [BRIDGE SYNC] Cổng {closed_gate} đã đóng xong -> Gửi thông báo về Web App...")
                            try:
                                res_close = requests.post(
                                    BACKEND_CLOSE_URL,
                                    json={'fromBridge': True, 'gate': closed_gate},
                                    timeout=2
                                )
                                if res_close.status_code == 200:
                                    data_close = res_close.json()
                                    last_trigger_ids[closed_gate] = data_close.get('data', {}).get('triggerId', last_trigger_ids[closed_gate])
                                    print(f"✅ [BRIDGE SYNC] Đồng bộ trạng thái ĐÓNG ({closed_gate}) thành công!")
                            except Exception as e_close:
                                print(f"⚠️ Lỗi gửi close-barrier cho {closed_gate}: {e_close}")

            # 2. ĐỒNG BỘ TRẠNG THÁI 2 CỔNG TỪ BACKEND
            res = requests.get(BACKEND_STATUS_URL, timeout=2)
            if res.status_code == 200:
                data = res.json()
                if data.get('success'):
                    gates = data.get('gates', {})
                    if not gates:
                        # Fallback nếu backend trả data đơn
                        single = data.get('data', {})
                        g_name = single.get('gate', 'ENTRY_1')
                        gates = { g_name: single }

                    for gate_name, gate_info in gates.items():
                        norm_gate = gate_name.upper()
                        should_open = gate_info.get('open', False)
                        trigger_id = gate_info.get('triggerId', 0)
                        plate = gate_info.get('licensePlate', 'N/A')
                        slot = gate_info.get('slotCode', 'N/A')
                        is_hold = gate_info.get('holdOpen', False)
                        force_close = gate_info.get('forceClose', False)

                        # Khởi tạo triggerId ban đầu
                        if last_trigger_ids.get(norm_gate, 0) == 0:
                            if should_open:
                                last_trigger_ids[norm_gate] = -1
                            else:
                                last_trigger_ids[norm_gate] = trigger_id

                        # Phát hiện lệnh mới của cổng này
                        if trigger_id != last_trigger_ids.get(norm_gate, 0):
                            # A. LỆNH TẠM DỪNG / BẢO TRÌ
                            if is_hold:
                                last_trigger_ids[norm_gate] = trigger_id
                                was_hold_states[norm_gate] = True
                                print(f"\n⏸️ [PAUSE] Bật chế độ TẠM DỪNG tại {norm_gate}...")
                                ser.write(f"PAUSE|{norm_gate}\n".encode('utf-8'))
                                ser.flush()

                            # B. LỆNH TIẾP TỤC HOẠT ĐỘNG
                            elif was_hold_states.get(norm_gate, False) and not is_hold and not force_close:
                                last_trigger_ids[norm_gate] = trigger_id
                                was_hold_states[norm_gate] = False
                                print(f"\n▶️ [RESUME] Tiếp tục hoạt động bình thường tại {norm_gate}...")
                                ser.write(f"RESUME|{norm_gate}\n".encode('utf-8'))
                                ser.flush()

                            # C. LỆNH ĐÓNG CỔNG CƯỠNG CHẾ
                            elif (not should_open) and force_close:
                                last_trigger_ids[norm_gate] = trigger_id
                                was_hold_states[norm_gate] = False
                                print(f"\n🔒 [FORCE CLOSE] Đóng cổng cưỡng chế tại {norm_gate}...")
                                ser.write(f"FORCE_CLOSE|{norm_gate}\n".encode('utf-8'))
                                ser.flush()

                            # D. LỆNH MỞ CỔNG TỪ KIOSK HOẶC STAFF
                            elif should_open:
                                last_trigger_ids[norm_gate] = trigger_id
                                was_hold_states[norm_gate] = False
                                print(f"\n🎉 [GATE OPEN] Mở cổng {norm_gate}! Biển số: {plate} | Ô: {slot}")
                                cmd = f"OPEN|{plate}|{slot}|{norm_gate}\n"
                                print(f"👉 Gửi lệnh: {cmd.strip()} -> ESP32...")
                                ser.write(cmd.encode('utf-8'))
                                ser.flush()

                            # E. Đồng bộ triggerId
                            else:
                                last_trigger_ids[norm_gate] = trigger_id

        except requests.exceptions.RequestException:
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

        time.sleep(0.3)

if __name__ == '__main__':
    main()
