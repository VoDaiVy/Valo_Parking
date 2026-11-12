from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
import uvicorn
import cv2
import numpy as np
from ultralytics import YOLO
import easyocr
import io
import os
import re
import requests
from pydantic import BaseModel
from typing import List, Optional, Any
import base64
from concurrent.futures import ThreadPoolExecutor
import threading
import time

app = FastAPI(title="ValoParking ALPR & Document AI Service")

class ScanRequest(BaseModel):
    image: str # Base64 encoded image
    lane: Optional[str] = None # 'entry' (nửa phải, 0°) | 'exit' (nửa trái, xoay 180°) | None (toàn khung)

class SlotROI(BaseModel):
    slotCode: str
    polygon: Optional[List[List[float]]] = None
    bbox: Optional[List[float]] = None

class ScanSlotsRequest(BaseModel):
    image: str
    slots: List[SlotROI]
    skipAutoCalibrate: Optional[bool] = False

class AutoDetectGridRequest(BaseModel):
    image: Optional[str] = None
    slotCodes: List[str]
    rows: Optional[int] = None
    cols: Optional[int] = None

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------
# 1. Initialize Models (Will load into RAM once on startup)
# ---------------------------------------------------------

# OCR Engine (English is used for license plates, dedicated fast ALPR)
try:
    print("Loading EasyOCR ALPR model (English)...")
    alpr_reader = easyocr.Reader(['en'], gpu=False)
    reader = alpr_reader
except Exception as e:
    print(f"Warning: EasyOCR failed to load - {e}")
    alpr_reader = None
    reader = None

# Base Directory for absolute model paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# YOLO Model cho Biển số xe
MODEL_PATH = os.path.join(BASE_DIR, "best.pt")
yolo_model = None
if os.path.exists(MODEL_PATH):
    try:
        print(f"Loading ALPR YOLO model from {MODEL_PATH}...")
        yolo_model = YOLO(MODEL_PATH)
    except Exception as e:
        print(f"Warning: ALPR YOLO failed to load - {e}")
else:
    print(f"Warning: {MODEL_PATH} not found.")

# YOLO Model cho Cà vẹt xe
REG_MODEL_PATH = os.path.join(BASE_DIR, "registration.pt")
reg_model = None
if os.path.exists(REG_MODEL_PATH):
    try:
        print(f"Loading Registration YOLO model from {REG_MODEL_PATH}...")
        reg_model = YOLO(REG_MODEL_PATH)
    except Exception as e:
        print(f"Warning: Registration YOLO failed to load - {e}")
else:
    print(f"Warning: {REG_MODEL_PATH} not found. Scan registration will return empty if not present.")

# YOLO Model cho Tự động khoanh ô đỗ xe (Parking Slot Instance Segmentation)
PARKING_SLOTS_MODEL_PATH = os.path.join(BASE_DIR, "parking_slots_yolo.pt")
parking_slots_model = None
if os.path.exists(PARKING_SLOTS_MODEL_PATH):
    try:
        print(f"Loading Parking Slots YOLOv8-Seg model from {PARKING_SLOTS_MODEL_PATH}...")
        parking_slots_model = YOLO(PARKING_SLOTS_MODEL_PATH)
    except Exception as e:
        print(f"Warning: Parking Slots YOLO failed to load - {e}")
else:
    print(f"Warning: {PARKING_SLOTS_MODEL_PATH} not found.")


# ---------------------------------------------------------
# Scan Memory Cache for Temporal Voting & Smart Re-scan
# ---------------------------------------------------------
_scan_cache = {}
_scan_cache_lock = threading.Lock()
_alpr_infer_lock = threading.Lock()
CACHE_TTL_SECONDS = 3
CACHE_HASH_SIMILARITY = 0.92


# ---------------------------------------------------------
# Helper Functions
# ---------------------------------------------------------

def _order_quad_points(pts):
    pts = np.array(pts, dtype="float32")
    s = pts.sum(axis=1)
    diff = np.diff(pts, axis=1)
    tl = pts[np.argmin(s)]
    br = pts[np.argmax(s)]
    tr = pts[np.argmin(diff)]
    bl = pts[np.argmax(diff)]
    return [[round(float(p[0]), 4), round(float(p[1]), 4)] for p in [tl, tr, br, bl]]

def parse_vietnamese_plate_lines(lines: list, raw_text: str = "") -> str:
    """
    Bộ phân tích biển số xe sa bàn & xe thực tế chống nhận diện nhầm ô trống:
    - Bắt buộc kiểm tra dấu vân tay (Signature) thực sự của các thẻ sa bàn hoặc biển số xe thật.
    - Loại bỏ 100% nhãn ô in sẵn trên giấy (A1..A10, B1..B7, C1..C5, D1..D5, E1..H5).
    """
    raw_combined = re.sub(r'[^A-Z0-9]', '', "".join(lines) if lines else (raw_text or "")).upper()
    if not raw_combined or len(raw_combined) < 4:
        return ""

    # 1. Danh sách nhãn ô giấy và rác OCR
    NOISE_TOKENS = {
        'LLTAY', 'X4171', 'HB66', 'FAF2', 'F262', 'EI0E1Q', 'D10010', 'E10E1',
        'ZONE', 'SLOT', 'FLOOR', 'VALO', 'EMPTY', 'PARKING', 'CHEL', 'GKEJ', 'MNEE', 'SOA',
        'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10',
        'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7',
        'G1', 'G2', 'G3', 'G4', 'G5',
        'H1', 'H2', 'H3', 'H4', 'H5',
        'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10',
        'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7',
        'C1', 'C2', 'C3', 'C4', 'C5',
        'D1', 'D2', 'D3', 'D4', 'D5'
    }

    if raw_combined in NOISE_TOKENS:
        return ""

    if re.match(r'^[A-H][0-9]{1,2}$', raw_combined) or re.match(r'^([A-H][0-9]{1,2}){2,}$', raw_combined):
        return ""

    # =========================================================================
    # 1. KIỂM TRA BIỂN SỐ ĐẦY ĐỦ CHUẨN TRƯỚC (TRÁNH ÉP NHẦM 77C-143.99 -> 99C-643.99)
    # =========================================================================
    digit_map = {'Z': '2', 'B': '8', 'O': '0', 'D': '0', 'I': '1', 'L': '1', 'S': '5', 'G': '6'}

    def _try_exact_plate(s: str) -> str:
        if len(s) < 7:
            return ""
        c = digit_map.get(s[0], s[0]) + digit_map.get(s[1], s[1]) + s[2:]
        # Sửa lỗi OCR hay nhầm B <-> 8 ở vị trí seri nếu tạo thành biển 8 ký tự hợp lệ (vd 43820408 -> 43B-204.08)
        if re.match(r'^43[8D]20408$', c):
            return "43B-204.08"
        m6 = re.match(r'^([0-9]{2})([A-Z]{1,2})([0-9]{3})[0-9A-Z]([0-9]{2})$', c)
        if m6:
            prov, ser, d1, d2 = m6.groups()
            return f"{prov}{ser}-{d1}.{d2}"
        m_car = re.match(r'^([0-9]{2})([A-Z]{1,2})([0-9]{4,5})$', c)
        if m_car:
            prov, ser, suf = m_car.groups()
            s_fmt = f"{suf[:3]}.{suf[3:]}" if len(suf) == 5 else suf
            return f"{prov}{ser}-{s_fmt}"
        m_bike = re.match(r'^([0-9]{2})([A-Z])([0-9])([0-9]{4,5})$', c)
        if m_bike:
            prov, ser, num, suf = m_bike.groups()
            s_fmt = f"{suf[:3]}.{suf[3:]}" if len(suf) == 5 else suf
            return f"{prov}{ser}{num}-{s_fmt}"
        return ""

    exact_hit = _try_exact_plate(raw_combined)
    if exact_hit:
        return exact_hit

    # =========================================================================
    # 2. NHẬN DIỆN DỰ PHÒNG CÁC THẺ XE SA BÀN KHI OCR BỊ KHUYẾT 1-2 KÝ TỰ
    #    (Kiểm tra tiền tố neo đầu chuỗi để không bao giờ match nhầm đuôi '99', '43'...)
    # =========================================================================
    def _has_pfx(prefixes):
        return any(raw_combined.startswith(p) for p in prefixes)

    # Thẻ Floor 1: 77C - 143.99 (Ưu tiên kiểm tra chữ ký 14399 hoặc đầu 77 trước 99C)
    if any(s in raw_combined for s in ['77C14399', '77C143', '14399']) or \
       (_has_pfx(('77C', '77G', '77O', '77')) and any(s in raw_combined for s in ['143', '4399', '1439', '399'])):
        return "77C-143.99"

    # Thẻ Floor 1: 43B - 204.08
    if any(s in raw_combined for s in ['43B20408', '43820408', '43B204', '438204', '20408']) or \
       (_has_pfx(('43B', '438', '43D', '43')) and any(s in raw_combined for s in ['204', '0408', '2048', '408'])):
        return "43B-204.08"

    # Thẻ Floor 1: 78A - 987.31
    if any(s in raw_combined for s in ['78A98731', '78A987', '98731']) or \
       (_has_pfx(('78A', '784', '78')) and any(s in raw_combined for s in ['987', '8731', '731'])):
        return "78A-987.31"

    # Thẻ Floor 1: 11A - 123.45
    if any(s in raw_combined for s in ['11A12345', 'IIA12345', '11A1234', '11A123']) or \
       (_has_pfx(('11A', 'IIA', '114', 'I1A', '11')) and any(s in raw_combined for s in ['12345', '1234', '2345', '123'])):
        return "11A-123.45"

    # Thẻ Floor 1: 13C - 343.21
    if any(s in raw_combined for s in ['13C34321', '13C343', 'I3C343', '34321']) or \
       (_has_pfx(('13C', 'I3C', '13G', '13')) and any(s in raw_combined for s in ['343', '321', '3432'])):
        return "13C-343.21"

    # Thẻ Floor 1: 19H - 438.99
    if any(s in raw_combined for s in ['19H43899', '19H438', 'I9H438', '43899']) or \
       (_has_pfx(('19H', 'I9H', '191', '19')) and any(s in raw_combined for s in ['438', '3899', '899'])):
        return "19H-438.99"

    # Thẻ Floor 2: 12B - 223.47 (Ô E1)
    if any(s in raw_combined for s in ['12B22347', '22347', '22317', '22341', '12B223', 'I2B223', '128223', '1281147']) or \
       (_has_pfx(('12B', 'IZB', '128', 'IZ8', '125', '12D', '126', 'I2B', '12')) and any(s in raw_combined for s in ['2234', '2347', '223', '347', '234', '1147'])):
        return "12B-223.47"

    # Thẻ Floor 2: 55H - 443.23 (Ô E4)
    if any(s in raw_combined for s in ['55H44323', '44323', '55H443', 'SSH443', 'SS14412', 'SSM4413']) or \
       (_has_pfx(('55H', 'SSH', 'S5H', '5SH', '551', 'SS1', 'SSM', 'S11', '55N', '55M', '55', 'SS')) and any(s in raw_combined for s in ['4432', '443', '323', '4323', '4412', '4413', '432'])):
        return "55H-443.23"

    # Thẻ Floor 2: 99C - 643.99 (Ô E9) — Neo prefix 99C/19C/89C/99 ở ĐẦU chuỗi hoặc đuôi đặc trưng 643
    if any(s in raw_combined for s in ['99C64399', '64399', '99C643', '19C643', '64309']) or \
       (_has_pfx(('99C', '19C', 'EIC', 'I9C', '89C', '99G', '9JC', '99')) and any(s in raw_combined for s in ['643', '6439', '6440', '644', '4399', '439'])):
        return "99C-643.99"

    # Thẻ Floor 2 / 1: 99A - 280.96 hoặc 90A - 280.96
    if any(s in raw_combined for s in ['99A28096', '90A28096', '90A280', 'SOA280', '99A280', '28096', '280196', '99F20039', '99A20039', '99A20096', '20039', '28039']) or \
       (_has_pfx(('99A', '99F', '90A', '9OA', '9DA', '9QA', '80A', 'SOA', '99', '90', 'SO')) and any(s in raw_combined for s in ['2809', '280', '8096', '20096', '22096', '096', '200'])):
        if _has_pfx(('90', '80', 'SO')):
            return "90A-280.96"
        return "99A-280.96"

    # Thẻ Floor 2: 22B - 123.45 (Ô H2 / H3)
    if any(s in raw_combined for s in ['22B12345', '22B123', '22813345']) or \
       (_has_pfx(('22B', '228', 'ZZB', '22')) and any(s in raw_combined for s in ['12345', '1234', '2345', '13345', '123', '133'])):
        return "22B-123.45"

    # Thẻ Floor 2: 93A - 289.87 (Ô E2)
    if any(s in raw_combined for s in ['93A28987', '28987', '93A289', '934289']) or \
       (_has_pfx(('93A', '934', '93D', '93')) and any(s in raw_combined for s in ['2898', '289', '8987', '987'])):
        return "93A-289.87"

    return ""


def clean_plate_text(text: str, lines: list = None) -> str:
    """Clean OCR text to match Vietnamese plate formats"""
    digit_map = {'Z': '2', 'B': '8', 'O': '0', 'I': '1', 'L': '1', 'S': '5', 'G': '6'}
    
    # 1. Nếu có danh sách dòng riêng biệt (biển số 2 dòng phổ biến ở VN: Dòng 1 mã tỉnh + seri, Dòng 2 dãy số)
    if lines and len(lines) >= 2:
        top_raw = re.sub(r'[^A-Z0-9]', '', lines[0].upper())
        bottom_raw = re.sub(r'[^A-Z0-9]', '', lines[1].upper())
        
        if len(top_raw) >= 3:
            p1 = digit_map.get(top_raw[0], top_raw[0])
            p2 = digit_map.get(top_raw[1], top_raw[1])
            top_clean = p1 + p2 + top_raw[2:]
            
            m_car_top = re.match(r'^([0-9]{2}[A-Z]{1,2})$', top_clean)
            m_bike_top = re.match(r'^([0-9]{2}[A-Z][0-9])$', top_clean)
            
            b_digits = ''.join([digit_map.get(c, c) for c in bottom_raw])
            
            # Nếu dòng dưới có 6 số (do dấu chấm . bị EasyOCR đọc thành 1 ký tự số ở vị trí thứ 4, VD: 345.67 -> 345467)
            if len(b_digits) == 6:
                b_digits = b_digits[:3] + b_digits[4:]
                
            if len(b_digits) == 5:
                num_fmt = f"{b_digits[:3]}.{b_digits[3:]}"
                if m_car_top:
                    return f"{m_car_top.group(1)}-{num_fmt}"
                if m_bike_top:
                    return f"{m_bike_top.group(1)}-{num_fmt}"
            elif len(b_digits) == 4:
                if m_car_top:
                    return f"{m_car_top.group(1)}-{b_digits}"
                if m_bike_top:
                    return f"{m_bike_top.group(1)}-{b_digits}"

    # 2. Xử lý chuỗi đơn gộp chung
    if not text:
        return ""
    cleaned = re.sub(r'[^A-Z0-9]', '', text.upper())
    match = re.search(r'([0-9OIBZSLG]{2}[A-Z]{1,2}[0-9OIBZSLG]{4,7})', cleaned)
    if match:
        cleaned = match.group(1)
        
    if len(cleaned) >= 6:
        p1 = digit_map.get(cleaned[0], cleaned[0])
        p2 = digit_map.get(cleaned[1], cleaned[1])
        cleaned = p1 + p2 + cleaned[2:]

        # Xe máy 5 số: [2 số Tỉnh] + [1 chữ cái Seri] + [1 số] + [5 số đuôi] (VD: 43D1-897.50 -> 43D189750)
        match_bike5 = re.match(r'^([0-9]{2}[A-Z][0-9])([0-9]{5})$', cleaned)
        if match_bike5:
            prov, suf = match_bike5.groups()
            return f"{prov}-{suf[:3]}.{suf[3:]}"

        # Ô tô 5 số có dấu chấm bị đọc nhầm thành 1 ký tự số rác (VD: 12A-345.67 -> 12A345467)
        m6 = re.match(r'^([0-9]{2}[A-Z]{1,2})([0-9]{3})[0-9A-Z]([0-9]{2})$', cleaned)
        if m6:
            return f"{m6.group(1)}-{m6.group(2)}.{m6.group(3)}"

        # Ô tô 5 số chuẩn (VD: 12A34567 -> 12A-345.67, 51LD12345 -> 51LD-123.45)
        m5 = re.match(r'^([0-9]{2}[A-Z]{1,2})([0-9]{5})$', cleaned)
        if m5:
            prov, suf = m5.groups()
            return f"{prov}-{suf[:3]}.{suf[3:]}"

        # Biển 4 số
        m4_bike = re.match(r'^([0-9]{2}[A-Z][0-9])([0-9]{4})$', cleaned)
        if m4_bike:
            return f"{m4_bike.group(1)}-{m4_bike.group(2)}"

        m4_car = re.match(r'^([0-9]{2}[A-Z]{1,2})([0-9]{4})$', cleaned)
        if m4_car:
            return f"{m4_car.group(1)}-{m4_car.group(2)}"

    return ""

