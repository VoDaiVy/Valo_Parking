import time
import os
import serial
import serial.tools.list_ports
import requests
from concurrent.futures import ThreadPoolExecutor

# ====================================================
# VALO PARKING - PYTHON IOT DUAL-GATE CONTROLLER
# Quản lý đồng thời 2 Cổng độc lập: ENTRY_1 & EXIT_1
# Hỗ trợ SONG SONG cả 2 Môi trường: CLOUD (Render) & LOCAL
# ====================================================

# Tự động nạp cấu hình từ backend/.env nếu có
def _load_env_file():
    possible_paths = [
        os.path.join(os.path.dirname(__file__), '..', 'backend', '.env'),
        os.path.join(os.path.dirname(__file__), '..', '.env'),
        os.path.join(os.path.dirname(__file__), '.env')
    ]
    for env_path in possible_paths:
        if os.path.exists(env_path):
            try:
                with open(env_path, 'r', encoding='utf-8') as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith('#') and '=' in line:
                            key, val = line.split('=', 1)
                            key = key.strip()
                            val = val.strip().strip('"').strip("'")
                            if key not in os.environ:
                                os.environ[key] = val
            except Exception:
                pass

_load_env_file()

SERIAL_PORT = '/dev/cu.usbserial-0001'
BAUD_RATE = 115200

# 2 Môi trường Backend (Cloud Render + Localhost)
RENDER_URL = (os.getenv('CLOUD_BACKEND_URL') or 'https://valoparking-server.onrender.com').rstrip('/')
LOCAL_URL = (os.getenv('LOCAL_BACKEND_URL') or 'http://127.0.0.1:5001').rstrip('/')

TARGET_BACKENDS = [
    {
        'id': 'render',
        'name': 'Cloud (Render)',
        'base_url': RENDER_URL,
        'status_url': f"{RENDER_URL}/api/iot/barrier-status",
        'close_url': f"{RENDER_URL}/api/iot/bridge/close-barrier",
        'timeout': 3.5,
        'is_online': False,
        'last_log_time': 0
    },
    {
        'id': 'local',
        'name': 'Localhost',
        'base_url': LOCAL_URL,
        'status_url': f"{LOCAL_URL}/api/iot/barrier-status",
        'close_url': f"{LOCAL_URL}/api/iot/bridge/close-barrier",
        'timeout': 1.5,
        'is_online': False,
        'last_log_time': 0
    }
]

BRIDGE_TOKEN = os.getenv('IOT_BRIDGE_TOKEN') or os.getenv('JWT_SECRET') or os.getenv('SESSION_QR_SECRET') or 'valo_parking_jwt_secret_key_2026_super_secure'


def find_esp32_port():
    ports = list(serial.tools.list_ports.comports())
    for p in ports:
        dev = p.device
        if any(k in dev for k in ['SLAB_USBtoUART', 'usbserial', 'CH340', 'CP210', 'ttyUSB', 'usbmodem', 'wchusbserial']):
            return dev
    return None

def connect_serial():
    port = find_esp32_port()
    if not port:
        return None
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

def notify_all_backends_close(closed_gate, executor):
    """Gửi thông báo đóng barrier về TẤT CẢ các backend (Cloud + Local) cùng lúc"""
    def send_close(backend):
        try:
            res_close = requests.post(
                backend['close_url'],
                json={'fromBridge': True, 'gate': closed_gate},
                headers={'x-bridge-token': BRIDGE_TOKEN},
                timeout=backend['timeout']
            )
            if res_close.status_code == 200:
                print(f"✅ [{backend['name']}] Đồng bộ trạng thái ĐÓNG ({closed_gate}) thành công!")
            else:
                print(f"⚠️ [{backend['name']}] Lỗi đóng ({closed_gate}): HTTP {res_close.status_code}")
        except Exception as e_close:
            pass

    executor.map(send_close, TARGET_BACKENDS)

def poll_backend_status(backend, esp_ready, port):
    """Thăm dò trạng thái barrier từ một backend"""
    try:
        res = requests.get(
            backend['status_url'],
            params={
                'esp': '1' if esp_ready else '0',
                'port': port if esp_ready else ''
            },
            headers={'x-bridge-token': BRIDGE_TOKEN},
            timeout=backend['timeout']
        )
        if res.status_code == 200:
            data = res.json()
            if data.get('success'):
                backend['is_online'] = True
                return (backend, data, None)
        backend['is_online'] = False
        return (backend, None, f"HTTP {res.status_code}")
    except Exception as e:
        backend['is_online'] = False
        return (backend, None, str(e))