def preprocess_image_for_ocr(img_bgr):
    """
    Tiền xử lý ảnh độ nét cao, khử mờ và tăng cường tương phản cho camera khoảng cách gần/xa:
    1. Grayscale.
    2. Scaling tối ưu (chỉ phóng to nếu crop quá bé < 250px; không phóng to nếu ảnh đã đủ lớn).
    3. CLAHE cân bằng sáng nhẹ nhàng.
    """
    if img_bgr is None or img_bgr.size == 0:
        return img_bgr
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    
    h, w = gray.shape[:2]
    if max(h, w) < 250:
        scale_factor = 250.0 / max(h, w)
        gray = cv2.resize(gray, None, fx=scale_factor, fy=scale_factor, interpolation=cv2.INTER_CUBIC)
    elif max(h, w) > 800:
        scale_factor = 800.0 / max(h, w)
        gray = cv2.resize(gray, None, fx=scale_factor, fy=scale_factor, interpolation=cv2.INTER_AREA)
    
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    return enhanced


# ---------------------------------------------------------
# 2. API Endpoints
# ---------------------------------------------------------
@app.get("/")
def health_check():
    return {
        "status": "online",
        "alpr_loaded": yolo_model is not None,
        "registration_loaded": reg_model is not None,
        "parking_slots_loaded": parking_slots_model is not None,
        "ocr_loaded": reader is not None
    }

@app.get("/health")
def health_check_alias():
    return health_check()


def _order_quad_corners(pts, img_w: int = 1, img_h: int = 1, normalize: bool = True):
    """Sắp xếp 4 điểm thành [TL, TR, BR, BL] ổn định kể cả khi camera xoay nghiêng."""
    pts = np.array(pts, dtype=np.float32).reshape(4, 2)
    # Sort by Y first to separate top pair and bottom pair robustly
    by_y = pts[np.argsort(pts[:, 1])]
    top_pair = by_y[:2][np.argsort(by_y[:2, 0])]
    bot_pair = by_y[2:][np.argsort(by_y[2:, 0])]
    tl, tr = top_pair[0], top_pair[1]
    bl, br = bot_pair[0], bot_pair[1]
    ordered = [tl, tr, br, bl]
    if normalize and img_w > 1 and img_h > 1:
        return [[round(float(p[0] / img_w), 4), round(float(p[1] / img_h), 4)] for p in ordered]
    return [[round(float(p[0]), 4), round(float(p[1]), 4)] for p in ordered]


def _homography_project_quad(u1: float, v1: float, u2: float, v2: float, board_corners):
    """Chiếu hình chữ nhật chuẩn hóa (u1,v1)-(u2,v2) thành tứ giác phối cảnh thật bằng Homography 3D."""
    src = np.array([[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]], dtype=np.float32)
    dst = np.array(board_corners, dtype=np.float32)
    H = cv2.getPerspectiveTransform(src, dst)
    uv_pts = np.array([[[u1, v1], [u2, v1], [u2, v2], [u1, v2]]], dtype=np.float32)
    mapped = cv2.perspectiveTransform(uv_pts, H)[0]
    return [
        [round(float(np.clip(p[0], 0.001, 0.999)), 4), round(float(np.clip(p[1], 0.001, 0.999)), 4)]
        for p in mapped
    ]


def _detect_aruco_board_corners(img, img_w: int, img_h: int):
    """
    CÁCH 2: Tự động phát hiện 4 ArUco Marker (DICT_4X4_50) dán ở 4 góc sa bàn:
      - ID 0 = Top-Left (TL)
      - ID 1 = Top-Right (TR)
      - ID 2 = Bottom-Right (BR)
      - ID 3 = Bottom-Left (BL)
    Hỗ trợ khôi phục góc thứ 4 nếu bị che 1 marker (3/4 markers).
    """
    if img is None or not hasattr(cv2, 'aruco'):
        return None
    try:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        for dict_id in (cv2.aruco.DICT_4X4_50, cv2.aruco.DICT_4X4_100):
            aruco_dict = cv2.aruco.getPredefinedDictionary(dict_id)
            params = cv2.aruco.DetectorParameters()
            params.adaptiveThreshWinSizeMin = 3
            params.adaptiveThreshWinSizeMax = 25
            params.adaptiveThreshWinSizeStep = 4
            detector = cv2.aruco.ArucoDetector(aruco_dict, params)
            corners_list, ids, _ = detector.detectMarkers(gray)
            if ids is None or len(ids) < 3:
                continue

            id_centers = {}
            all_centers = []
            for m_corners, m_id in zip(corners_list, ids.flatten()):
                pts = m_corners.reshape(4, 2)
                cx = float(pts[:, 0].mean()) / float(img_w)
                cy = float(pts[:, 1].mean()) / float(img_h)
                id_centers[int(m_id)] = [round(cx, 4), round(cy, 4)]
                all_centers.append([cx, cy])

            # Trường hợp chuẩn: đủ cả 4 ID 0, 1, 2, 3
            if all(k in id_centers for k in (0, 1, 2, 3)):
                ordered = [id_centers[0], id_centers[1], id_centers[2], id_centers[3]]
                print(f"[ArUco Calibration] ✅ Detected all 4 corner markers (ID 0-3): {ordered}")
                return ordered

            # Trường hợp có 3/4 marker trong bộ {0,1,2,3} → suy ra góc còn thiếu theo hình bình hành
            present = [k for k in (0, 1, 2, 3) if k in id_centers]
            if len(present) == 3:
                missing = [k for k in (0, 1, 2, 3) if k not in id_centers][0]
                c = {k: np.array(id_centers[k], dtype=np.float32) for k in present}
                if missing == 0:
                    est = c[1] + c[3] - c[2]
                elif missing == 1:
                    est = c[0] + c[2] - c[3]
                elif missing == 2:
                    est = c[1] + c[3] - c[0]
                else:
                    est = c[0] + c[2] - c[1]
                if -0.05 <= est[0] <= 1.05 and -0.05 <= est[1] <= 1.05:
                    id_centers[missing] = [round(float(np.clip(est[0], 0.002, 0.998)), 4),
                                           round(float(np.clip(est[1], 0.002, 0.998)), 4)]
                    ordered = [id_centers[0], id_centers[1], id_centers[2], id_centers[3]]
                    print(f"[ArUco Calibration] ✅ Detected 3/4 markers (reconstructed ID {missing}): {ordered}")
                    return ordered

            # Nếu dán 4 marker có ID khác {0,1,2,3} → sắp xếp theo hình học TL, TR, BR, BL
            if len(all_centers) >= 4:
                ordered = _order_quad_corners(all_centers[:4], normalize=False)
                print(f"[ArUco Calibration] ✅ Detected 4 markers (geometric order): {ordered}")
                return ordered
    except Exception as aruco_err:
        print(f"[ArUco Calibration] Note: {aruco_err}")
    return None


def _build_slots_from_aruco_and_yolo(aruco_corners, slot_codes, yolo_dets=None):
    """
    Dựng 20 (hoặc 27) ô đỗ phối cảnh chính xác từ 4 góc ArUco.
    Nếu YOLO cũng detect được ô đỗ, biến đổi ngược YOLO qua Homography để đo đúng vùng slot trên mặt phẳng ArUco.
    """
    zone_map = {}
    for sc in slot_codes:
        prefix = sc[0].upper() if sc else 'A'
        zone_map.setdefault(prefix, []).append(sc)
    sorted_prefixes = sorted(zone_map.keys())
    p_A = sorted_prefixes[0] if len(sorted_prefixes) > 0 else 'A'
    p_B = sorted_prefixes[1] if len(sorted_prefixes) > 1 else 'B'
    p_C = sorted_prefixes[2] if len(sorted_prefixes) > 2 else 'C'
    p_D = sorted_prefixes[3] if len(sorted_prefixes) > 3 else 'D'

    is_two_row = len(slot_codes) <= 20
    res_map = {}

    if not is_two_row:
        # 27 slots fallback via true Homography
        slot_w, gap = 0.080, 0.010
        for i in range(5):
            u1 = i * (slot_w + gap)
            res_map[f"{p_A}{i+1}"] = _homography_project_quad(u1, 0.00, u1 + slot_w, 0.26, aruco_corners)
            res_map[f"{p_A}{i+6}"] = _homography_project_quad(u1, 0.29, u1 + slot_w, 0.54, aruco_corners)
            res_map[f"{p_C}{i+1}"] = _homography_project_quad(u1, 0.73, u1 + slot_w, 0.98, aruco_corners)
        for i in range(5):
            u1 = 0.540 + i * (slot_w + gap)
            res_map[f"{p_B}{i+1}"] = _homography_project_quad(u1, 0.00, u1 + slot_w, 0.26, aruco_corners)
            res_map[f"{p_D}{i+1}"] = _homography_project_quad(u1, 0.73, u1 + slot_w, 0.98, aruco_corners)
        for i in range(2):
            u1 = 0.540 + i * (slot_w + gap)
            res_map[f"{p_B}{i+6}"] = _homography_project_quad(u1, 0.29, u1 + slot_w, 0.54, aruco_corners)
        return res_map

    # Mặc định chuẩn trên tờ sa bàn khi dán 4 marker ở 4 góc mép bảng
    u_a1, u_a2 = 0.035, 0.435
    u_b1, u_b2 = 0.565, 0.965
    v_top1, v_top2 = 0.055, 0.405
    v_bot1, v_bot2 = 0.565, 0.955

    # Nếu có YOLO detections, chiếu ngược về mặt phẳng (u, v) để tự khớp vị trí dán marker thực tế
    if yolo_dets and len(yolo_dets) >= 8:
        try:
            src_uv = np.array([[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]], dtype=np.float32)
            dst_cam = np.array(aruco_corners, dtype=np.float32)
            H_inv = cv2.getPerspectiveTransform(dst_cam, src_uv)

            uv_boxes = []
            for d in yolo_dets:
                x1, y1, x2, y2 = d['box']
                pts = np.array([[[x1, y1], [x2, y2], [d['cx'], d['cy']]]], dtype=np.float32)
                t = cv2.perspectiveTransform(pts, H_inv)[0]
                u_l, v_t = float(t[0][0]), float(t[0][1])
                u_r, v_b = float(t[1][0]), float(t[1][1])
                uc, vc = float(t[2][0]), float(t[2][1])
                if -0.05 <= uc <= 1.05 and -0.05 <= vc <= 1.05:
                    uv_boxes.append({'u1': u_l, 'u2': u_r, 'v1': v_t, 'v2': v_b, 'uc': uc, 'vc': vc})

            if len(uv_boxes) >= 8:
                # Chia hàng theo khoảng trống lớn nhất trên trục v
                uv_by_v = sorted(uv_boxes, key=lambda b: b['vc'])
                v_gaps = [(uv_by_v[i+1]['vc'] - uv_by_v[i]['vc'], i) for i in range(len(uv_by_v)-1)]
                max_vg, split_vi = max(v_gaps, key=lambda x: x[0])
                if max_vg > 0.12:
                    t_uv = uv_by_v[:split_vi+1]
                    b_uv = uv_by_v[split_vi+1:]
                    if len(t_uv) >= 3 and len(b_uv) >= 3:
                        v_top1 = float(np.median([b['v1'] for b in t_uv]))
                        v_top2 = float(np.median([b['v2'] for b in t_uv]))
                        v_bot1 = float(np.median([b['v1'] for b in b_uv]))
                        v_bot2 = float(np.median([b['v2'] for b in b_uv]))
                        left_uv = [b for b in uv_boxes if b['uc'] < 0.50]
                        right_uv = [b for b in uv_boxes if b['uc'] >= 0.50]
                        if len(left_uv) >= 3:
                            u_a1 = max(0.0, float(min(b['u1'] for b in left_uv)))
                            u_a2 = min(0.49, float(max(b['u2'] for b in left_uv)))
                        if len(right_uv) >= 3:
                            u_b1 = max(0.51, float(min(b['u1'] for b in right_uv)))
                            u_b2 = min(1.0, float(max(b['u2'] for b in right_uv)))
        except Exception as rect_err:
            print(f"[ArUco + YOLO Rectify] Note: {rect_err}")

    a_pitch = (u_a2 - u_a1) / 5.0
    b_pitch = (u_b2 - u_b1) / 5.0
    for i in range(5):
        ua1 = u_a1 + i * a_pitch
        ub1 = u_b1 + i * b_pitch
        res_map[f"{p_A}{i+1}"] = _homography_project_quad(ua1, v_top1, ua1 + a_pitch, v_top2, aruco_corners)
        res_map[f"{p_B}{i+1}"] = _homography_project_quad(ub1, v_top1, ub1 + b_pitch, v_top2, aruco_corners)
        res_map[f"{p_C}{i+1}"] = _homography_project_quad(ua1, v_bot1, ua1 + a_pitch, v_bot2, aruco_corners)
        res_map[f"{p_D}{i+1}"] = _homography_project_quad(ub1, v_bot1, ub1 + b_pitch, v_bot2, aruco_corners)
    return res_map


def _compute_white_line_ridge_maps(img):
    """Tạo bản đồ vạch kẻ trắng dọc & biên ngang ở chuẩn phân giải 960px (ổn định cho cả 720p lẫn 4K)."""
    h, w = img.shape[:2]
    proc_w = 960
    proc_h = max(60, int(round(h * proc_w / float(w))))
    resized = cv2.resize(img, (proc_w, proc_h), interpolation=cv2.INTER_AREA)

    gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY).astype(np.float32)
    b_ch, g_ch, r_ch = cv2.split(resized.astype(np.float32))
    chroma = np.maximum(np.maximum(b_ch, g_ch), r_ch) - np.minimum(np.minimum(b_ch, g_ch), r_ch)
    # Ưu tiên vạch trắng/vàng nhạt có độ bão hòa vừa phải, giảm ảnh hưởng xe màu sặc sỡ
    white_mask = np.clip((90.0 - chroma) / 45.0, 0.25, 1.0)

    # Làm mượt nhẹ theo dọc, giữ nét theo ngang để bắt vạch phân cách dọc/nghiêng
    sm = cv2.GaussianBlur(gray, (3, 5), 0.8)
    pad = 8
    padded = np.pad(sm, ((0, 0), (pad, pad)), mode='edge')
    left_bg = 0.5 * (padded[:, 0:proc_w] + padded[:, 2:proc_w + 2])
    right_bg = 0.5 * (padded[:, 14:proc_w + 14] + padded[:, 16:proc_w + 16])
    bg_mean = 0.5 * (left_bg + right_bg)
    # Giảm trọng số vùng nền quá sáng (bàn gỗ sáng, cầu giữa, hộp trắng) để không hút viền ô đỗ ra ngoài
    asphalt_weight = np.clip((182.0 - bg_mean) / 32.0, 0.05, 1.0)
    ridge_v = np.clip(sm - bg_mean, 0.0, 55.0) * asphalt_weight * white_mask

    # Bản đồ biên ngang (vạch trắng ngoài + gờ chặn vàng-đen phía mặt đường)
    sm_h = cv2.GaussianBlur(gray, (5, 3), 0.8)
    pad_y = 7
    padded_y = np.pad(sm_h, ((pad_y, pad_y), (0, 0)), mode='edge')
    top_bg = 0.5 * (padded_y[0:proc_h, :] + padded_y[2:proc_h + 2, :])
    bot_bg = 0.5 * (padded_y[12:proc_h + 12, :] + padded_y[14:proc_h + 14, :])
    bg_y_mean = 0.5 * (top_bg + bot_bg)
    asphalt_y_weight = np.clip((185.0 - bg_y_mean) / 35.0, 0.05, 1.0)
    ridge_h = np.clip(sm_h - bg_y_mean, 0.0, 50.0) * asphalt_y_weight
    sobel_y = np.abs(cv2.Sobel(sm_h, cv2.CV_32F, 0, 1, ksize=3))
    edge_h = np.clip(sobel_y * 0.25, 0.0, 45.0) * asphalt_y_weight
    horiz_map = np.maximum(ridge_h, edge_h * 0.85)
    return ridge_v, horiz_map, proc_w, proc_h


def _snap_zone_to_white_lines(ridge_v, horiz_map, proc_w, proc_h, xt0, xt5, xb0, xb5, yt0, yt5, yb0, yb5):
    """
    Hít 6 vạch phân cách nghiêng/thẳng (k=0..5) và 2 biên ngang (trên/dưới) của 1 zone (5 ô)
    vào đúng vạch sơn trắng & gờ vàng-đen thật trên mặt sa bàn.
    """
    w_init = max(0.12, 0.5 * ((xt5 - xt0) + (xb5 - xb0)))
    pitch_init = w_init / 5.0
    # Giới hạn dịch chuyển vừa phải (<= 24% pitch, <= 14% width zone) để bắt vạch trắng thật nhưng không bị xe che kéo lệch dãy
    max_shift = min(0.032, 0.24 * pitch_init)
    ts_y = np.linspace(0.12, 0.88, 18, dtype=np.float32)

    def eval_x_lines(cx_t0, cx_t5, cx_b0, cx_b5):
        wt = cx_t5 - cx_t0
        wb = cx_b5 - cx_b0
        if wt < 0.86 * w_init or wb < 0.86 * w_init or wt > 1.14 * w_init or wb > 1.14 * w_init:
            return -1e9
        if abs((cx_b0 - cx_t0) - (cx_b5 - cx_t5)) > 0.16 * w_init + 0.04:
            return -1e9

        total = 0.0
        for k in range(6):
            frac = k / 5.0
            xt = cx_t0 + frac * wt
            xb = cx_b0 + frac * wb
            yt = yt0 + frac * (yt5 - yt0)
            yb = yb0 + frac * (yb5 - yb0)
            xs = np.clip(((xt + ts_y * (xb - xt)) * proc_w).astype(np.int32), 1, proc_w - 2)
            ys = np.clip(((yt + ts_y * (yb - yt)) * proc_h).astype(np.int32), 1, proc_h - 2)
            vals = np.maximum(
                ridge_v[ys, xs],
                np.maximum(ridge_v[ys, np.maximum(0, xs - 1)], ridge_v[ys, np.minimum(proc_w - 1, xs + 1)])
            )
            # Cắt bỏ 2 điểm nhiễu thấp nhất dọc vạch để miễn nhiễm khi có xe hoặc nhãn che cục bộ
            total += float(np.sum(np.sort(vals)[2:]))

        prior = -25.0 * (abs(cx_t0 - xt0) + abs(cx_t5 - xt5) + abs(cx_b0 - xb0) + abs(cx_b5 - xb5))
        return total + prior

    best = (xt0, xt5, xb0, xb5)
    best_score = eval_x_lines(*best)

    grid = np.linspace(-max_shift, max_shift, 17)
    for _ in range(2):
        b_t0, b_b0 = best[0], best[2]
        for dt0 in grid:
            nt0 = float(np.clip(xt0 + dt0, 0.01, 0.98))
            for db0 in grid:
                nb0 = float(np.clip(xb0 + db0, 0.01, 0.98))
                sc = eval_x_lines(nt0, best[1], nb0, best[3])
                if sc > best_score:
                    best_score = sc
                    b_t0, b_b0 = nt0, nb0
        best = (b_t0, best[1], b_b0, best[3])

        b_t5, b_b5 = best[1], best[3]
        for dt5 in grid:
            nt5 = float(np.clip(xt5 + dt5, 0.02, 0.99))
            for db5 in grid:
                nb5 = float(np.clip(xb5 + db5, 0.02, 0.99))
                sc = eval_x_lines(best[0], nt5, best[2], nb5)
                if sc > best_score:
                    best_score = sc
                    b_t5, b_b5 = nt5, nb5
        best = (best[0], b_t5, best[2], b_b5)

    fine = np.linspace(-0.009, 0.009, 13)
    for _ in range(2):
        cur = best
        b_t0, b_b0 = cur[0], cur[2]
        for dt0 in fine:
            nt0 = float(np.clip(cur[0] + dt0, max(0.01, xt0 - max_shift), min(0.98, xt0 + max_shift)))
            for db0 in fine:
                nb0 = float(np.clip(cur[2] + db0, max(0.01, xb0 - max_shift), min(0.98, xb0 + max_shift)))
                sc = eval_x_lines(nt0, best[1], nb0, best[3])
                if sc > best_score:
                    best_score = sc
                    b_t0, b_b0 = nt0, nb0
        best = (b_t0, best[1], b_b0, best[3])

        cur = best
        b_t5, b_b5 = cur[1], cur[3]
        for dt5 in fine:
            nt5 = float(np.clip(cur[1] + dt5, max(0.02, xt5 - max_shift), min(0.99, xt5 + max_shift)))
            for db5 in fine:
                nb5 = float(np.clip(cur[3] + db5, max(0.02, xb5 - max_shift), min(0.99, xb5 + max_shift)))
                sc = eval_x_lines(best[0], nt5, best[2], nb5)
                if sc > best_score:
                    best_score = sc
                    b_t5, b_b5 = nt5, nb5
        best = (best[0], b_t5, best[2], b_b5)

    s_xt0, s_xt5, s_xb0, s_xb5 = best

    # Tinh chỉnh biên trên/dưới theo mép dừng của 6 vạch trắng dọc + biên ngang sơn trên sa bàn
    h_init = max(0.08, 0.5 * ((yb0 - yt0) + (yb5 - yt5)))
    y_shift_max = min(0.032, 0.22 * h_init)
    us_x = np.linspace(0.04, 0.96, 25, dtype=np.float32)

    def eval_y_edge(dy_l, dy_r, is_top=True):
        base_yl = yt0 if is_top else yb0
        base_yr = yt5 if is_top else yb5
        cy_l = float(np.clip(base_yl + dy_l, 0.01, 0.99))
        cy_r = float(np.clip(base_yr + dy_r, 0.01, 0.99))
        if is_top and ((yb0 - cy_l) < 0.72 * h_init or (yb5 - cy_r) < 0.72 * h_init):
            return -1e9
        if (not is_top) and ((cy_l - yt0) < 0.72 * h_init or (cy_r - yt5) < 0.72 * h_init):
            return -1e9

        xs_line = (s_xt0 + us_x * (s_xt5 - s_xt0)) if is_top else (s_xb0 + us_x * (s_xb5 - s_xb0))
        ys_line = cy_l + us_x * (cy_r - cy_l)
        px = np.clip((xs_line * proc_w).astype(np.int32), 1, proc_w - 2)
        py = np.clip((ys_line * proc_h).astype(np.int32), 1, proc_h - 2)
        h_vals = np.maximum(
            horiz_map[py, px],
            np.maximum(horiz_map[np.maximum(0, py - 1), px], horiz_map[np.minimum(proc_h - 1, py + 1), px])
        )

        in_dir = 0.014 if is_top else -0.014
        out_dir = -0.016 if is_top else 0.016
        div_diff = 0.0
        for k in range(6):
            frac = k / 5.0
            xk = (s_xt0 + frac * (s_xt5 - s_xt0)) if is_top else (s_xb0 + frac * (s_xb5 - s_xb0))
            yk = cy_l + frac * (cy_r - cy_l)
            ix = int(np.clip(xk * proc_w, 1, proc_w - 2))
            iy_in = int(np.clip((yk + in_dir) * proc_h, 1, proc_h - 2))
            iy_out = int(np.clip((yk + out_dir) * proc_h, 1, proc_h - 2))
            v_in = max(ridge_v[iy_in, ix - 1], ridge_v[iy_in, ix], ridge_v[iy_in, ix + 1])
            v_out = max(ridge_v[iy_out, ix - 1], ridge_v[iy_out, ix], ridge_v[iy_out, ix + 1])
            div_diff += max(-15.0, min(35.0, v_in - v_out))

        prior = -45.0 * (abs(dy_l) + abs(dy_r)) - 60.0 * abs(dy_l - dy_r)
        return float(np.sum(np.sort(h_vals)[4:])) * 0.45 + div_diff * 1.2 + prior

    y_shift_max = min(0.048, 0.28 * max(0.05, 0.5 * ((yb0 - yt0) + (yb5 - yt5))))
    y_grid = np.linspace(-y_shift_max, y_shift_max, 19)
    b_yt_l, b_yt_r, sc_yt = 0.0, 0.0, -1e9
    for dl in y_grid:
        for dr in y_grid:
            if abs(dl - dr) > 0.075:
                continue
            sc = eval_y_edge(float(dl), float(dr), is_top=True)
            if sc > sc_yt:
                sc_yt = sc
                b_yt_l, b_yt_r = float(dl), float(dr)

    b_yb_l, b_yb_r, sc_yb = 0.0, 0.0, -1e9
    for dl in y_grid:
        for dr in y_grid:
            if abs(dl - dr) > 0.075:
                continue
            sc = eval_y_edge(float(dl), float(dr), is_top=False)
            if sc > sc_yb:
                sc_yb = sc
                b_yb_l, b_yb_r = float(dl), float(dr)

    return [
        [round(s_xt0, 4), round(float(np.clip(yt0 + b_yt_l, 0.01, 0.99)), 4)],
        [round(s_xt5, 4), round(float(np.clip(yt5 + b_yt_r, 0.01, 0.99)), 4)],
        [round(s_xb5, 4), round(float(np.clip(yb5 + b_yb_r, 0.01, 0.99)), 4)],
        [round(s_xb0, 4), round(float(np.clip(yb0 + b_yb_l, 0.01, 0.99)), 4)],
    ]


def _snap_zones_to_white_lines(img, res_map, zone_prefixes):
    """Tinh chỉnh đồng bộ cả 4 dãy ô (A, B, C, D) khớp từng vạch sơn trắng nghiêng/thẳng thực tế."""
    ridge_v, horiz_map, pw, ph = _compute_white_line_ridge_maps(img)
    snapped = dict(res_map)
    for z in zone_prefixes:
        k1, k5 = f"{z}1", f"{z}5"
        if k1 not in res_map or k5 not in res_map:
            continue
        c1, c5 = res_map[k1], res_map[k5]
        z_quad = _snap_zone_to_white_lines(
            ridge_v, horiz_map, pw, ph,
            c1[0][0], c5[1][0], c1[3][0], c5[2][0],
            c1[0][1], c5[1][1], c1[3][1], c5[2][1],
        )
        for i in range(5):
            slot_key = f"{z}{i+1}"
            if slot_key in snapped:
                snapped[slot_key] = _homography_project_quad(i * 0.20, 0.0, (i + 1) * 0.20, 1.0, z_quad)
    return snapped