def main():
    print("=" * 70)
    print("🚗 VALO PARKING - BỘ ĐIỀU KHIỂN CỔNG BARRIER DUAL-GATE (2 CỔNG) 🚗")
    print("🌐 CHẾ ĐỘ HYBRID SONG SONG: CLOUD RENDER & LOCALHOST")
    print(f"   • Cloud Backend: {RENDER_URL}")
    print(f"   • Local Backend: {LOCAL_URL}")
    print("=" * 70)

    ser = None
    executor = ThreadPoolExecutor(max_workers=4)

    # Theo dõi triggerId độc lập cho từng backend để tránh xung đột id
    last_trigger_ids = {
        'render': {'ENTRY_1': None, 'EXIT_1': None},
        'local': {'ENTRY_1': None, 'EXIT_1': None}
    }
    was_hold_states = {
        'ENTRY_1': False,
        'EXIT_1': False
    }

    # Theo dõi thời gian mở cổng ảo khi chạy chế độ Simulation (chưa cắm ESP32)
    virtual_gate_opened_at = {
        'ENTRY_1': 0,
        'EXIT_1': 0
    }
    last_reconnect_check = 0
    has_warned_virtual = False

    # Theo dõi dữ liệu công suất cho Màn hình LCD thứ 3 (Parking Occupancy Display)
    last_capacity = {
        'available': -1,
        'occupied': -1,
        'total': -1
    }
    last_capacity_sync_time = 0

    while True:
        now = time.time()

        # Thử kết nối / kết nối lại ESP32 mỗi 3 giây nếu chưa có cổng
        if ser is None or not ser.is_open:
            if now - last_reconnect_check >= 3.0:
                last_reconnect_check = now
                ser = connect_serial()
                if ser and ser.is_open:
                    has_warned_virtual = False
                    print("📡 Sẵn sàng lắng nghe sự kiện từ Kiosk Web & Staff Panel (Chế độ Hardware Thật)...\n")
                elif not has_warned_virtual:
                    has_warned_virtual = True
                    print("⚠️ Chưa phát hiện cáp ESP32 (hoặc cáp bị tuột).")
                    print("👉 TỰ ĐỘNG CHUYỂN SANG CHẾ ĐỘ GIẢ LẬP (SIMULATION): Hệ thống vẫn sẽ mở & tự đóng cổng sau 4s để Kiosk hoạt động bình thường!")
                    print("💡 Ngay khi cắm cáp ESP32 vào cổng USB, hệ thống sẽ tự động nhận diện lại.\n")

        try:
            # 1. ĐỌC PHẢN HỒI TỪ ESP32 KHI CÓ XE QUA CỔNG (NẾU CÓ HARDWARE)
            if ser and ser.is_open:
                while ser.in_waiting:
                    raw_line = ser.readline()
                    if raw_line:
                        msg = raw_line.decode('utf-8', errors='ignore').strip()
                        if msg:
                            print(f"   [ESP32]: {msg}")

                            closed_gate = None
                            if "GATE_CLOSED_EXIT_1" in msg:
                                closed_gate = 'EXIT_1'
                            elif "GATE_CLOSED_ENTRY_1" in msg or msg == "GATE_CLOSED":
                                closed_gate = 'ENTRY_1'

                            if closed_gate:
                                print(f"🔒 [BRIDGE SYNC] Cổng {closed_gate} đã đóng xong -> Đồng bộ về cả Cloud & Local...")
                                notify_all_backends_close(closed_gate, executor)

            # 2. XỬ LÝ TỰ ĐỘNG ĐÓNG CỔNG Ở CHẾ ĐỘ GIẢ LẬP (NẾU CHƯA CẮM ESP32)
            for g_name, opened_time in list(virtual_gate_opened_at.items()):
                if opened_time > 0 and (now - opened_time >= 4.0):
                    virtual_gate_opened_at[g_name] = 0
                    print(f"🔒 [MÔ PHỎNG XE QUA CỔNG] Xe đã chạy qua cổng {g_name} -> Tự động đóng barrier và báo Kiosk về trang chủ...")
                    notify_all_backends_close(g_name, executor)

            # 3. ĐỒNG BỘ TRẠNG THÁI TỪ CẢ 2 BACKEND (PARALLEL CONCURRENT FETCH)
            esp_ready = bool(ser and ser.is_open)
            current_port = getattr(ser, 'port', '') if esp_ready else ''

            futures = [
                executor.submit(poll_backend_status, b, esp_ready, current_port)
                for b in TARGET_BACKENDS
            ]

            for future in futures:
                backend, data, err = future.result()
                b_id = backend['id']
                b_name = backend['name']

                if err:
                    if now - backend['last_log_time'] >= 15.0:
                        backend['last_log_time'] = now
                        print(f"ℹ️ [{b_name}]: Đang thử kết nối... ({err})")
                    continue

                if data and data.get('success'):
                    gates = data.get('gates', {})
                    if not gates:
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
                        if last_trigger_ids[b_id].get(norm_gate) is None:
                            if should_open or is_hold or force_close:
                                last_trigger_ids[b_id][norm_gate] = -1
                            else:
                                last_trigger_ids[b_id][norm_gate] = trigger_id

                        # Phát hiện lệnh mới từ backend này
                        if trigger_id != last_trigger_ids[b_id].get(norm_gate, 0):
                            # A. LỆNH TẠM DỪNG / BẢO TRÌ
                            if is_hold:
                                last_trigger_ids[b_id][norm_gate] = trigger_id
                                was_hold_states[norm_gate] = True
                                print(f"\n⏸️ [PAUSE từ {b_name}] Bật chế độ TẠM DỪNG tại {norm_gate}...")
                                if ser and ser.is_open:
                                    ser.write(f"PAUSE|{norm_gate}\n".encode('utf-8'))
                                    ser.flush()

                            # B. LỆNH TIẾP TỤC HOẠT ĐỘNG
                            elif was_hold_states.get(norm_gate, False) and not is_hold and not force_close:
                                last_trigger_ids[b_id][norm_gate] = trigger_id
                                was_hold_states[norm_gate] = False
                                print(f"\n▶️ [RESUME từ {b_name}] Tiếp tục hoạt động bình thường tại {norm_gate}...")
                                if ser and ser.is_open:
                                    ser.write(f"RESUME|{norm_gate}\n".encode('utf-8'))
                                    ser.flush()

                            # C. LỆNH ĐÓNG CỔNG
                            elif not should_open:
                                last_trigger_ids[b_id][norm_gate] = trigger_id
                                was_hold_states[norm_gate] = False
                                virtual_gate_opened_at[norm_gate] = 0
                                cmd_str = "FORCE_CLOSE" if force_close else "CLOSE"
                                print(f"\n🔒 [GATE CLOSE từ {b_name}] Đóng cổng {norm_gate} (Lệnh: {cmd_str})...")
                                if ser and ser.is_open:
                                    ser.write(f"{cmd_str}|{norm_gate}\n".encode('utf-8'))
                                    ser.flush()

                            # D. LỆNH MỞ CỔNG TỪ KIOSK HOẶC STAFF
                            elif should_open:
                                last_trigger_ids[b_id][norm_gate] = trigger_id
                                was_hold_states[norm_gate] = False
                                print(f"\n🎉 [GATE OPEN từ {b_name}] Mở cổng {norm_gate}! Biển số: {plate} | Ô: {slot}")
                                
                                if ser and ser.is_open:
                                    cmd = f"OPEN|{plate}|{slot}|{norm_gate}\n"
                                    print(f"👉 Gửi lệnh: {cmd.strip()} -> ESP32...")
                                    ser.write(cmd.encode('utf-8'))
                                    ser.flush()
                                else:
                                    print(f"👉 [CHẾ ĐỘ MÔ PHỎNG] Cổng {norm_gate} đang mở ảo, sẽ tự đóng sau 4 giây...")
                                    virtual_gate_opened_at[norm_gate] = time.time()

                            # E. Đồng bộ triggerId
                            else:
                                last_trigger_ids[b_id][norm_gate] = trigger_id

                    # 4. ĐỒNG BỘ CÔNG SUẤT BÃI XE CHO MÀN HÌNH LCD THỨ 3 (NẾU CÓ)
                    capacity_data = data.get('capacity')
                    if capacity_data and isinstance(capacity_data, dict):
                        c_avail = int(capacity_data.get('available', 0))
                        c_occ = int(capacity_data.get('occupied', 0))
                        c_total = int(capacity_data.get('total', 0))

                        has_changed = (
                            c_avail != last_capacity['available'] or
                            c_occ != last_capacity['occupied'] or
                            c_total != last_capacity['total']
                        )

                        if has_changed or (now - last_capacity_sync_time >= 30.0):
                            last_capacity = {'available': c_avail, 'occupied': c_occ, 'total': c_total}
                            last_capacity_sync_time = now
                            cmd_cap = f"CAPACITY|{c_avail}|{c_occ}|{c_total}\n"
                            if ser and ser.is_open:
                                ser.write(cmd_cap.encode('utf-8'))
                                ser.flush()
                            if has_changed:
                                print(f"📊 [LCD CAPACITY ({b_name})] Available {c_avail} | Occupied {c_occ} | Total {c_total}")

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
            print(f"⚠️ Lỗi vòng lặp chính: {e}")
            if "device not configured" in str(e).lower() or "bad file descriptor" in str(e).lower():
                ser = None

        time.sleep(0.3)

if __name__ == '__main__':
    main()