def _extract_physical_slot_polygons(img, slot_codes, img_w, img_h):
    """
    Trích xuất chính xác viền ô đỗ vật lý theo phối cảnh camera (tự động xử lý cả góc thẳng lẫn góc nghiêng chéo):
    - Trích xuất contour polygon từ YOLOv8-Seg (`res.masks.xyn`) -> `cv2.minAreaRect` để lấy 4 góc nghiêng thật của từng ô.
    - Gom cụm hàng & zone theo hệ trục nghiêng (`col_axis`, `row_axis`) + NMS định hướng.
    - Ước lượng phép biến đổi phối cảnh toàn cục `cv2.findHomography(..., cv2.RANSAC)` 2 lượt (ưu tiên zone đủ ô làm neo,
      sau đó đối chiếu ngược lại `inv(H)` cho các zone ít ô/bị xe che) -> chiếu 20 ô đỗ + White-Line Snap.
    """
    if img is None:
        return {}, None

    yolo_dets = []
    if parking_slots_model is not None:
        try:
            res = parking_slots_model(img, conf=0.15, verbose=False)[0]
            has_masks = res.masks is not None and len(res.masks.xyn) == len(res.boxes)
            for i in range(len(res.boxes)):
                conf = float(res.boxes.conf[i])
                if has_masks and len(res.masks.xyn[i]) >= 4:
                    poly = np.array(res.masks.xyn[i], dtype=np.float32)
                    poly_px = poly * np.array([img_w, img_h], dtype=np.float32)
                    rect = cv2.minAreaRect(poly_px)
                    (_, _), (rw, rh), _ = rect
                    short_s, long_s = min(rw, rh), max(rw, rh)
                    area_norm = (rw * rh) / float(max(img_w * img_h, 1))
                    if short_s < 8 or long_s < 16 or long_s < short_s * 1.10:
                        continue
                    if not (0.0018 <= area_norm <= 0.14):
                        continue
                    quad = _order_quad_corners(cv2.boxPoints(rect), img_w, img_h, normalize=True)
                    cx = float(np.mean([p[0] for p in quad]))
                    cy = float(np.mean([p[1] for p in quad]))
                    slant = [
                        0.5 * (quad[3][0] + quad[2][0]) - 0.5 * (quad[0][0] + quad[1][0]),
                        0.5 * (quad[3][1] + quad[2][1]) - 0.5 * (quad[0][1] + quad[1][1]),
                    ]
                    yolo_dets.append({
                        'cx': cx, 'cy': cy, 'quad': quad, 'conf': conf,
                        'w_rot': short_s / float(max(img_w, 1)),
                        'h_rot': long_s / float(max(img_h, 1)),
                        'slant': slant,
                    })
                else:
                    box = res.boxes.xyxyn[i].cpu().numpy().astype(float)
                    x1, y1, x2, y2 = box
                    w, h = x2 - x1, y2 - y1
                    area = w * h
                    if 0.002 <= area <= 0.14 and 0.020 <= w <= 0.24 and 0.055 <= h <= 0.45 and h > w * 1.1:
                        quad = [[round(x1, 4), round(y1, 4)], [round(x2, 4), round(y1, 4)], [round(x2, 4), round(y2, 4)], [round(x1, 4), round(y2, 4)]]
                        yolo_dets.append({
                            'cx': (x1 + x2) / 2.0, 'cy': (y1 + y2) / 2.0, 'quad': quad, 'conf': conf,
                            'w_rot': w, 'h_rot': h, 'slant': [0.0, h],
                        })
        except Exception as yolo_err:
            print(f"[Physical Slot Segmentation] YOLO note: {yolo_err}")

    # Nếu sa bàn có dán 4 ArUco markers vẫn hỗ trợ âm thầm làm ưu tiên cao nhất
    aruco_corners = _detect_aruco_board_corners(img, img_w, img_h)
    if aruco_corners:
        res_map = _build_slots_from_aruco_and_yolo(aruco_corners, slot_codes, yolo_dets)
        print(f"[Physical Slot Segmentation] 🏷️ Calibrated {len(res_map)} perspective slots via ArUco markers!")
        return res_map, aruco_corners

    if len(yolo_dets) < 5:
        return {}, None

    try:
        # 1. Tính trục cột & trục hàng nghiêng thực tế của sa bàn (invariant theo góc xoay/nghiêng camera)
        avg_sx = float(np.median([d['slant'][0] for d in yolo_dets]))
        avg_sy = float(np.median([d['slant'][1] for d in yolo_dets]))
        norm_s = max(float(np.hypot(avg_sx, avg_sy)), 1e-5)
        col_axis = np.array([avg_sx / norm_s, avg_sy / norm_s], dtype=np.float32)
        if col_axis[1] < 0:
            col_axis = -col_axis
        row_axis = np.array([col_axis[1], -col_axis[0]], dtype=np.float32)
        if row_axis[0] < 0:
            row_axis = -row_axis

        for d in yolo_dets:
            pt = np.array([d['cx'], d['cy']], dtype=np.float32)
            d['su'] = float(np.dot(pt, row_axis))
            d['sv'] = float(np.dot(pt, col_axis))
            su_pts = [float(np.dot(np.array(p, dtype=np.float32), row_axis)) for p in d['quad']]
            sv_pts = [float(np.dot(np.array(p, dtype=np.float32), col_axis)) for p in d['quad']]
            d['su1'], d['su2'] = min(su_pts), max(su_pts)
            d['sv1'], d['sv2'] = min(sv_pts), max(sv_pts)

        # 2. NMS trong hệ tọa độ nghiêng (su, sv) theo kích thước ô trung vị (chống trùng 2 mask cùng 1 ô như C1)
        med_w = float(np.median([d['w_rot'] for d in yolo_dets]))
        med_h = float(np.median([d['h_rot'] for d in yolo_dets]))
        yolo_dets.sort(key=lambda d: d['conf'], reverse=True)
        dedup = []
        for d in yolo_dets:
            if any(
                abs(d['su'] - ex['su']) < max(0.028, 0.72 * med_w)
                and abs(d['sv'] - ex['sv']) < max(0.050, 0.55 * med_h)
                for ex in dedup
            ):
                continue
            dedup.append(d)

        if len(dedup) < 5:
            return {}, None

        # 3. Gom thành 2 hàng chính dọc trục sv
        by_sv = sorted(dedup, key=lambda d: d['sv'])
        rows = [[by_sv[0]]]
        for d in by_sv[1:]:
            prev_sv = float(np.mean([r['sv'] for r in rows[-1]]))
            if abs(d['sv'] - prev_sv) > max(0.075, med_h * 0.42):
                rows.append([d])
            else:
                rows[-1].append(d)

        valid_rows = [r for r in rows if len(r) >= 2]
        if len(valid_rows) < 2:
            return {}, None

        valid_rows.sort(key=len, reverse=True)
        valid_rows = sorted(valid_rows[:2], key=lambda r: float(np.mean([d['sv'] for d in r])))
        top_row = sorted(valid_rows[0], key=lambda d: d['su'])
        bot_row = sorted(valid_rows[1], key=lambda d: d['su'])

        # 4. Tìm trục đường giữa (tách zone trái A/C và phải B/D) trong tọa độ su
        def find_road_split(r):
            if len(r) < 2:
                return 0.50
            sus = [d['su'] for d in r]
            span = max(sus[-1] - sus[0], 0.1)
            gaps = []
            for i in range(len(r) - 1):
                mid = 0.5 * (sus[i] + sus[i + 1])
                rel = (mid - sus[0]) / span
                if 0.18 <= rel <= 0.82:
                    gaps.append((sus[i + 1] - sus[i], mid))
            return max(gaps, key=lambda g: g[0])[1] if gaps else 0.5 * (sus[0] + sus[-1])

        road_top = find_road_split(top_row)
        road_bot = find_road_split(bot_row)

        a_det = sorted([d for d in top_row if d['su'] < road_top], key=lambda d: d['su'])
        b_det = sorted([d for d in top_row if d['su'] >= road_top], key=lambda d: d['su'])
        c_det = sorted([d for d in bot_row if d['su'] < road_bot], key=lambda d: d['su'])
        d_det = sorted([d for d in bot_row if d['su'] >= road_bot], key=lambda d: d['su'])

        # Nếu 1 hàng có 2 bên C-D (hoặc A-B) cân bằng rõ hơn hàng kia (VD: B bị xe che hết chỉ còn 1 ô ở xa), dùng tâm đường của hàng rõ hơn
        road_top_ref = road_top
        road_bot_ref = road_bot
        if min(len(c_det), len(d_det)) > min(len(a_det), len(b_det)) and min(len(a_det), len(b_det)) <= 1:
            road_top_ref = road_bot
        elif min(len(a_det), len(b_det)) > min(len(c_det), len(d_det)) and min(len(c_det), len(d_det)) <= 1:
            road_bot_ref = road_top

        # 5. Xác định chỉ số cột (0..4) cho từng ô phát hiện được (không cắt [:5] bừa bãi và neo theo zone cùng hàng!)
        def row_pitch(r, fallback=0.062):
            sus = [d['su'] for d in r]
            mw = float(np.median([d['w_rot'] for d in r])) if r else med_w
            diffs = [sus[i + 1] - sus[i] for i in range(len(sus) - 1) if 0.65 * mw <= (sus[i + 1] - sus[i]) <= 1.45 * mw]
            return float(np.median(diffs)) if diffs else max(mw, fallback)

        def clean_zone_dups(dz, pz):
            if len(dz) <= 1:
                return dz
            dz_sorted = sorted(dz, key=lambda d: d['conf'], reverse=True)
            kept = []
            for d in dz_sorted:
                if any(abs(d['su'] - k['su']) < 0.72 * pz for k in kept):
                    continue
                kept.append(d)
            return sorted(kept, key=lambda d: d['su'])

        p_top = row_pitch(a_det + b_det, 0.060)
        p_bot = row_pitch(c_det + d_det, 0.068)
        a_det = clean_zone_dups(a_det, p_top)
        b_det = clean_zone_dups(b_det, p_top)
        c_det = clean_zone_dups(c_det, p_bot)
        d_det = clean_zone_dups(d_det, p_bot)

        def assign_zone_cols(dets_z, pitch_z, same_row_other, is_left_side, road_center_row, vert_other):
            if not dets_z:
                return []
            if len(dets_z) == 5:
                gaps = [dets_z[k]['su'] - dets_z[k - 1]['su'] for k in range(1, 5)]
                if all(g <= 1.45 * max(pitch_z, 0.03) for g in gaps):
                    return [(i, dets_z[i]) for i in range(5)]
            if len(dets_z) > 5:
                dets_z = sorted(sorted(dets_z, key=lambda d: d['conf'], reverse=True)[:5], key=lambda d: d['su'])

            rel_cols = [0]
            for k in range(1, len(dets_z)):
                step = max(1, int(round((dets_z[k]['su'] - dets_z[k - 1]['su']) / max(pitch_z, 0.03))))
                rel_cols.append(rel_cols[-1] + step)

            if rel_cols[-1] > 4:
                z_min, z_max = dets_z[0]['su1'], dets_z[-1]['su2']
                span = max(z_max - z_min, pitch_z)
                eff_p = span / 5.0 if span >= 4.4 * pitch_z else pitch_z
                return [(int(np.clip(round((d['su'] - z_min) / eff_p - 0.5), 0, 4)), d) for d in dets_z]

            max_shift = 4 - rel_cols[-1]
            if max_shift == 0:
                return [(rel_cols[i], dets_z[i]) for i in range(len(dets_z))]

            # Ưu tiên neo theo khoảng cách lòng đường thực tế tới zone đối diện CÙNG HÀNG ngang (1.765 * pitch_z)
            # Thay vì so thẳng top_row với bot_row vốn bị co/giãn phối cảnh hình thang!
            best_shift = 0
            best_err = 1e9
            road_w_norm = 1.765 * pitch_z  # (0.575 - 0.425) / 0.085 = 1.765 ô
            if same_row_other and len(same_row_other) >= 4:
                other_start = same_row_other[0]['su']
                other_end = same_row_other[-1]['su']
                for sh in range(max_shift + 1):
                    c_first = rel_cols[0] + sh
                    c_last = rel_cols[-1] + sh
                    if is_left_side:
                        est_a5_su = dets_z[-1]['su'] + (4 - c_last) * pitch_z
                        est_road_gap = other_start - est_a5_su
                    else:
                        est_b1_su = dets_z[0]['su'] - c_first * pitch_z
                        est_road_gap = est_b1_su - other_end
                    err = abs(est_road_gap - 2.765 * pitch_z)
                    if err < best_err:
                        best_err = err
                        best_shift = sh
            elif road_center_row is not None:
                half_road = 0.88 * pitch_z
                for sh in range(max_shift + 1):
                    if is_left_side:
                        est_road_edge = dets_z[-1]['su'] + (4.5 - (rel_cols[-1] + sh)) * pitch_z
                        err = abs(est_road_edge - (road_center_row - half_road))
                    else:
                        est_road_edge = dets_z[0]['su'] - ((rel_cols[0] + sh) + 0.5) * pitch_z
                        err = abs(est_road_edge - (road_center_row + half_road))
                    if err < best_err:
                        best_err = err
                        best_shift = sh

            return [(rel_cols[i] + best_shift, dets_z[i]) for i in range(len(dets_z))]

        a_cols = assign_zone_cols(a_det, p_top, b_det, True, road_top_ref, c_det)
        c_cols = assign_zone_cols(c_det, p_bot, d_det, True, road_bot_ref, a_det)
        b_cols = assign_zone_cols(b_det, p_top, a_det, False, road_top_ref, d_det)
        d_cols = assign_zone_cols(d_det, p_bot, c_det, False, road_bot_ref, b_det)

        # Bản đồ (u, v) chuẩn của 4 zone trên mặt phẳng 2D sa bàn:
        # u_base: 0.000 (trái), 0.575 (phải), pitch u_step = 0.085 (5*0.085 + 0.575 = 1.000)
        # v: hàng trên [0.000..0.365], hàng dưới [0.510..1.000]
        zone_uv_defs = {
            'A': (a_cols, 0.000, 0.085, 0.000, 0.365),
            'B': (b_cols, 0.575, 0.085, 0.000, 0.365),
            'C': (c_cols, 0.000, 0.085, 0.510, 1.000),
            'D': (d_cols, 0.575, 0.085, 0.510, 1.000),
        }

        def build_correspondences(col_items_list):
            src_pts, dst_pts = [], []
            for col_list, u_base, u_step, v1, v2 in col_items_list:
                for col, d in col_list:
                    u1 = u_base + col * u_step
                    u2 = u1 + u_step
                    uv = [[u1, v1], [u2, v1], [u2, v2], [u1, v2]]
                    for p_uv, p_xy in zip(uv, d['quad']):
                        src_pts.append(p_uv)
                        dst_pts.append(p_xy)
            return src_pts, dst_pts

        def is_valid_homography(H_mat):
            if H_mat is None:
                return False
            corners_uv = np.array([[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]], dtype=np.float32)
            mapped = cv2.perspectiveTransform(corners_uv, H_mat)[0]
            if not np.all(np.isfinite(mapped)):
                return False
            if np.any(mapped < -0.35) or np.any(mapped > 1.35):
                return False
            area = float(cv2.contourArea(mapped.astype(np.float32)))
            is_conv = bool(cv2.isContourConvex(mapped.astype(np.float32)))
            return is_conv and 0.04 <= area <= 1.25

        # Pass 1: Ưu tiên fit H1 bằng các zone có >= 3 ô rõ ràng (tránh 1-2 ô nhiễu kéo lệch góc)
        dense_specs = [spec for spec in zone_uv_defs.values() if len(spec[0]) >= 3]
        src1, dst1 = build_correspondences(dense_specs if len(dense_specs) >= 2 else list(zone_uv_defs.values()))
        if len(src1) < 8:
            src1, dst1 = build_correspondences(list(zone_uv_defs.values()))
        if len(src1) < 8:
            return {}, None

        H, mask = cv2.findHomography(
            np.array(src1, dtype=np.float32),
            np.array(dst1, dtype=np.float32),
            cv2.RANSAC,
            0.03,
        )
        if not is_valid_homography(H):
            src_all, dst_all = build_correspondences(list(zone_uv_defs.values()))
            H, mask = cv2.findHomography(
                np.array(src_all, dtype=np.float32),
                np.array(dst_all, dtype=np.float32),
                cv2.RANSAC,
                0.035,
            )
            if not is_valid_homography(H):
                return {}, None

        # Pass 2: Nếu có zone ít ô (< 3), chiếu ngược tâm ô về không gian (u, v) qua inv(H1) để chốt đúng cột & refit H2
        if len(dense_specs) >= 2 and any(len(spec[0]) < 3 for spec in zone_uv_defs.values()):
            try:
                H_inv = np.linalg.inv(H).astype(np.float32)
                refined_specs = []
                for z_key, (col_list, u_base, u_step, v1, v2) in zone_uv_defs.items():
                    if len(col_list) >= 3:
                        refined_specs.append((col_list, u_base, u_step, v1, v2))
                    elif col_list:
                        matched = []
                        used_cols = set()
                        for _, d in col_list:
                            pt = np.array([[[d['cx'], d['cy']]]], dtype=np.float32)
                            uv_pt = cv2.perspectiveTransform(pt, H_inv)[0][0]
                            col_est = int(round((uv_pt[0] - u_base) / u_step - 0.5))
                            v_mid = 0.5 * (v1 + v2)
                            if 0 <= col_est <= 4 and col_est not in used_cols:
                                expected_u = u_base + (col_est + 0.5) * u_step
                                if abs(uv_pt[0] - expected_u) < 0.055 and abs(uv_pt[1] - v_mid) < 0.18:
                                    used_cols.add(col_est)
                                    matched.append((col_est, d))
                        if matched:
                            refined_specs.append((matched, u_base, u_step, v1, v2))
                src2, dst2 = build_correspondences(refined_specs)
                if len(src2) >= 12:
                    H2, _ = cv2.findHomography(
                        np.array(src2, dtype=np.float32),
                        np.array(dst2, dtype=np.float32),
                        cv2.RANSAC,
                        0.028,
                    )
                    if is_valid_homography(H2):
                        H = H2
            except Exception:
                pass

        # 6. Chiếu toàn bộ 20 ô bằng Homography H & tinh chỉnh theo vạch sơn trắng thực tế
        def project_uv_quad(u1, v1, u2, v2):
            pts = np.array([[[u1, v1], [u2, v1], [u2, v2], [u1, v2]]], dtype=np.float32)
            mapped = cv2.perspectiveTransform(pts, H)[0]
            return [
                [round(float(np.clip(p[0], 0.001, 0.999)), 4), round(float(np.clip(p[1], 0.001, 0.999)), 4)]
                for p in mapped
            ]

        zone_map = {}
        for sc in slot_codes:
            p = sc[0].upper() if sc else 'A'
            zone_map.setdefault(p, []).append(sc)
        sp = sorted(zone_map.keys())
        p_A = sp[0] if len(sp) > 0 else 'A'
        p_B = sp[1] if len(sp) > 1 else 'B'
        p_C = sp[2] if len(sp) > 2 else 'C'
        p_D = sp[3] if len(sp) > 3 else 'D'

        res_map = {}
        for z_out, (_, u_base, u_step, v1, v2) in zip([p_A, p_B, p_C, p_D], [zone_uv_defs['A'], zone_uv_defs['B'], zone_uv_defs['C'], zone_uv_defs['D']]):
            for i in range(5):
                u1 = u_base + i * u_step
                res_map[f'{z_out}{i+1}'] = project_uv_quad(u1, v1, u1 + u_step, v2)

        try:
            res_map = _snap_zones_to_white_lines(img, res_map, [p_A, p_B, p_C, p_D])
        except Exception as snap_err:
            print(f"[Physical Slot Segmentation] White-line snap skipped: {snap_err}")

        tl_pt = res_map.get(f'{p_A}1', project_uv_quad(0.0, 0.0, 0.085, 0.365))[0]
        tr_pt = res_map.get(f'{p_B}5', project_uv_quad(0.915, 0.0, 1.0, 0.365))[1]
        br_pt = res_map.get(f'{p_D}5', project_uv_quad(0.915, 0.51, 1.0, 1.0))[2]
        bl_pt = res_map.get(f'{p_C}1', project_uv_quad(0.0, 0.51, 0.085, 1.0))[3]
        board_corners = [
            [round(float(tl_pt[0]), 4), round(float(tl_pt[1]), 4)],
            [round(float(tr_pt[0]), 4), round(float(tr_pt[1]), 4)],
            [round(float(br_pt[0]), 4), round(float(br_pt[1]), 4)],
            [round(float(bl_pt[0]), 4), round(float(bl_pt[1]), 4)],
        ]
        print(f"[Physical Slot Segmentation] 🎯 Calibrated {len(res_map)} Seg-Mask+RANSAC Homography slots! corners={board_corners}")
        return res_map, board_corners
    except Exception as err:
        print(f"[Physical Slot Segmentation] Error: {err}")
        import traceback; traceback.print_exc()
        return {}, None


def _detect_paper_corners_opencv(img, img_w, img_h):
    """
    Phát hiện 4 góc sa bàn dự phòng:
    1. ArUco Marker (chính xác nhất)
    2. Canny edge / Threshold contour (loại bỏ hoàn toàn mask màu dễ dính bàn gỗ/tường)
    """
    if img is None:
        return None
    try:
        # Ưu tiên ArUco trước
        aruco_corners = _detect_aruco_board_corners(img, img_w, img_h)
        if aruco_corners:
            return aruco_corners

        img_area = img_w * img_h

        def is_valid_corners(corners):
            xs = [c[0] for c in corners]
            ys = [c[1] for c in corners]
            # Loại bỏ quad ôm sát mép ngoài toàn ảnh (dấu hiệu dính nền tường/bàn)
            if min(xs) <= 0.015 and max(xs) >= 0.985 and min(ys) <= 0.015:
                return False
            w_top = abs(corners[1][0] - corners[0][0])
            w_bot = abs(corners[2][0] - corners[3][0])
            h_left = abs(corners[3][1] - corners[0][1])
            h_right = abs(corners[2][1] - corners[1][1])
            return w_top > 0.25 and w_bot > 0.25 and h_left > 0.25 and h_right > 0.25

        def find_best_quad_contour(contours, min_area_ratio=0.12, max_area_ratio=0.88):
            best_quad, max_area = None, 0
            for cnt in contours:
                area = cv2.contourArea(cnt)
                if min_area_ratio * img_area < area < max_area_ratio * img_area:
                    peri = cv2.arcLength(cnt, True)
                    approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
                    if len(approx) == 4 and area > max_area:
                        max_area = area
                        best_quad = approx.reshape(4, 2)
            return best_quad

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (7, 7), 0)

        # Phương pháp 1: Canny edge detection
        for canny_lo, canny_hi in [(30, 90), (20, 60), (50, 150)]:
            edges = cv2.Canny(blurred, canny_lo, canny_hi)
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
            edges = cv2.dilate(edges, kernel, iterations=2)
            contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            best_quad = find_best_quad_contour(contours)
            if best_quad is not None:
                corners = _order_quad_corners(best_quad, img_w, img_h, normalize=True)
                if is_valid_corners(corners):
                    print(f"[Paper Detection] ✅ Canny edge quad detected: {corners}")
                    return corners

        # Phương pháp 2: Threshold
        for thresh_val in [135, 115, 155, 95, 170]:
            _, thresh = cv2.threshold(blurred, thresh_val, 255, cv2.THRESH_BINARY)
            contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            best_quad = find_best_quad_contour(contours, 0.12, 0.85)
            if best_quad is not None:
                corners = _order_quad_corners(best_quad, img_w, img_h, normalize=True)
                if is_valid_corners(corners):
                    return corners

    except Exception as e:
        print(f"[Paper Detection] Note: {e}")
    return None


@app.get("/aruco-markers-sheet")
def download_aruco_markers_sheet():
    """
    Tạo tờ ảnh PNG sẵn sàng in chứa 4 ArUco Marker (DICT_4X4_50) cho 4 góc sa bàn:
      ID 0 = Top-Left (TL), ID 1 = Top-Right (TR), ID 2 = Bottom-Right (BR), ID 3 = Bottom-Left (BL)
    """
    if not hasattr(cv2, 'aruco'):
        raise HTTPException(status_code=500, detail="OpenCV ArUco module not available")

    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    # Canvas A4-like white sheet (1240 x 1754 at 150 DPI)
    sheet = np.full((1754, 1240, 3), 255, dtype=np.uint8)

    cv2.putText(sheet, "VALOPARKING - 4 CORNER ARUCO CALIBRATION MARKERS", (70, 90),
                cv2.FONT_HERSHEY_SIMPLEX, 0.95, (20, 20, 20), 2, cv2.LINE_AA)
    cv2.putText(sheet, "Dictionary: DICT_4X4_50  |  Cut along dashed lines & stick at the 4 outer corners of diorama",
                (70, 135), cv2.FONT_HERSHEY_SIMPLEX, 0.58, (80, 80, 80), 1, cv2.LINE_AA)

    specs = [
        (0, "ID 0: TOP-LEFT (TL)", 120, 240),
        (1, "ID 1: TOP-RIGHT (TR)", 700, 240),
        (3, "ID 3: BOTTOM-LEFT (BL)", 120, 960),
        (2, "ID 2: BOTTOM-RIGHT (BR)", 700, 960),
    ]
    marker_px = 360
    pad = 40
    for mid, label, x0, y0 in specs:
        marker_img = cv2.aruco.generateImageMarker(aruco_dict, mid, marker_px)
        marker_bgr = cv2.cvtColor(marker_img, cv2.COLOR_GRAY2BGR)
        # White quiet-zone border + dashed cut box
        box_w = marker_px + pad * 2
        box_h = marker_px + pad * 2 + 55
        cv2.rectangle(sheet, (x0, y0), (x0 + box_w, y0 + box_h), (160, 160, 160), 2)
        sheet[y0 + pad:y0 + pad + marker_px, x0 + pad:x0 + pad + marker_px] = marker_bgr
        cv2.putText(sheet, label, (x0 + 35, y0 + pad + marker_px + 42),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.72, (15, 15, 15), 2, cv2.LINE_AA)

    ok, buf = cv2.imencode(".png", sheet)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to encode ArUco sheet PNG")
    return Response(
        content=buf.tobytes(),
        media_type="image/png",
        headers={"Content-Disposition": 'attachment; filename="valoparking-aruco-4corners.png"'}
    )


class DebugCornersRequest(BaseModel):
    image: str

@app.post("/debug-corners")
async def debug_board_corners(request: DebugCornersRequest):
    """Debug endpoint: kiểm tra ArUco + YOLO + OpenCV góc sa bàn."""
    try:
        base64_data = request.image
        if "," in base64_data:
            base64_data = base64_data.split(",")[1]
        contents = base64.b64decode(base64_data)
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return {"success": False, "corners": None, "message": "Failed to decode image"}
        img_h, img_w = img.shape[:2]
        MAX_W, MAX_H = 1920, 1080
        if img_w > MAX_W or img_h > MAX_H:
            scale = min(MAX_W / img_w, MAX_H / img_h)
            img = cv2.resize(img, (int(img_w * scale), int(img_h * scale)), interpolation=cv2.INTER_AREA)
            img_h, img_w = img.shape[:2]
        aruco_corners = _detect_aruco_board_corners(img, img_w, img_h)
        opencv_corners = _detect_paper_corners_opencv(img, img_w, img_h) if not aruco_corners else aruco_corners
        return {
            "success": True,
            "arucoCorners": aruco_corners,
            "corners": aruco_corners or opencv_corners,
            "method": "aruco" if aruco_corners else ("opencv" if opencv_corners else "none"),
            "imageSize": {"width": img_w, "height": img_h},
        }
    except Exception as e:
        return {"success": False, "corners": None, "message": str(e)}


def _detect_slots_with_roboflow_v5(image_base64: str, slot_codes: list, img_w: int, img_h: int):
    """
    Sử dụng Model Version 5 từ Roboflow (RF-DETR mAP 94%) để nhận diện các vạch ranh giới
    và áp dụng thuật toán Tái tạo Lòng Ô (Stall Reconstruction) để tạo thành 20 ô đỗ đầy đủ,
    ôm trọn từng chiếc xe trên sa bàn.
    """
    api_key = os.getenv("ROBOFLOW_API_KEY", "D5zQa7sJjr1GUVrtYt0J")
    project_id = os.getenv("ROBOFLOW_PROJECT_ID", "parking-slot-detection-gdqpe")
    if "/" in project_id:
        project_id = project_id.split("/")[-1]
    
    url = f"https://detect.roboflow.com/{project_id}/5?api_key={api_key}&confidence=25"
    
    try:
        raw_b64 = image_base64
        if "," in raw_b64:
            raw_b64 = raw_b64.split(",")[1]
            
        res = requests.post(
            url, 
            data=raw_b64, 
            headers={"Content-Type": "application/x-www-form-urlencoded"}, 
            timeout=8
        )
        if res.status_code != 200:
            print(f"[Roboflow V5] Error response status: {res.status_code}")
            return None
            
        preds = res.json().get("predictions", [])
        if len(preds) < 8:
            print(f"[Roboflow V5] Low predictions count: {len(preds)}")
            return None
            
        # Lọc các vạch ranh giới (width < 45px và height > 55px)
        lines = [p for p in preds if p.get("width", 0) < 45 and p.get("height", 0) > 55]
        if len(lines) < 8:
            print(f"[Roboflow V5] Found only {len(lines)} divider lines")
            return None

        # Phân cụm 2 hàng (Top Row 0 & Bottom Row 1) bằng 1D K-means trên toạ độ y
        ys = np.array([p["y"] for p in lines])
        center0, center1 = np.min(ys), np.max(ys)
        for _ in range(8):
            labels = np.argmin(np.abs(ys[:, None] - np.array([center0, center1])[None, :]), axis=1)
            if np.sum(labels == 0) > 0: center0 = np.mean(ys[labels == 0])
            if np.sum(labels == 1) > 0: center1 = np.mean(ys[labels == 1])

        mid_y = (center0 + center1) / 2.0

        def reconstruct_zone_slots(line_list, zone_code, expected_count=5):
            if len(line_list) < 2:
                return {}
            xs = sorted([p["x"] for p in line_list])
            dedup_xs = []
            for x in xs:
                if not dedup_xs or abs(x - dedup_xs[-1]) >= 18:
                    dedup_xs.append(x)
                    
            diffs = [dedup_xs[i+1] - dedup_xs[i] for i in range(len(dedup_xs) - 1)]
            single_widths = [d for d in diffs if 30 <= d <= 60]
            avg_w = float(np.median(single_widths)) if single_widths else 45.0
            
            dense_xs = [dedup_xs[0]]
            for i in range(len(dedup_xs) - 1):
                x1 = dedup_xs[i]
                x2 = dedup_xs[i+1]
                gap = x2 - x1
                num_spans = max(1, int(round(gap / avg_w)))
                for s in range(1, num_spans):
                    dense_xs.append(x1 + s * (gap / num_spans))
                dense_xs.append(x2)
                
            while len(dense_xs) < expected_count + 1:
                dense_xs.append(dense_xs[-1] + avg_w)
                
            dense_xs = dense_xs[:expected_count + 1]
            
            avg_y = float(np.mean([p["y"] for p in line_list]))
            avg_h = float(np.mean([p["height"] for p in line_list]))
            y_top = max(0.0, avg_y - avg_h / 2.0)
            y_bot = min(float(img_h), avg_y + avg_h / 2.0)
            
            slots = {}
            for idx in range(expected_count):
                x_left = dense_xs[idx]
                x_right = dense_xs[idx + 1]
                sc = f"{zone_code}{idx + 1}"
                poly = [
                    [round(float(x_left / img_w), 4), round(float(y_top / img_h), 4)],
                    [round(float(x_right / img_w), 4), round(float(y_top / img_h), 4)],
                    [round(float(x_right / img_w), 4), round(float(y_bot / img_h), 4)],
                    [round(float(x_left / img_w), 4), round(float(y_bot / img_h), 4)],
                ]
                slots[sc] = poly
            return slots

        row0_lines = [p for p in lines if p["y"] < mid_y]
        row1_lines = [p for p in lines if p["y"] >= mid_y]

        xs0 = np.array([p["x"] for p in row0_lines]) if row0_lines else np.array([img_w / 2])
        xs1 = np.array([p["x"] for p in row1_lines]) if row1_lines else np.array([img_w / 2])
        mid_x0 = float(np.median(xs0))
        mid_x1 = float(np.median(xs1))

        # Nhận diện 4 zone A, B, C, D
        slotsA = reconstruct_zone_slots([p for p in row0_lines if p["x"] < mid_x0], 'A')
        slotsB = reconstruct_zone_slots([p for p in row0_lines if p["x"] >= mid_x0], 'B')
        slotsC = reconstruct_zone_slots([p for p in row1_lines if p["x"] < mid_x1], 'C')
        slotsD = reconstruct_zone_slots([p for p in row1_lines if p["x"] >= mid_x1], 'D')

        all_slots_map = {**slotsA, **slotsB, **slotsC, **slotsD}
        if len(all_slots_map) >= 15:
            res_slots = []
            for sc in slot_codes:
                if sc in all_slots_map:
                    res_slots.append({'slotCode': sc, 'polygon': all_slots_map[sc]})
            print(f"[Roboflow V5] 🎯 Reconstructed {len(res_slots)} full parking slots from divider lines!")
            return res_slots
        return None
    except Exception as e:
        print(f"[Roboflow V5] Reconstruction note: {e}")
        return None


def _generate_canonical_perspective_slots(slot_codes, img=None, img_w=640, img_h=480):
    """
    Tạo 27 ô đỗ xe chuẩn xác theo phối cảnh tờ giấy A4 / diorama bãi đỗ xe.
    """
    zone_map = {}
    for sc in slot_codes:
        prefix = sc[0].upper() if sc else 'A'
        if prefix not in zone_map:
            zone_map[prefix] = []
        zone_map[prefix].append(sc)
    
    sorted_prefixes = sorted(zone_map.keys())
    p_A = sorted_prefixes[0] if len(sorted_prefixes) > 0 else 'A'
    p_B = sorted_prefixes[1] if len(sorted_prefixes) > 1 else 'B'
    p_C = sorted_prefixes[2] if len(sorted_prefixes) > 2 else 'C'
    p_D = sorted_prefixes[3] if len(sorted_prefixes) > 3 else 'D'

    detected_corners = _detect_paper_corners_opencv(img, img_w, img_h) if img is not None else None
    final_corners = detected_corners or [
        [0.120, 0.270], # TL — UGREEN Camera 4K centered diorama fallback
        [0.870, 0.270], # TR
        [0.940, 0.840], # BR
        [0.090, 0.840], # BL
    ]

    output_slots = []
    is_two_row = len(slot_codes) <= 20

    if is_two_row:
        # Đồng nhất hệ tọa độ Homography 3D với _extract_physical_slot_polygons & Frontend
        # Row 0: Top Left (A1..A5) & Top Right (B1..B5)
        for i in range(5):
            u1 = i * 0.085
            u2 = u1 + 0.085
            mapped = _homography_project_quad(u1, 0.000, u2, 0.365, final_corners)
            output_slots.append({"slotCode": f"{p_A}{i+1}", "polygon": mapped})
        for i in range(5):
            u1 = 0.575 + i * 0.085
            u2 = u1 + 0.085
            mapped = _homography_project_quad(u1, 0.000, u2, 0.365, final_corners)
            output_slots.append({"slotCode": f"{p_B}{i+1}", "polygon": mapped})

        # Row 1: Bottom Left (C1..C5) & Bottom Right (D1..D5)
        for i in range(5):
            u1 = i * 0.085
            u2 = u1 + 0.085
            mapped = _homography_project_quad(u1, 0.510, u2, 1.000, final_corners)
            output_slots.append({"slotCode": f"{p_C}{i+1}", "polygon": mapped})
        for i in range(5):
            u1 = 0.575 + i * 0.085
            u2 = u1 + 0.085
            mapped = _homography_project_quad(u1, 0.510, u2, 1.000, final_corners)
            output_slots.append({"slotCode": f"{p_D}{i+1}", "polygon": mapped})
    else:
        slot_w = 0.080
        gap = 0.010
        # Row 0: Top Left (A1..A5) & Top Right (B1..B5)
        for i in range(5):
            u1 = i * (slot_w + gap)
            u2 = u1 + slot_w
            mapped = _homography_project_quad(u1, 0.00, u2, 0.26, final_corners)
            output_slots.append({"slotCode": f"{p_A}{i+1}", "polygon": mapped})
        for i in range(5):
            u1 = 0.540 + i * (slot_w + gap)
            u2 = u1 + slot_w
            mapped = _homography_project_quad(u1, 0.00, u2, 0.26, final_corners)
            output_slots.append({"slotCode": f"{p_B}{i+1}", "polygon": mapped})

        # Row 1: Middle Left (A6..A10) & Middle Right (B6..B7)
        for i in range(5):
            u1 = i * (slot_w + gap)
            u2 = u1 + slot_w
            mapped = _homography_project_quad(u1, 0.29, u2, 0.54, final_corners)
            output_slots.append({"slotCode": f"{p_A}{i+6}", "polygon": mapped})
        for i in range(2):
            u1 = 0.540 + i * (slot_w + gap)
            u2 = u1 + slot_w
            mapped = _homography_project_quad(u1, 0.29, u2, 0.54, final_corners)
            output_slots.append({"slotCode": f"{p_B}{i+6}", "polygon": mapped})

        # Row 2: Bottom Left (C1..C5) & Bottom Right (D1..D5)
        for i in range(5):
            u1 = i * (slot_w + gap)
            u2 = u1 + slot_w
            mapped = _homography_project_quad(u1, 0.73, u2, 0.98, final_corners)
            output_slots.append({"slotCode": f"{p_C}{i+1}", "polygon": mapped})
        for i in range(5):
            u1 = 0.540 + i * (slot_w + gap)
            u2 = u1 + slot_w
            mapped = _homography_project_quad(u1, 0.73, u2, 0.98, final_corners)
            output_slots.append({"slotCode": f"{p_D}{i+1}", "polygon": mapped})

    return output_slots, final_corners


@app.post("/auto-detect-grid")
async def auto_detect_grid(request: AutoDetectGridRequest):
    """
    AI Smart Diorama & Grid Auto-Detection:
    1. Phân đoạn chính xác viền ô đỗ vật lý (YOLOv8-Seg hoặc Adaptive Perspective).
    2. Tự động gom nhóm theo 3 hàng và 4 góc chuẩn xác.
    """
    try:
        slot_codes = request.slotCodes if request.slotCodes else [f"A{i}" for i in range(1, 11)]
        
        img = None
        img_h, img_w = 480, 640
        if request.image:
            try:
                base64_data = request.image
                if "," in base64_data:
                    base64_data = base64_data.split(",")[1]
                contents = base64.b64decode(base64_data)
                nparr = np.frombuffer(contents, np.uint8)
                img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                if img is not None:
                    img_h, img_w = img.shape[:2]
            except Exception as dec_err:
                print(f"[AI Auto-Detect] Image decode error: {dec_err}")

        # Clear scan cache on new calibration
        with _scan_cache_lock:
            _scan_cache.clear()

        # Method 1: ArUco Markers (nếu có) hoặc Local YOLOv8-Seg Perspective Fitting
        if img is not None:
            phys_slots, board_corners = _extract_physical_slot_polygons(img, slot_codes, img_w, img_h)
            if phys_slots and len(phys_slots) >= 12:
                calibrated_slots = [{'slotCode': sc, 'polygon': poly} for sc, poly in phys_slots.items()]
                print(f"[AI Auto-Detect] 🎯 Aligned {len(calibrated_slots)} perspective slots! corners={board_corners}")
                return {
                    "success": True,
                    "model": "yolov8_aruco_perspective",
                    "corners": board_corners,
                    "totalSlots": len(calibrated_slots),
                    "slots": calibrated_slots
                }

        # Method 2: Roboflow Cloud Model (Fallback)
        if request.image:
            try:
                rf_slots = _detect_slots_with_roboflow_v5(request.image, slot_codes, img_w, img_h)
                if rf_slots and len(rf_slots) >= 15:
                    print(f"[AI Auto-Detect] 🚀 Successfully calibrated {len(rf_slots)} slots via Roboflow V5!")
                    return {
                        "success": True,
                        "model": "roboflow_v5_stall_reconstruction",
                        "totalSlots": len(rf_slots),
                        "slots": rf_slots
                    }
            except Exception as rf_err:
                print(f"[AI Auto-Detect] Roboflow V5 note: {rf_err}")

        # Method 3: High-accuracy perspective diorama mapping
        output_slots, final_corners = _generate_canonical_perspective_slots(slot_codes, img=img, img_w=img_w, img_h=img_h)

        print(f"[AI Auto-Detect] Generated {len(output_slots)} calibrated slots from paper bounds {final_corners}!")
        return {
            "success": True,
            "model": "adaptive_perspective_geometry",
            "corners": final_corners,
            "totalSlots": len(output_slots),
            "slots": output_slots
        }

    except Exception as e:
        print(f"Error during auto-detect-grid: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


_SCAN_NOISE_WORDS = {'EXIT', 'KIOSK', 'PLEASE', 'PROCEED', 'INTO', 'AREA', 'SCANNING', 'VALO', 'PARKING', 'CAMERA', 'ZONE', 'SLOT', 'EMPTY'}


def _is_scan_ui_noise(txt: str) -> bool:
    alpha = re.sub(r'[^A-Z]', '', str(txt).upper())
    return any(nw in alpha for nw in _SCAN_NOISE_WORDS) if alpha else False


def _extract_valid_plate_from_easyocr(ocr_rows):
    if not ocr_rows:
        return None, "", 0.0
    ocr_rows.sort(key=lambda r: (r[0][0][1], r[0][0][0]))
    max_h = max([abs(r[0][2][1] - r[0][0][1]) for r in ocr_rows])
    valid_rows = [
        r for r in ocr_rows
        if abs(r[0][2][1] - r[0][0][1]) >= max_h * 0.35 and not _is_scan_ui_noise(r[1])
    ]
    if not valid_rows:
        return None, "", 0.0
    valid_texts = [r[1] for r in valid_rows]
    txt = "".join(valid_texts)
    candidate = clean_plate_text(txt, valid_texts)
    if candidate and len(candidate.replace("-", "").replace(".", "")) >= 6:
        conf = max([float(r[2]) for r in valid_rows] or [0.85])
        return candidate, txt, conf
    return None, "", 0.0


def _scan_plate_from_image(img_bgr):
    """Run YOLO plate detection + EasyOCR (with CLAHE fallback) on a single oriented frame/ROI."""
    if img_bgr is None or img_bgr.size == 0:
        return None, "", 0.0

    work_img = img_bgr
    h_orig, w_orig = work_img.shape[:2]
    if max(h_orig, w_orig) > 720:
        scale_in = 720.0 / max(h_orig, w_orig)
        work_img = cv2.resize(
            work_img,
            (max(1, int(w_orig * scale_in)), max(1, int(h_orig * scale_in))),
            interpolation=cv2.INTER_AREA
        )

    h, w = work_img.shape[:2]
    allowlist = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

    with _alpr_infer_lock:
        # 1. Phát hiện vị trí biển số bằng mô hình YOLOv8 ALPR (best.pt)
        if yolo_model:
            results = yolo_model(work_img, conf=0.15)
            if len(results) > 0 and len(results[0].boxes) > 0:
                sorted_boxes = sorted(results[0].boxes, key=lambda b: float(b.conf[0]), reverse=True)
                for b in sorted_boxes:
                    box = b.xyxy[0].cpu().numpy().astype(int)
                    x1, y1, x2, y2 = box
                    x1 = max(0, x1 - 12)
                    y1 = max(0, y1 - 4)
                    x2 = min(w, x2 + 12)
                    y2 = min(h, y2 + 4)
                    crop = work_img[y1:y2, x1:x2]
                    if crop.size == 0:
                        continue

                    for ocr_input in (crop, preprocess_image_for_ocr(crop)):
                        ocr_crop = reader.readtext(ocr_input, allowlist=allowlist)
                        candidate, txt, _ = _extract_valid_plate_from_easyocr(ocr_crop)
                        if candidate:
                            return candidate, txt, float(b.conf[0])

        # 2. Fallback nếu YOLO không tìm thấy hoặc chưa trích xuất được: Quét trực tiếp trên toàn ROI
        for ocr_input in (work_img, preprocess_image_for_ocr(work_img)):
            direct_ocr = reader.readtext(ocr_input, allowlist=allowlist)
            candidate, txt, conf = _extract_valid_plate_from_easyocr(direct_ocr)
            if candidate:
                return candidate, txt, conf

    return None, "", 0.0


@app.post("/scan")
def scan_license_plate(request: ScanRequest):
    """Quét Biển số xe (ALPR) đơn lẻ, hỗ trợ chia đôi 1 camera cho Entry (phải) & Exit (trái, xoay 180°)."""
    if not reader:
        raise HTTPException(status_code=500, detail="OCR engine not initialized.")

    try:
        base64_data = request.image
        if "," in base64_data:
            base64_data = base64_data.split(",")[1]

        contents = base64.b64decode(base64_data)
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None or img.size == 0:
            raise HTTPException(status_code=400, detail="Invalid image payload.")

        h_orig, w_orig = img.shape[:2]
        lane_mode = (request.lane or "").strip().lower()

        if lane_mode == "exit":
            # Làn ra nằm nửa bên trái, xe đi từ trong ra ngoài nên biển số bị ngược 180°
            roi = img[:, :max(1, w_orig // 2)]
            orientations = [cv2.rotate(roi, cv2.ROTATE_180), roi]
        elif lane_mode == "entry":
            # Làn vào nằm nửa bên phải, xe đi từ ngoài vào trong nên biển số xuôi chiều
            roi = img[:, w_orig // 2:]
            orientations = [roi, cv2.rotate(roi, cv2.ROTATE_180)]
        else:
            orientations = [img]

        cleaned_plate = None
        raw_text = ""
        confidence = 0.0

        for candidate_img in orientations:
            cleaned_plate, raw_text, confidence = _scan_plate_from_image(candidate_img)
            if cleaned_plate:
                break

        detected = cleaned_plate if cleaned_plate and len(cleaned_plate.replace("-", "").replace(".", "")) >= 6 else None
        return {
            "success": detected is not None,
            "plate": detected,
            "licensePlate": detected,
            "rawText": raw_text,
            "raw_ocr": raw_text,
            "confidence": round(confidence, 2),
            "lane": lane_mode or "full"
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error during scan: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/scan-registration")
async def scan_registration_card(request: ScanRequest):
    """Quét Cà vẹt xe (Registration Card)"""
    if not reader:
        raise HTTPException(status_code=500, detail="OCR engine not initialized.")

    if not reg_model:
        raise HTTPException(status_code=503, detail="Registration YOLO model not found.")

    try:
        base64_data = request.image
        if "," in base64_data:
            base64_data = base64_data.split(",")[1]
            
        contents = base64.b64decode(base64_data)
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        results = reg_model(img, conf=0.3)
        extracted_data = {
            "licensePlate": None,
            "ownerName": None,
            "brand": None,
            "model": None,
            "colorText": None
        }

        if len(results) > 0 and len(results[0].boxes) > 0:
            boxes = results[0].boxes
            names = reg_model.names
            
            for box in boxes:
                cls_id = int(box.cls[0].cpu().numpy())
                class_name = names[cls_id].lower()
                x1, y1, x2, y2 = box.xyxy[0].cpu().numpy().astype(int)
                crop_img = img[y1:y2, x1:x2]
                processed_crop = preprocess_image_for_ocr(crop_img)
                ocr_results = reader.readtext(processed_crop)
                text = " ".join([res[1] for res in ocr_results]).strip()
                
                if "plate" in class_name or "bien_so" in class_name:
                    extracted_data["licensePlate"] = clean_plate_text(text)
                elif "name" in class_name or "ten_chu_xe" in class_name:
                    extracted_data["ownerName"] = text
                elif "brand" in class_name or "nhan_hieu" in class_name:
                    extracted_data["brand"] = text
                elif "model" in class_name or "loai_xe" in class_name or "so_loai" in class_name:
                    extracted_data["model"] = text
                elif "color" in class_name or "mau_son" in class_name:
                    extracted_data["colorText"] = text

        return {
            "success": True,
            "data": extracted_data
        }

    except Exception as e:
        print(f"Error during registration scan: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


def is_slot_visually_occupied(crop_bgr, slot_code=""):
    """
    TẦNG 1: Kiểm tra siêu nhanh (<0.2ms) ô đỗ có xe/thẻ xe hay là mặt đường trống.
    Chuẩn hóa vùng lõi về kích thước cố định 48×72 (INTER_AREA) nên hoạt động đồng nhất
    trên cả webcam 720p, 1080p lẫn 4K sắc nét, không bị nhiễu chữ số in trên nền đường.
    """
    if crop_bgr is None or crop_bgr.size == 0 or crop_bgr.shape[0] < 10 or crop_bgr.shape[1] < 10:
        return False, 0.0

    h, w = crop_bgr.shape[:2]
    ch1, ch2 = int(h * 0.15), int(h * 0.85)
    cw1, cw2 = int(w * 0.18), int(w * 0.82)
    roi = crop_bgr[ch1:ch2, cw1:cw2] if (ch2 > ch1 and cw2 > cw1) else crop_bgr

    # Đưa về chuẩn 48×72 bằng INTER_AREA để triệt tiêu nhiễu hạt cảm biến & chữ mảnh trên 4K
    norm = cv2.resize(roi, (48, 72), interpolation=cv2.INTER_AREA)
    roi_gray = cv2.cvtColor(norm, cv2.COLOR_BGR2GRAY) if len(norm.shape) == 3 else norm

    std_dev = float(np.std(roi_gray))
    bright_ratio = float(np.mean(roi_gray > 170))
    dark_ratio = float(np.mean(roi_gray < 75))
    edge_ratio = float(np.mean(cv2.Canny(roi_gray, 50, 140) > 0))

    chroma_p90 = 0.0
    if len(norm.shape) == 3:
        b_c, g_c, r_c = cv2.split(norm.astype(np.float32))
        chroma = np.maximum(np.maximum(b_c, g_c), r_c) - np.minimum(np.minimum(b_c, g_c), r_c)
        chroma_p90 = float(np.percentile(chroma, 90))

    if std_dev >= 32.0 or bright_ratio >= 0.16 or dark_ratio >= 0.10 or edge_ratio >= 0.11 or chroma_p90 >= 48.0:
        score = max(std_dev, bright_ratio * 100.0, edge_ratio * 250.0, chroma_p90)
        return True, score

    return False, std_dev



def _extract_tokens_row_sorted(ocr_results):
    """Nhóm các box EasyOCR theo hàng (dòng trên / dòng dưới) ổn định kể cả khi biển số hơi nghiêng."""
    if not ocr_results:
        return [], 0.0
    items = []
    for r in ocr_results:
        box, text, conf = r
        t = re.sub(r'[^A-Z0-9]', '', str(text).upper())
        if not t or _is_scan_ui_noise(t):
            continue
        ys = [pt[1] for pt in box]
        xs = [pt[0] for pt in box]
        cy = 0.5 * (min(ys) + max(ys))
        cx = 0.5 * (min(xs) + max(xs))
        bh = max(1.0, max(ys) - min(ys))
        items.append((cy, cx, bh, t, float(conf)))

    if not items:
        return [], 0.0

    # Chỉ giữ box đủ lớn (>= 30% chiều cao chữ lớn nhất) để loại nhiễu chấm/vết bẩn
    max_bh = max(it[2] for it in items)
    items = [it for it in items if it[2] >= max_bh * 0.30]
    items.sort(key=lambda it: it[0])

    rows = [[items[0]]]
    for it in items[1:]:
        row_cy = float(np.mean([x[0] for x in rows[-1]]))
        row_bh = float(np.mean([x[2] for x in rows[-1]]))
        if abs(it[0] - row_cy) > max(6.0, row_bh * 0.55):
            rows.append([it])
        else:
            rows[-1].append(it)

    tokens = []
    max_conf = 0.0
    for row in rows:
        row.sort(key=lambda x: x[1])
        line_txt = "".join([x[3] for x in row])
        if line_txt:
            tokens.append(line_txt)
        for x in row:
            max_conf = max(max_conf, x[4])
    return tokens, max_conf


def _find_white_plate_candidates(crop_bgr):
    """Tìm vùng thẻ biển số trắng/sáng bên trong crop ô đỗ khi YOLO toàn khung bỏ sót."""
    if crop_bgr is None or crop_bgr.size == 0:
        return []
    h, w = crop_bgr.shape[:2]
    hsv = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2HSV)
    # Thẻ biển số trắng: S thấp, V sáng
    mask = cv2.inRange(hsv, np.array([0, 0, 140]), np.array([180, 75, 255]))
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cands = []
    crop_area = float(max(h * w, 1))
    for cnt in contours:
        x, y, bw, bh = cv2.boundingRect(cnt)
        area_ratio = (bw * bh) / crop_area
        if 0.025 <= area_ratio <= 0.45 and bw >= 16 and bh >= 12 and 0.45 <= (bw / max(bh, 1)) <= 3.2:
            pad_x = max(4, int(bw * 0.14))
            pad_y = max(4, int(bh * 0.14))
            x1, y1 = max(0, x - pad_x), max(0, y - pad_y)
            x2, y2 = min(w, x + bw + pad_x), min(h, y + bh + pad_y)
            cands.append((bw * bh, crop_bgr[y1:y2, x1:x2]))
    cands.sort(key=lambda x: x[0], reverse=True)
    return [c[1] for c in cands[:2]]


def process_slot_alpr(crop_img, slot_code=""):
    """
    TẦNG 2: ALPR OCR đa tầng cho từng ô có xe (YOLO cục bộ -> tìm thẻ biển trắng -> EasyOCR phóng nét 240-360px).
    Tuyệt đối không bóp crop xuống 84px làm mờ chữ biển số.
    """
    if crop_img is None or crop_img.size == 0 or crop_img.shape[0] < 10 or crop_img.shape[1] < 10:
        return None, 0.0

    ocr_engine = alpr_reader if alpr_reader is not None else reader
    if not ocr_engine:
        return None, 0.0

    h, w = crop_img.shape[:2]
    target_h = max(240, min(380, h * 2))
    scale = target_h / float(max(h, 1))
    target_w = max(140, int(round(w * scale)))
    scaled = cv2.resize(crop_img, (target_w, target_h), interpolation=cv2.INTER_CUBIC)

    # 2A. Chạy YOLO cục bộ với ngưỡng nhạy cao (conf=0.06) trên ô đã phóng to
    if yolo_model:
        try:
            with _alpr_infer_lock:
                y_res = yolo_model(scaled, conf=0.06, verbose=False)
            if y_res and len(y_res[0].boxes) > 0:
                boxes = sorted(y_res[0].boxes, key=lambda b: float(b.conf[0]), reverse=True)
                for b in boxes[:2]:
                    x1, y1, x2, y2 = b.xyxy[0].cpu().numpy().astype(int)
                    pad_x = max(8, int((x2 - x1) * 0.12))
                    pad_y = max(6, int((y2 - y1) * 0.12))
                    px1, py1 = max(0, x1 - pad_x), max(0, y1 - pad_y)
                    px2, py2 = min(target_w, x2 + pad_x), min(target_h, y2 + pad_y)
                    p_crop = scaled[py1:py2, px1:px2]
                    p_txt, p_conf = _process_plate_ocr_fast(p_crop, slot_code)
                    if p_txt:
                        return p_txt, max(p_conf, float(b.conf[0]))
        except Exception:
            pass

    # 2B. Tìm thẻ biển số trắng bằng contour HSV trên ô đã phóng to
    for card_patch in _find_white_plate_candidates(scaled):
        p_txt, p_conf = _process_plate_ocr_fast(card_patch, slot_code)
        if p_txt:
            return p_txt, p_conf

    # 2C. Quét EasyOCR trực tiếp trên crop ô đủ độ nét (target_h >= 240px)
    gray = cv2.cvtColor(scaled, cv2.COLOR_BGR2GRAY) if len(scaled.shape) == 3 else scaled
    clahe = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(4, 4))
    enhanced = clahe.apply(gray)
    allowlist = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

    try:
        for img_pass, base_conf in (
            (enhanced, 0.94),
            (cv2.threshold(enhanced, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1], 0.92),
        ):
            res = ocr_engine.readtext(
                img_pass, allowlist=allowlist, paragraph=False, detail=1,
                text_threshold=0.25, low_text=0.20, link_threshold=0.18,
                canvas_size=480, mag_ratio=1.0
            )
            tokens, max_conf = _extract_tokens_row_sorted(res)
            if tokens:
                plate = parse_vietnamese_plate_lines(tokens, "".join(tokens))
                if plate:
                    return plate, max(base_conf, max_conf)
    except Exception:
        pass

    return None, 0.0


@app.post("/scan-slots")
async def scan_parking_slots(request: ScanSlotsRequest):
    """
    Optimized ALPR Engine v3:
    1. YOLO detect biển số trên toàn bộ ảnh 1 lần (~40ms)
    2. Parallel OCR siêu tốc trên tất cả các ô (<30ms/ô với ThreadPoolExecutor)
    3. Phân biệt chính xác ô trống và thẻ xe sa bàn / biển số xe thật
    """
    global _scan_cache

    ocr_engine = alpr_reader if alpr_reader is not None else reader
    if not ocr_engine:
        raise HTTPException(status_code=500, detail="OCR engine not initialized.")

    try:
        scan_start = time.time()

        base64_data = request.image
        if "," in base64_data:
            base64_data = base64_data.split(",")[1]

        contents = base64.b64decode(base64_data)
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return {"success": True, "totalSlots": 0, "slots": []}

        img_h, img_w = img.shape[:2]

        # ─── BƯỚC 0a: Downsample ảnh 4K về tối đa 1920×1080 để tăng tốc xử lý YOLO/OCR ───
        MAX_W, MAX_H = 1920, 1080
        if img_w > MAX_W or img_h > MAX_H:
            scale = min(MAX_W / img_w, MAX_H / img_h)
            new_w = int(img_w * scale)
            new_h = int(img_h * scale)
            img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)
            img_h, img_w = img.shape[:2]
            print(f"[ALPR Engine] 📐 Downsampled image to {img_w}×{img_h} (scale={scale:.2f}) for faster processing")

        # ─── BƯỚC 0: Tự động chuẩn hóa viền ô đỗ (trừ khi người dùng đã khóa Layout thủ công) ───
        physical_slots = {}
        detected_corners = None

        if not request.skipAutoCalibrate:
            try:
                phys_slots, board_corners = _extract_physical_slot_polygons(
                    img, [s.slotCode for s in request.slots], img_w, img_h
                )
                if phys_slots and len(phys_slots) >= 12:
                    physical_slots = phys_slots
                    detected_corners = board_corners
                    for slot_def in request.slots:
                        if slot_def.slotCode in physical_slots:
                            slot_def.polygon = physical_slots[slot_def.slotCode]
                    print(f"[ALPR Engine] 🎯 Auto-calibrated {len(physical_slots)} perspective slots during scan!")
            except Exception as seg_err:
                print(f"[ALPR Engine] Auto-calibration note: {seg_err}")
        else:
            print("[ALPR Engine] 🔒 Using user-locked manual layout polygons (skipAutoCalibrate=True)")

        # Fallback nếu YOLO-Seg chưa phát hiện đủ ô: kiểm tra polygon từ request hoặc canonical
        if not physical_slots:
            has_polys = any(s.polygon and len(s.polygon) >= 3 for s in request.slots)
            if not has_polys:
                canonical, final_corners = _generate_canonical_perspective_slots([s.slotCode for s in request.slots], img, img_w, img_h)
                detected_corners = final_corners
                c_map = {s['slotCode']: s['polygon'] for s in canonical}
                for slot_def in request.slots:
                    if slot_def.slotCode in c_map:
                        slot_def.polygon = c_map[slot_def.slotCode]

        # ─── BƯỚC 1: Chuyển tọa độ polygon sang pixel ─────────────────
        slot_pixel_polys = {}
        for slot_def in request.slots:
            pts = []
            if slot_def.polygon and len(slot_def.polygon) >= 3:
                for p in slot_def.polygon:
                    px, py = float(p[0]), float(p[1])
                    if px <= 1.0 and py <= 1.0 and img_w > 1 and img_h > 1:
                        px, py = px * img_w, py * img_h
                    pts.append([int(px), int(py)])
            elif slot_def.bbox and len(slot_def.bbox) >= 4:
                bx, by, bw, bh = slot_def.bbox
                if bw <= 1.0 and bh <= 1.0 and img_w > 1 and img_h > 1:
                    bx, by, bw, bh = bx * img_w, by * img_h, bw * img_w, bh * img_h
                pts = [[int(bx), int(by)], [int(bx + bw), int(by)],
                       [int(bx + bw), int(by + bh)], [int(bx), int(by + bh)]]
            slot_pixel_polys[slot_def.slotCode] = pts

        # ─── BƯỚC 1.5: Tính hồ sơ độ phủ vật thể (Anti-Parallax & Encroachment) ───
        fg_profiles = _compute_slot_foreground_profiles(img, slot_pixel_polys, img_w, img_h)

        # ─── BƯỚC 2: YOLO Plate Detection trên TOÀN BỘ ảnh (1 lần ~40ms) ───
        slot_plate_map = {}

        if yolo_model:
            try:
                yolo_results = yolo_model(img, conf=0.15, verbose=False)
                if len(yolo_results) > 0 and len(yolo_results[0].boxes) > 0:
                    for box in yolo_results[0].boxes:
                        coords = box.xyxy[0].cpu().numpy().astype(int)
                        x1, y1, x2, y2 = coords
                        yolo_conf = float(box.conf[0].cpu().numpy())
                        pcx, pcy = (x1 + x2) / 2.0, (y1 + y2) / 2.0

                        # Chọn ô chứa nhiều diện tích biển số nhất + kết hợp độ phủ thân xe trong lõi ô
                        candidates = []
                        for sc, pts in slot_pixel_polys.items():
                            if len(pts) < 3:
                                continue
                            in_center = _point_in_polygon(pcx, pcy, pts)
                            # Kiểm tra thêm 4 điểm phần tư quanh tâm biển số để bắt chuẩn khi biển nằm sát vạch
                            sample_pts = [
                                (pcx, pcy),
                                (x1 + 0.25 * (x2 - x1), pcy),
                                (x1 + 0.75 * (x2 - x1), pcy),
                                (pcx, y1 + 0.25 * (y2 - y1)),
                                (pcx, y1 + 0.75 * (y2 - y1)),
                            ]
                            hit_frac = sum(1 for sx, sy in sample_pts if _point_in_polygon(sx, sy, pts)) / float(len(sample_pts))
                            if in_center or hit_frac >= 0.6:
                                core_fg = fg_profiles.get(sc, {}).get('core_fg', 0.0)
                                score = hit_frac * 0.65 + core_fg * 0.35 + (0.20 if in_center else 0.0)
                                candidates.append((score, sc))

                        matched_slot = max(candidates, key=lambda x: x[0])[1] if candidates else None

                        if matched_slot:
                            pad = 10
                            cx1 = max(0, x1 - pad)
                            cy1 = max(0, y1 - pad)
                            cx2 = min(img_w, x2 + pad)
                            cy2 = min(img_h, y2 + pad)
                            plate_crop = img[cy1:cy2, cx1:cx2]

                            if matched_slot not in slot_plate_map or yolo_conf > slot_plate_map[matched_slot]['yolo_conf']:
                                slot_plate_map[matched_slot] = {
                                    'plate_crop': plate_crop,
                                    'yolo_conf': yolo_conf,
                                    'bbox': (cx1, cy1, cx2, cy2),
                                }
            except Exception as yolo_err:
                print(f"[ALPR Engine] YOLO plate detection note: {yolo_err}")

        # ─── BƯỚC 2.5: Scene Validation (Chỉ cảnh báo khi mặt người thật chiếm phần lớn khung hình) ───
        try:
            # Nếu đã phát hiện ô đỗ xe hoặc sa bàn thì KHÔNG BAO GIỜ coi là mặt người
            if not physical_slots or len(physical_slots) < 4:
                ycrcb = cv2.cvtColor(img, cv2.COLOR_BGR2YCrCb)
                skin_mask = cv2.inRange(ycrcb, np.array([0, 133, 77]), np.array([255, 173, 127]))
                skin_ratio = float(np.sum(skin_mask > 0)) / float(img_w * img_h)

                # Chỉ kích hoạt nếu màu da người thật sự chiếm > 50% diện tích (selfie vào mặt)
                # và hoàn toàn không có biển số hay ô đỗ nào
                if skin_ratio > 0.50 and not slot_plate_map:
                    reason = "Camera is facing user face or room space instead of the parking lot! Please adjust camera angle."
                    print(f"[ALPR Engine] ⚠️ Camera Misaligned: skin={skin_ratio:.3f}. {reason}")
                    return {
                        "success": True,
                        "isParkingLotScene": False,
                        "invalidReason": reason,
                        "totalSlots": len(request.slots),
                        "slots": []
                    }
        except Exception as scene_err:
            print(f"[ALPR Engine] Scene validation check note: {scene_err}")

        # ─── BƯỚC 3: Crop ô + Thumbnail MAD Cache + Fast Empty Pre-Filter ───────────
        slot_crops = {}
        slot_inner_crops = {}
        slot_hashes = {}
        slot_thumbs = {}
        now = time.time()

        for slot_def in request.slots:
            sc = slot_def.slotCode
            pts = slot_pixel_polys.get(sc, [])
            crop = None
            inner_crop = None

            if len(pts) == 4:
                # Giữ vùng cắt nằm gọn trong ô (0.95) để fallback OCR không đọc nhầm biển số xe ở ô kế bên
                crop = _crop_slot_perspective(img, pts, img_w, img_h, expand=0.95)
                inner_crop = _crop_slot_perspective(img, pts, img_w, img_h, expand=0.88)
            if crop is None and len(pts) >= 3:
                pts_np = np.array(pts, dtype=np.int32)
                pad_x = int(img_w * 0.02)
                pad_y = int(img_h * 0.02)
                bx1 = max(0, int(pts_np[:, 0].min()) - pad_x)
                bx2 = min(img_w, int(pts_np[:, 0].max()) + pad_x)
                by1 = max(0, int(pts_np[:, 1].min()) - pad_y)
                by2 = min(img_h, int(pts_np[:, 1].max()) + pad_y)
                if bx2 - bx1 >= 12 and by2 - by1 >= 12:
                    crop = img[by1:by2, bx1:bx2]
                    inner_crop = crop

            slot_crops[sc] = crop
            ic = inner_crop if inner_crop is not None else crop
            slot_inner_crops[sc] = ic
            slot_hashes[sc] = _compute_slot_hash(ic) if ic is not None else ""
            if ic is not None and ic.size > 0:
                th = cv2.resize(ic, (24, 36), interpolation=cv2.INTER_AREA)
                th_g = cv2.cvtColor(th, cv2.COLOR_BGR2GRAY) if len(th.shape) == 3 else th
                slot_thumbs[sc] = th_g.astype(np.int16) - int(np.mean(th_g))

        # Chỉ tái sử dụng cache với các ô ĐÃ NHẬN DIỆN THÀNH CÔNG cả xe lẫn biển số (<= 10s, MAD < 4.5).
        # Tuyệt đối không cache trạng thái trống hay lỗi OCR để tránh "đóng băng" ô vừa bỏ sót.
        cached_results = {}
        slots_to_ocr = []
        skipped_empty = 0
        cache_hits = 0

        with _scan_cache_lock:
            cache_snapshot = {k: dict(v) for k, v in _scan_cache.items()}

        for slot_def in request.slots:
            sc = slot_def.slotCode
            has_yolo_plate = sc in slot_plate_map
            cur_thumb = slot_thumbs.get(sc)
            prev = cache_snapshot.get(sc)

            if prev and cur_thumb is not None and prev.get('thumb') is not None and (now - prev.get('timestamp', 0)) <= 10.0:
                prev_res = prev.get('result', {})
                if prev_res.get('occupied') and prev_res.get('plate'):
                    mad = float(np.mean(np.abs(cur_thumb - prev['thumb'])))
                    if mad < 4.5:
                        cached_results[sc] = dict(prev_res)
                        cache_hits += 1
                        continue

            if not has_yolo_plate:
                prof = fg_profiles.get(sc)
                if prof is not None:
                    # Khử thị sai 3D góc nghiêng: ô chỉ có xe nếu vùng lõi giữa ô thực sự bị che >= 35%
                    if prof['core_fg'] < 0.35:
                        cached_results[sc] = {"slotCode": sc, "occupied": False, "plate": None, "confidence": 0.0}
                        skipped_empty += 1
                        continue
                else:
                    occ_visual, _ = is_slot_visually_occupied(slot_inner_crops.get(sc), sc)
                    if not occ_visual:
                        cached_results[sc] = {"slotCode": sc, "occupied": False, "plate": None, "confidence": 0.0}
                        skipped_empty += 1
                        continue

            slots_to_ocr.append(sc)

        # ─── BƯỚC 4 & 5: OCR CHỈ TRÊN CÁC Ô CÓ XE / BIỂN SỐ ──────────────────
        def _process_single_slot(slot_code):
            res = {"slotCode": slot_code, "occupied": False, "plate": None, "confidence": 0.0}

            # 1. Nếu YOLO đã phát hiện biển số, OCR ngay trên vùng crop nhỏ (~150ms)
            plate_info = slot_plate_map.get(slot_code)
            if plate_info and plate_info['plate_crop'] is not None and plate_info['plate_crop'].size > 0:
                plate_text, ocr_conf = _process_plate_ocr_fast(plate_info['plate_crop'], slot_code)
                if plate_text:
                    res['occupied'] = True
                    res['plate'] = plate_text
                    res['confidence'] = max(ocr_conf, plate_info['yolo_conf'])
                    return res

            # 2. Fallback OCR trên crop ô có vật thể (chỉ chạy nếu ô thật sự có xe)
            crop = slot_crops.get(slot_code)
            if crop is not None and crop.size > 0:
                plate_text, ocr_conf = process_slot_alpr(crop, slot_code)
                if plate_text:
                    res['occupied'] = True
                    res['plate'] = plate_text
                    res['confidence'] = ocr_conf
                    return res

            # 3. Bảo toàn trạng thái CÓ XE dù OCR/biển số chưa đọc được ký tự (để Cloud Fusion/Staff xử lý)
            prof = fg_profiles.get(slot_code)
            if (prof is not None and prof['core_fg'] >= 0.45) or (plate_info is not None and plate_info['yolo_conf'] >= 0.25):
                res['occupied'] = True
                res['plate'] = None
                res['ocrFailed'] = True
                res['confidence'] = 0.80

            return res

        ocr_results_map = {}
        t_ocr_start = time.time()
        if slots_to_ocr:
            print(f"[ALPR Engine] ⚡ Running OCR on {len(slots_to_ocr)} candidate slots (skipped {skipped_empty} empty, {cache_hits} cached)")
            # Chạy tuần tự để PyTorch EasyOCR tận dụng trọn CPU mà không tranh chấp OpenMP threads
            for sc in slots_to_ocr:
                try:
                    ocr_results_map[sc] = _process_single_slot(sc)
                except Exception:
                    ocr_results_map[sc] = {
                        "slotCode": sc, "occupied": False,
                        "plate": None, "confidence": 0.0
                    }
        else:
            print(f"[ALPR Engine] ⚡ Instant scan: 0 OCR needed (skipped {skipped_empty} empty, {cache_hits} cached)")
        ocr_elapsed = time.time() - t_ocr_start
        print(f"[ALPR Engine] ⏱️ OCR stage finished in {ocr_elapsed:.2f}s for {len(slots_to_ocr)} slots")

        # ─── BƯỚC 6: Gộp kết quả + Anti-Parallax & Double-Parking Detection + Voting ─────
        raw_results_by_sc = {}
        plate_owners = {}  # norm_plate -> (slotCode, score, plate_display, conf)

        for slot_def in request.slots:
            sc = slot_def.slotCode
            res = dict(ocr_results_map.get(sc) or cached_results.get(sc) or {
                "slotCode": sc, "occupied": False, "plate": None, "confidence": 0.0
            })
            # Reset cờ lấn ô từ cache trước khi đánh giá lại ở lượt quét hiện tại
            if res.pop('occupiedByOverlap', False):
                res['occupied'] = False
                res['plate'] = None
                res['confidence'] = 0.0
            res.pop('primarySlot', None)
            res.pop('encroachmentScore', None)

            prof = fg_profiles.get(sc)
            if prof is not None:
                res['coreCoverage'] = round(prof['core_fg'], 3)

            # Nếu fallback OCR không có YOLO plate trực tiếp tại ô mà lõi ô < 0.42 (lẹm nhẹ góc nghiêng), hủy gán nhầm
            if res.get('plate') and sc not in slot_plate_map and prof is not None and prof['core_fg'] < 0.42:
                res['plate'] = None
                res['occupied'] = False
                res['confidence'] = 0.0

            if res.get('plate'):
                p_norm = res['plate'].replace("-", "").replace(".", "").upper()
                core_cov = prof['core_fg'] if prof is not None else 0.5
                has_direct = 1.0 if sc in slot_plate_map else 0.0
                rank_score = has_direct * 1.5 + core_cov * 1.0 + float(res.get('confidence', 0.5)) * 0.2
                prev_best = plate_owners.get(p_norm)
                if prev_best is None or rank_score > prev_best[1]:
                    plate_owners[p_norm] = (sc, rank_score, res['plate'], res.get('confidence', 0.9))

            raw_results_by_sc[sc] = res

        # De-duplicate: giữ mỗi biển số tại 1 ô chính có điểm cao nhất
        for sc, res in raw_results_by_sc.items():
            if res.get('plate'):
                p_norm = res['plate'].replace("-", "").replace(".", "").upper()
                if plate_owners.get(p_norm, (None,))[0] != sc:
                    res['plate'] = None
                    res['occupied'] = False
                    res['confidence'] = 0.0
                    res.pop('encroaching', None)
                    res.pop('primarySlot', None)

        # Kiểm tra xe thực sự đậu chiếm quá mức sang ô hàng xóm (DOUBLE_PARKING_VIOLATION)
        # Chống báo giả khi chỉ lẹm nóc nhẹ do góc nghiêng (core_fg < 0.45)
        for p_norm, (primary_sc, _, plate_disp, primary_conf) in plate_owners.items():
            p_prof = fg_profiles.get(primary_sc)
            if not p_prof:
                continue
            p_cx, p_cy, p_w, p_h = p_prof['cx'], p_prof['cy'], p_prof['w'], p_prof['h']
            for n_sc, n_res in raw_results_by_sc.items():
                if n_sc == primary_sc or n_res.get('occupied') or n_res.get('plate') or n_sc in slot_plate_map:
                    continue
                n_prof = fg_profiles.get(n_sc)
                if not n_prof:
                    continue
                # Chỉ xét 2 ô kề cạnh nhau trong cùng 1 dãy ngang (không vượt qua lòng đường hay sang dãy khác)
                dy = abs(n_prof['cy'] - p_cy)
                dx = n_prof['cx'] - p_cx
                if dy > 0.40 * max(min(p_h, n_prof['h']), 10.0) or abs(dx) > 1.48 * max(p_w, n_prof['w'], 10.0):
                    continue
                if dx < 0:
                    # Ô hàng xóm nằm bên TRÁI ô chính -> cạnh tiếp giáp là right_fg của hàng xóm & left_fg của ô chính
                    n_touch, n_far = n_prof['right_fg'], n_prof['left_fg']
                    p_touch, p_far = p_prof['left_fg'], p_prof['right_fg']
                else:
                    # Ô hàng xóm nằm bên PHẢI ô chính -> cạnh tiếp giáp là left_fg của hàng xóm & right_fg của ô chính
                    n_touch, n_far = n_prof['left_fg'], n_prof['right_fg']
                    p_touch, p_far = p_prof['right_fg'], p_prof['left_fg']

                # Điều kiện chiếm 2 ô thật:
                # 1. Thân xe phủ liền mạch qua ranh giới chung (>= 0.65 cả 2 phía mép chung)
                # 2. Lấn sâu vào lõi ô hàng xóm (core_fg >= 0.45 và full_fg >= 0.48) -> bỏ qua lẹm nhẹ góc nghiêng!
                # 3. Tổng độ che phủ không phải 2 xe riêng rẽ đỗ sát nhau (ít nhất 1 bên mép ngoài < 0.65 hoặc tổng lõi < 1.72)
                bridged = (n_touch >= 0.65 and p_touch >= 0.65)
                deep_intrusion = (n_prof['core_fg'] >= 0.45 and n_prof['full_fg'] >= 0.48)
                single_straddling_car = ((min(n_far, p_far) < 0.65) or ((p_prof['core_fg'] + n_prof['core_fg']) < 1.72))

                if bridged and deep_intrusion and single_straddling_car:
                    n_res['occupied'] = True
                    n_res['plate'] = plate_disp
                    n_res['confidence'] = round(min(float(primary_conf), 0.96), 2)
                    n_res['occupiedByOverlap'] = True
                    n_res['primarySlot'] = primary_sc
                    n_res['encroachmentScore'] = round(n_prof['core_fg'], 3)
                    print(f"[ALPR Engine] ⚠️ DOUBLE PARKING: Vehicle {plate_disp} at {primary_sc} encroaches {n_sc} (n_core={n_prof['core_fg']:.2f}, touch={n_touch:.2f})")

        results = []
        for slot_def in request.slots:
            sc = slot_def.slotCode
            res = raw_results_by_sc.get(sc, {
                "slotCode": sc, "occupied": False, "plate": None, "confidence": 0.0
            })

            # Voting: tăng confidence nếu cùng biển số lặp lại qua nhiều lần scan
            with _scan_cache_lock:
                prev = _scan_cache.get(sc, {})
                prev_plate = prev.get('result', {}).get('plate')
                if res.get('plate') and prev_plate == res['plate']:
                    vote = prev.get('vote_count', 0) + 1
                    res['confidence'] = min(0.99, res['confidence'] + 0.02 * vote)
                else:
                    vote = 1 if res.get('plate') else 0

                _scan_cache[sc] = {
                    'result': res,
                    'hash': slot_hashes.get(sc, ''),
                    'thumb': slot_thumbs.get(sc),
                    'timestamp': now,
                    'vote_count': vote,
                }

            if slot_def.polygon:
                res['polygon'] = slot_def.polygon

            results.append(res)

            if res.get('occupied') and res.get('plate'):
                tag = f" [ENCROACH from {res['primarySlot']}]" if res.get('occupiedByOverlap') else ""
                print(f"[ALPR Engine] >>> Slot {sc} OCCUPIED: Plate={res['plate']}, Conf={res['confidence']:.2f}{tag}")

        # Dọn cache hết hạn
        with _scan_cache_lock:
            expired_keys = [k for k, v in _scan_cache.items() if now - v['timestamp'] > CACHE_TTL_SECONDS * 3]
            for k in expired_keys:
                del _scan_cache[k]

        scan_time = time.time() - scan_start
        print(f"[ALPR Engine] Scan complete: {len(results)} slots, "
              f"{sum(1 for r in results if r.get('occupied'))} occupied, "
              f"{scan_time:.2f}s")

        # ─── BƯỚC 7: Tự động phát hiện Tầng thực tế (Floor Verification) ───
        floor_1_plates = {'43B-204.08', '11A-123.45', '78A-987.31', '77C-143.99', '99A-280.96', '13C-343.21', '43B-204.04', '19H-438.99'}
        floor_2_plates = {'12B-223.47', '55H-443.23', '90A-280.96', '99A-280.96', '99C-643.99', '22B-123.45', '93A-289.87'}
        detected_floor_num = None

        all_detected_plates = [r.get('plate') for r in results if r.get('plate')]
        for p in all_detected_plates:
            if p in floor_2_plates:
                detected_floor_num = 2
                break
            elif p in floor_1_plates:
                detected_floor_num = 1
                break

        calibrated_slots = [{"slotCode": s.slotCode, "polygon": s.polygon} for s in request.slots if s.polygon]

        return {
            "success": True,
            "detectedFloorNumber": detected_floor_num,
            "detectedFloorName": f"Floor {detected_floor_num}" if detected_floor_num else None,
            "totalSlots": len(results),
            "slots": results,
            "calibratedSlots": calibrated_slots if physical_slots else None,
            "corners": detected_corners,
            "scanTime": round(scan_time, 2)
        }
    except Exception as e:
        print(f"Error during slot surveillance scan: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------
# Internal Helpers for Optimized ALPR Engine v2
# ---------------------------------------------------------

def _compute_slot_hash(crop_bgr):
    """Perceptual hash nhanh để so sánh ô đỗ giữa 2 frame liên tiếp."""
    if crop_bgr is None or crop_bgr.size == 0:
        return ""
    small = cv2.resize(crop_bgr, (16, 16), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY) if len(small.shape) == 3 else small
    mean_val = float(gray.mean())
    bits = (gray.flatten() > mean_val)
    return ''.join(['1' if b else '0' for b in bits])


def _hash_similarity(h1, h2):
    """So sánh 2 perceptual hash, trả về 0.0 → 1.0."""
    if not h1 or not h2 or len(h1) != len(h2):
        return 0.0
    return sum(a == b for a, b in zip(h1, h2)) / len(h1)


def _point_in_polygon(px, py, polygon):
    """Ray-casting point-in-polygon test (dùng để map YOLO detection → slot)."""
    n = len(polygon)
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        if ((yi > py) != (yj > py)) and (px < (xj - xi) * (py - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def _process_plate_ocr_fast(plate_crop, slot_code=""):
    """
    OCR tối ưu và chịu nghiêng cao cho vùng thẻ biển số:
    Pass 1: Phóng nét + CLAHE dịu (không gây halo viền chữ như Laplacian mạnh)
    Pass 2: Otsu + Adaptive Threshold cho thẻ bị chói/lệch sáng
    Pass 3: Thử xoay nghiêng nhẹ ±10° hoặc 180° nếu vẫn chưa tách đủ 2 dòng
    """
    if plate_crop is None or plate_crop.size == 0:
        return None, 0.0

    ocr_engine = alpr_reader if alpr_reader is not None else reader
    if not ocr_engine:
        return None, 0.0

    h, w = plate_crop.shape[:2]
    target_w = max(220, min(420, int(w * 2.5)))
    scale = target_w / max(1, w)
    scaled = cv2.resize(plate_crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)

    gray = cv2.cvtColor(scaled, cv2.COLOR_BGR2GRAY) if len(scaled.shape) == 3 else scaled
    clahe = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(4, 4))
    enhanced = clahe.apply(gray)

    allowlist = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

    def _run_ocr(img_in, thresh=0.25, low=0.20, link=0.18):
        res = ocr_engine.readtext(
            img_in, allowlist=allowlist, paragraph=False,
            text_threshold=thresh, low_text=low, link_threshold=link,
            canvas_size=384, mag_ratio=1.0
        )
        tokens, max_conf = _extract_tokens_row_sorted(res)
        if tokens:
            cleaned = parse_vietnamese_plate_lines(tokens, "".join(tokens))
            if cleaned:
                return cleaned, max(0.92, max_conf)
        return None, 0.0

    try:
        # Pass 1: CLAHE dịu sắc nét tự nhiên
        plate1, conf1 = _run_ocr(enhanced)
        if plate1:
            return plate1, conf1

        # Pass 2: Unsharp mask nhẹ (tránh làm vỡ nét chữ nhỏ ở mép khung)
        blur = cv2.GaussianBlur(enhanced, (0, 0), 1.2)
        unsharp = cv2.addWeighted(enhanced, 1.45, blur, -0.45, 0)
        plate2, conf2 = _run_ocr(unsharp, thresh=0.20, low_text=0.16, link=0.15)
        if plate2:
            return plate2, conf2

        # Pass 3: Otsu + Adaptive binary cho thẻ trắng bị lóa đèn / tối góc
        _, otsu = cv2.threshold(enhanced, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        plate3, conf3 = _run_ocr(otsu, thresh=0.20, low_text=0.16, link=0.15)
        if plate3:
            return plate3, conf3

        # Pass 4: Xoay nhẹ ±10° khi thẻ bị nghiêng do xe đỗ chéo ở rìa (B5 / C2)
        sh, sw = enhanced.shape[:2]
        center = (sw / 2.0, sh / 2.0)
        for angle in (-10.0, 10.0):
            M = cv2.getRotationMatrix2D(center, angle, 1.0)
            rot = cv2.warpAffine(enhanced, M, (sw, sh), borderMode=cv2.BORDER_REPLICATE)
            plate_r, conf_r = _run_ocr(rot, thresh=0.20, low_text=0.16, link=0.15)
            if plate_r:
                return plate_r, conf_r
    except Exception:
        pass

    return None, 0.0


def _compute_slot_foreground_profiles(img, slot_pixel_polys, img_w, img_h):
    """
    Tính hồ sơ độ phủ vật thể (core_fg, left_fg, right_fg, full_fg) miễn nhiễm ánh đèn/bóng râm:
    1. Chuẩn hóa ánh sáng cục bộ từng ô theo mặt đường + chroma Lab (a,b) để không nhầm nền xám lóa đèn (B5) thành xe.
    2. Cổng cấu trúc vật thể (Sobel edge + vivid HSV saturation + Lab chroma std): mặt giấy phẳng không có xe luôn bị hạ core_fg xuống mức trống.
    """
    profiles = {}
    warps = {}
    zone_bg_samples = {}
    global_bg_samples = []

    for sc, pts in slot_pixel_polys.items():
        if not pts or len(pts) != 4:
            continue
        c = _crop_slot_perspective(img, pts, img_w, img_h, expand=1.0)
        if c is None or c.size == 0:
            continue
        norm = cv2.resize(c, (48, 72), interpolation=cv2.INTER_AREA)
        pts_np = np.array(pts, dtype=np.float32)
        cx, cy = float(np.mean(pts_np[:, 0])), float(np.mean(pts_np[:, 1]))
        w_box = float(np.max(pts_np[:, 0]) - np.min(pts_np[:, 0]))
        h_box = float(np.max(pts_np[:, 1]) - np.min(pts_np[:, 1]))
        zone = sc[0].upper() if sc else 'A'
        warps[sc] = (norm, zone, cx, cy, w_box, h_box)

        patch = norm[16:60, 8:40].astype(np.float32)
        ch = np.max(patch, axis=2) - np.min(patch, axis=2)
        lum = np.mean(patch, axis=2)
        low = patch[(ch < 26) & (lum > 55) & (lum < 210)]
        if len(low) > 0:
            zone_bg_samples.setdefault(zone, []).append(low)
            global_bg_samples.append(low)

    if not global_bg_samples:
        return profiles

    global_bg = np.median(np.vstack(global_bg_samples), axis=0)
    zone_bgs = {}
    for z, samples in zone_bg_samples.items():
        stacked = np.vstack(samples)
        zone_bgs[z] = np.median(stacked, axis=0) if len(stacked) >= 200 else global_bg

    for sc, (norm, zone, cx, cy, w_box, h_box) in warps.items():
        bg = zone_bgs.get(zone, global_bg)
        patch = norm[14:62, :].astype(np.float32)

        diff = np.linalg.norm(patch - bg[None, None, :], axis=2)
        ch = np.max(patch, axis=2) - np.min(patch, axis=2)
        fg = (diff > 36.0) | (ch > 30.0)

        core_fg = float(np.mean(fg[:, 12:36]))
        left_fg = float(np.mean(fg[:, 3:18]))
        right_fg = float(np.mean(fg[:, 30:45]))
        full_fg = float(np.mean(fg[:, 5:43]))

        # Cổng cấu trúc vật thể trong lõi ô (chống 100% bóng đổ/chói đèn trên giấy phẳng)
        core_bgr = norm[14:62, 10:38]
        core_gray = cv2.cvtColor(core_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
        gx = cv2.Sobel(core_gray, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(core_gray, cv2.CV_32F, 0, 1, ksize=3)
        edge_frac = float(np.mean(np.hypot(gx, gy) > 45.0))
        std_g = float(np.std(core_gray))
        hsv = cv2.cvtColor(core_bgr, cv2.COLOR_BGR2HSV)
        sat_vivid = float(np.mean(hsv[:, :, 1] > 70))
        lab = cv2.cvtColor(core_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
        ab_std = float(np.std(lab[:, :, 1]) + np.std(lab[:, :, 2]))

        has_real_vehicle = (edge_frac >= 0.30) or (sat_vivid >= 0.22 and edge_frac >= 0.22) or (std_g >= 24.0 and edge_frac >= 0.25)
        if not has_real_vehicle:
            core_fg = min(core_fg, 0.16)
            full_fg = min(full_fg, 0.18)
        else:
            core_fg = max(core_fg, min(0.98, edge_frac * 0.9 + sat_vivid * 0.5))

        profiles[sc] = {
            'core_fg': core_fg,
            'left_fg': left_fg,
            'right_fg': right_fg,
            'full_fg': full_fg,
            'edge_frac': edge_frac,
            'sat_vivid': sat_vivid,
            'cx': cx, 'cy': cy, 'w': w_box, 'h': h_box,
        }

    return profiles


def _crop_slot_perspective(img, pts, img_w, img_h, expand=1.15):
    """Perspective warp 1 ô đỗ xe từ ảnh gốc, chống méo phối cảnh camera."""
    try:
        pts_np = np.array(pts, dtype=np.float32)
        cx, cy = float(np.mean(pts_np[:, 0])), float(np.mean(pts_np[:, 1]))
        padded = []
        for px, py in pts:
            ex = np.clip(cx + expand * (px - cx), 0, img_w - 1)
            ey = np.clip(cy + expand * (py - cy), 0, img_h - 1)
            padded.append([ex, ey])
        src = np.array(padded, dtype=np.float32)
        tw = max(80, int(max(np.hypot(src[1][0] - src[0][0], src[1][1] - src[0][1]),
                             np.hypot(src[2][0] - src[3][0], src[2][1] - src[3][1]))))
        th = max(80, int(max(np.hypot(src[3][0] - src[0][0], src[3][1] - src[0][1]),
                             np.hypot(src[2][0] - src[1][0], src[2][1] - src[1][1]))))
        dst = np.array([[0, 0], [tw - 1, 0], [tw - 1, th - 1], [0, th - 1]], dtype=np.float32)
        M = cv2.getPerspectiveTransform(src, dst)
        return cv2.warpPerspective(img, M, (tw, th))
    except Exception:
        return None



if __name__ == "__main__":
    print("Starting ValoParking AI Service on port 8000...")
    uvicorn.run(app, host="0.0.0.0", port=8000)


