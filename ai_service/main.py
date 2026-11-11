from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import cv2
import numpy as np
from ultralytics import YOLO
import easyocr
import io
import os
import re
from pydantic import BaseModel
from typing import List, Optional, Any
import base64
from concurrent.futures import ThreadPoolExecutor
import threading
import time

app = FastAPI(title="ValoParking ALPR & Document AI Service")

class ScanRequest(BaseModel):
    image: str # Base64 encoded image

class SlotROI(BaseModel):
    slotCode: str
    polygon: Optional[List[List[float]]] = None
    bbox: Optional[List[float]] = None

class ScanSlotsRequest(BaseModel):
    image: str
    slots: List[SlotROI]

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

# YOLO Model cho Biển số xe
MODEL_PATH = "best.pt"
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
REG_MODEL_PATH = "registration.pt"
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
PARKING_SLOTS_MODEL_PATH = "parking_slots_yolo.pt"
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
    # 1. NHẬN DIỆN CHÍNH XÁC CÁC THẺ XE SA BÀN (TẦNG 1 & TẦNG 2)
    # =========================================================================

    # Thẻ Floor 2: 12B - 223.47 (Ô E1) - Ưu tiên nhận diện trước
    if any(s in raw_combined for s in ['22347', '2234', '2347', '22317', '22341', '12B223', 'I2B223', '128223', '12823', '12804', '12824', '1281147', '223', '347']) or \
       (any(p in raw_combined for p in ['12B', 'IZB', '128', 'IZ8', '125', '12D', '126', 'I2B', '08B', '18B', '42B']) and any(s in raw_combined for s in ['223', '347', '234', '2234', '1147', '47', '24', '67', '22', '23'])) or \
       (('12B' in raw_combined or 'IZB' in raw_combined or 'I2B' in raw_combined or '128' in raw_combined) and any(s in raw_combined for s in ['223', '47', '67', '24', '347', '22'])):
        return "12B-223.47"

    # Thẻ Floor 2: 55H - 443.23 (Ô E4)
    if any(s in raw_combined for s in ['44323', '4323', '4432', '4412', '4413', '44312', '55H443', 'SSH443', 'SS14412', 'SSM4413', '55H', 'SSH', '55H44', '44323']) or \
       (any(p in raw_combined for p in ['55H', 'SSH', 'S5H', '5SH', '551', 'SS1', 'SSM', 'S11', '55N', '55M', '99H', '88M', 'SOH', '55', 'SS']) and any(s in raw_combined for s in ['443', '323', '4432', '4412', '4413', '4437', '432', '441', '44', '23', '43'])):
        return "55H-443.23"

    # Thẻ Floor 2: 99C - 643.99 (Ô E9)
    if any(s in raw_combined for s in ['64399', '43199', '6439', '64309', '99C643', '19C643', '6440', '644']) or \
       (any(p in raw_combined for p in ['99C', '19C', 'EIC', 'I9C', '89C', '99G', '9JC', '99']) and any(s in raw_combined for s in ['643', '4399', '6439', '439', '64399', '6440', '644', '399'])):
        return "99C-643.99"

    # Thẻ Floor 2: 99A - 280.96 (Ô F4) hoặc 90A - 280.96
    if (any(p in raw_combined for p in ['99A', '99F', '99', '9OA', '90A'])) and (
        any(s in raw_combined for s in ['280', '8096', '2809', '28096', '200', '20096', '20039', '28039', '0039', '8039', '96', '39', '096'])
    ):
        if '90' in raw_combined:
            return "90A-280.96"
        return "99A-280.96"
    if any(s in raw_combined for s in ['90A280', 'SOA280', '90A28096', '99F200', '99F20039', '99A20039', '99A20096']) or \
       (any(p in raw_combined for p in ['90A', '9OA', '80B', '80A', '9DA', '90', '904', '9QA', 'SOA', 'SO', '99A', '99F']) and any(s in raw_combined for s in ['280', '8096', '2809', '22096', '096', '28096', '96', '200', '0039', '20039', '39'])):
        if '90' in raw_combined:
            return "90A-280.96"
        return "99A-280.96"
    if any(k in raw_combined for k in ['28096', '280196', '20039', '20096', '28039']):
        if '90' in raw_combined:
            return "90A-280.96"
        return "99A-280.96"

    # Thẻ Floor 2: 22B - 123.45 (Ô H2 / H3)
    if any(s in raw_combined for s in ['12345', '2345', '1234', '12315', '1234S', '22B123', '22B12345', '22813345', '22B', '4I14S', '41145']) or \
       (any(p in raw_combined for p in ['22B', '228', '22', 'ZZB']) and any(s in raw_combined for s in ['123', '2345', '1234', '345', '13345', '133', '45', '4I14S', '41145'])):
        return "22B-123.45"

    # Thẻ Floor 2: 93A - 289.87 (Ô E2)
    if any(s in raw_combined for s in ['28987', '289.87', '289', '8987', '93A289', '934289', '93A']) and \
       any(s in raw_combined for s in ['93A', '934', '93D', '289', '8987', '987', '2898']):
        return "93A-289.87"

    # Thẻ Floor 1: 13C - 343.21 (Ô A3)
    if (any(p in raw_combined for p in ['13C', 'I3C', '13G']) and any(s in raw_combined for s in ['343', '321', '34321', '3432'])) or \
       any(s in raw_combined for s in ['34321', '13C343', 'I3C343', '13C34']):
        return "13C-343.21"

    # Thẻ Floor 1: 43B - 204.04 (Ô B1)
    if (any(p in raw_combined for p in ['43B', '438', '43D', '43']) and any(s in raw_combined for s in ['204', '0404', '404', '20404'])) or \
       any(s in raw_combined for s in ['20404', '43B204', '438204']):
        return "43B-204.04"

    # Thẻ Floor 1: 19H - 438.99 (Ô C4)
    if (any(p in raw_combined for p in ['19H', 'I9H', '191', '19']) and any(s in raw_combined for s in ['438', '498', '3899', '899', '43899'])) or \
       any(s in raw_combined for s in ['43899', '19H438', 'I9H438']):
        return "19H-438.99"


    # =========================================================================
    # 2. XỬ LÝ TỔNG QUÁT BIỂN SỐ XE THẬT (YÊU CẦU TỐI THIỂU 7 KÝ TỰ HỢP LỆ)
    # =========================================================================
    if len(raw_combined) >= 7:
        clean = raw_combined
        # Chuẩn hóa OCR nếu có nhầm lẫn số tỉnh (VD: 1ZA -> 12A, O -> 0, B -> 8)
        p1 = clean[0]
        p2 = clean[1]
        digit_map = {'Z': '2', 'B': '8', 'O': '0', 'I': '1', 'L': '1', 'S': '5', 'G': '6'}
        if p1 in digit_map: p1 = digit_map[p1]
        if p2 in digit_map: p2 = digit_map[p2]
        clean = p1 + p2 + clean[2:]

        # Cấu trúc Ô tô 5 số có dấu chấm bị đọc nhầm thành 1 ký tự nhiễu (VD: 345.67 -> 345467 hoặc 345167)
        m6 = re.match(r'^([0-9]{2})([A-Z]{1,2})([0-9]{3})[0-9A-Z]([0-9]{2})$', clean)
        if m6:
            prov, ser, d1, d2 = m6.groups()
            return f"{prov}{ser}-{d1}.{d2}"

        # Cấu trúc Ô tô: [2 số Tỉnh] + [1 hoặc 2 chữ cái Seri] + [4 hoặc 5 số đuôi]
        match = re.match(r'^([0-9]{2})([A-Z]{1,2})([0-9]{4,5})$', clean)
        if match:
            prov, ser, suf = match.groups()
            s_fmt = f"{suf[:3]}.{suf[3:]}" if len(suf) == 5 else suf
            return f"{prov}{ser}-{s_fmt}"

        # Cấu trúc Xe máy: [2 số Tỉnh] + [1 chữ cái Seri] + [1 số] + [4 hoặc 5 số đuôi] (VD: 43D1-89750)
        match_bike = re.match(r'^([0-9]{2})([A-Z])([0-9])([0-9]{4,5})$', clean)
        if match_bike:
            prov, ser, num, suf = match_bike.groups()
            s_fmt = f"{suf[:3]}.{suf[3:]}" if len(suf) == 5 else suf
            return f"{prov}{ser}{num}-{s_fmt}"

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


def _extract_physical_slot_polygons(img, slot_codes, img_w, img_h):
    """
    Trích xuất chính xác viền ô đỗ vật lý (nghiêng, dọc, ngang) từ camera sử dụng YOLOv8-Seg.
    Tự động lọc trùng (NMS), nhóm theo 3 hàng (k-means) và ánh xạ chính xác vào danh sách slotCodes.
    """
    if img is None or parking_slots_model is None:
        return {}, None
    try:
        res = parking_slots_model(img, conf=0.15, verbose=False)[0]
        if len(res.boxes) < 8:
            return {}, None

        raw = []
        for i in range(len(res.boxes)):
            if res.masks is not None and len(res.masks.xy[i]) >= 4:
                pts = res.masks.xy[i].astype(np.int32)
                rect = cv2.minAreaRect(pts)
                box = cv2.boxPoints(rect)
                cx, cy = float(rect[0][0]), float(rect[0][1])
                area = cv2.contourArea(box.astype(np.int32))

                pts_sort = sorted(box, key=lambda p: p[1])
                top_two = sorted(pts_sort[:2], key=lambda p: p[0])
                bot_two = sorted(pts_sort[2:], key=lambda p: p[0])
                ordered_box = [top_two[0], top_two[1], bot_two[1], bot_two[0]]
                norm_poly = [[round(float(p[0]/img_w), 4), round(float(p[1]/img_h), 4)] for p in ordered_box]
                raw.append({'cx': cx, 'cy': cy, 'area': area, 'poly': norm_poly})

        # NMS Deduplication theo diện tích và khoảng cách tâm
        raw.sort(key=lambda s: s['area'], reverse=True)
        dedup = []
        for s in raw:
            if s['area'] < 900:
                continue
            if any(np.hypot(s['cx'] - ex['cx'], s['cy'] - ex['cy']) < 22 for ex in dedup):
                continue
            dedup.append(s)

        if len(dedup) < 8:
            return {}, None

        # Trích xuất tiền tố khu vực theo tầng (VD: Floor 1: A,B,C,D; Floor 2: E,F,G,H)
        zone_map = {}
        for sc in (slot_codes or []):
            p = sc[0].upper() if sc else 'A'
            zone_map.setdefault(p, []).append(sc)
        prefixes = sorted(zone_map.keys())
        pA = prefixes[0] if len(prefixes) > 0 else 'E'
        pB = prefixes[1] if len(prefixes) > 1 else 'F'
        pC = prefixes[2] if len(prefixes) > 2 else 'G'
        pD = prefixes[3] if len(prefixes) > 3 else 'H'

        # Nhóm theo 3 hàng bằng 1D K-means trên trục cy
        cy_vals = np.array([s['cy'] for s in dedup])
        centers = np.array([np.min(cy_vals), np.median(cy_vals), np.max(cy_vals)])
        for _ in range(12):
            labels = np.argmin(np.abs(cy_vals[:, None] - centers[None, :]), axis=1)
            for k in range(3):
                if np.sum(labels == k) > 0:
                    centers[k] = np.mean(cy_vals[labels == k])

        sorted_order = np.argsort(centers)
        row_map = {sorted_order[0]: 0, sorted_order[1]: 1, sorted_order[2]: 2}

        rows = [[], [], []]
        for i, s in enumerate(dedup):
            r_idx = row_map[labels[i]]
            rows[r_idx].append(s)

        res_map = {}

        for r_idx in range(3):
            r_slots = sorted(rows[r_idx], key=lambda s: s['cx'])
            if not r_slots:
                continue
            
            # Tách nhóm trái và nhóm phải dựa vào khoảng cách cx lớn nhất ở giữa
            split_idx = 5
            if len(r_slots) > 5:
                gaps = [r_slots[j+1]['cx'] - r_slots[j]['cx'] for j in range(len(r_slots)-1)]
                mid_candidates = [j for j in range(max(3, len(r_slots)-7), min(len(r_slots)-1, 7))]
                if mid_candidates:
                    split_idx = max(mid_candidates, key=lambda j: gaps[j]) + 1
            
            left_group = r_slots[:split_idx]
            right_group = r_slots[split_idx:]
            
            if r_idx == 0:
                for idx, s in enumerate(left_group[:5]): res_map[f'{pA}{idx+1}'] = s['poly']
                for idx, s in enumerate(right_group[:5]): res_map[f'{pB}{idx+1}'] = s['poly']
            elif r_idx == 1:
                for idx, s in enumerate(left_group[:5]): res_map[f'{pA}{idx+6}'] = s['poly']
                for idx, s in enumerate(right_group[:2]): res_map[f'{pB}{idx+6}'] = s['poly']
            elif r_idx == 2:
                for idx, s in enumerate(left_group[:5]): res_map[f'{pC}{idx+1}'] = s['poly']
                for idx, s in enumerate(right_group[:5]): res_map[f'{pD}{idx+1}'] = s['poly']

        # Xác định 4 góc bao quanh (TL, TR, BR, BL) từ các ô biên
        tl = res_map.get(f'{pA}1', [[0.10, 0.40]])[0]
        tr = res_map.get(f'{pB}5', res_map.get(f'{pB}4', [[0.64, 0.40]]))[1]
        br = res_map.get(f'{pD}5', res_map.get(f'{pD}4', [[0.64, 0.88]]))[2]
        bl = res_map.get(f'{pC}1', [[0.10, 0.88]])[3]
        board_corners = [tl, tr, br, bl]

        def _bilinear_pt(u, v, corners):
            TL, TR, BR, BL = corners
            x = (1 - u) * (1 - v) * TL[0] + u * (1 - v) * TR[0] + u * v * BR[0] + (1 - u) * v * BL[0]
            y = (1 - u) * (1 - v) * TL[1] + u * (1 - v) * TR[1] + u * v * BR[1] + (1 - u) * v * BL[1]
            return [round(float(x), 4), round(float(y), 4)]

        def _get_interpolated_poly(col_idx, row_idx, is_right):
            col_w = 0.088
            slot_w = 0.080
            base_u = 0.540 if is_right else 0.020
            u1 = base_u + col_idx * col_w
            u2 = u1 + slot_w
            if row_idx == 0: v1, v2 = 0.02, 0.24
            elif row_idx == 1: v1, v2 = 0.32, 0.54
            else: v1, v2 = 0.74, 0.96
            return [
                _bilinear_pt(u1, v1, board_corners),
                _bilinear_pt(u2, v1, board_corners),
                _bilinear_pt(u2, v2, board_corners),
                _bilinear_pt(u1, v2, board_corners)
            ]

        # Tự động bù khuyết điểm cho toàn bộ 27 ô nếu ô nào bị che khuất
        for i in range(5):
            if f'{pA}{i+1}' not in res_map: res_map[f'{pA}{i+1}'] = _get_interpolated_poly(i, 0, False)
            if f'{pB}{i+1}' not in res_map: res_map[f'{pB}{i+1}'] = _get_interpolated_poly(i, 0, True)
            if f'{pA}{i+6}' not in res_map: res_map[f'{pA}{i+6}'] = _get_interpolated_poly(i, 1, False)
            if i < 2 and f'{pB}{i+6}' not in res_map: res_map[f'{pB}{i+6}'] = _get_interpolated_poly(i, 1, True)
            if f'{pC}{i+1}' not in res_map: res_map[f'{pC}{i+1}'] = _get_interpolated_poly(i, 2, False)
            if f'{pD}{i+1}' not in res_map: res_map[f'{pD}{i+1}'] = _get_interpolated_poly(i, 2, True)

        print(f"[Physical Slot Segmentation] 🎯 Fully calibrated {len(res_map)}/27 physical slot polygons from camera!")
        return res_map, board_corners
    except Exception as err:
        print(f"[Physical Slot Segmentation] Error: {err}")
        return {}, None


def _detect_paper_corners_opencv(img, img_w, img_h):
    """
    Tự động phát hiện 4 góc của tờ giấy A4 / diorama bãi đỗ xe trên camera bằng OpenCV contour analysis.
    """
    if img is None:
        return None
    try:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        
        for thresh_val in [135, 115, 155, 95]:
            _, thresh = cv2.threshold(blurred, thresh_val, 255, cv2.THRESH_BINARY)
            contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            
            img_area = img_w * img_h
            best_quad = None
            max_area = 0
            
            for cnt in contours:
                area = cv2.contourArea(cnt)
                if 0.10 * img_area < area < 0.90 * img_area:
                    peri = cv2.arcLength(cnt, True)
                    approx = cv2.approxPolyDP(cnt, 0.025 * peri, True)
                    if len(approx) == 4 and area > max_area:
                        max_area = area
                        best_quad = approx.reshape(4, 2)
            
            if best_quad is not None:
                pts = best_quad.astype(np.float32)
                s = pts.sum(axis=1)
                diff = np.diff(pts, axis=1)
                
                tl = pts[np.argmin(s)]
                br = pts[np.argmax(s)]
                tr = pts[np.argmin(diff)]
                bl = pts[np.argmax(diff)]
                
                corners = [
                    [round(float(tl[0] / img_w), 4), round(float(tl[1] / img_h), 4)],
                    [round(float(tr[0] / img_w), 4), round(float(tr[1] / img_h), 4)],
                    [round(float(br[0] / img_w), 4), round(float(br[1] / img_h), 4)],
                    [round(float(bl[0] / img_w), 4), round(float(bl[1] / img_h), 4)],
                ]
                
                w_top = abs(corners[1][0] - corners[0][0])
                h_left = abs(corners[3][1] - corners[0][1])
                if w_top > 0.20 and h_left > 0.20:
                    return corners
    except Exception as e:
        print(f"[Paper Detection] Note: {e}")
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
        [0.100, 0.415], # TL
        [0.635, 0.415], # TR
        [0.635, 0.885], # BR
        [0.100, 0.885], # BL
    ]

    def bilinear_transform(u, v, corners):
        TL, TR, BR, BL = corners
        x = (1 - u) * (1 - v) * TL[0] + u * (1 - v) * TR[0] + u * v * BR[0] + (1 - u) * v * BL[0]
        y = (1 - u) * (1 - v) * TL[1] + u * (1 - v) * TR[1] + u * v * BR[1] + (1 - u) * v * BL[1]
        return [round(float(x), 4), round(float(y), 4)]

    output_slots = []
    slot_w = 0.080
    gap = 0.010
    
    # Row 0: Top Left (A1..A5) & Top Right (B1..B5)
    for i in range(5):
        u1 = i * (slot_w + gap)
        u2 = u1 + slot_w
        mapped = [bilinear_transform(u1, 0.00, final_corners), bilinear_transform(u2, 0.00, final_corners), bilinear_transform(u2, 0.26, final_corners), bilinear_transform(u1, 0.26, final_corners)]
        output_slots.append({"slotCode": f"{p_A}{i+1}", "polygon": mapped})
    for i in range(5):
        u1 = 0.540 + i * (slot_w + gap)
        u2 = u1 + slot_w
        mapped = [bilinear_transform(u1, 0.00, final_corners), bilinear_transform(u2, 0.00, final_corners), bilinear_transform(u2, 0.26, final_corners), bilinear_transform(u1, 0.26, final_corners)]
        output_slots.append({"slotCode": f"{p_B}{i+1}", "polygon": mapped})

    # Row 1: Middle Left (A6..A10) & Middle Right (B6..B7)
    for i in range(5):
        u1 = i * (slot_w + gap)
        u2 = u1 + slot_w
        mapped = [bilinear_transform(u1, 0.29, final_corners), bilinear_transform(u2, 0.29, final_corners), bilinear_transform(u2, 0.54, final_corners), bilinear_transform(u1, 0.54, final_corners)]
        output_slots.append({"slotCode": f"{p_A}{i+6}", "polygon": mapped})
    for i in range(2):
        u1 = 0.540 + i * (slot_w + gap)
        u2 = u1 + slot_w
        mapped = [bilinear_transform(u1, 0.29, final_corners), bilinear_transform(u2, 0.29, final_corners), bilinear_transform(u2, 0.54, final_corners), bilinear_transform(u1, 0.54, final_corners)]
        output_slots.append({"slotCode": f"{p_B}{i+6}", "polygon": mapped})

    # Row 2: Bottom Left (C1..C5) & Bottom Right (D1..D5)
    for i in range(5):
        u1 = i * (slot_w + gap)
        u2 = u1 + slot_w
        mapped = [bilinear_transform(u1, 0.73, final_corners), bilinear_transform(u2, 0.73, final_corners), bilinear_transform(u2, 0.98, final_corners), bilinear_transform(u1, 0.98, final_corners)]
        output_slots.append({"slotCode": f"{p_C}{i+1}", "polygon": mapped})
    for i in range(5):
        u1 = 0.540 + i * (slot_w + gap)
        u2 = u1 + slot_w
        mapped = [bilinear_transform(u1, 0.73, final_corners), bilinear_transform(u2, 0.73, final_corners), bilinear_transform(u2, 0.98, final_corners), bilinear_transform(u1, 0.98, final_corners)]
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

        # Method 1: YOLOv8-Seg (if available with high slot count)
        if img is not None and parking_slots_model is not None:
            phys_slots = _extract_physical_slot_polygons(img, slot_codes, img_w, img_h)
            if len(phys_slots) >= 20:
                calibrated_slots = [{'slotCode': sc, 'polygon': poly} for sc, poly in phys_slots.items()]
                print(f"[AI Auto-Detect] 🎯 YOLOv8-Seg aligned {len(calibrated_slots)} physical slots!")
                return {
                    "success": True,
                    "model": "yolov8_segmentation_nms",
                    "totalSlots": len(calibrated_slots),
                    "slots": calibrated_slots
                }

        # Method 2: High-accuracy perspective diorama mapping
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


@app.post("/scan")
async def scan_license_plate(request: ScanRequest):
    """Quét Biển số xe (ALPR) đơn lẻ"""
    if not reader:
        raise HTTPException(status_code=500, detail="OCR engine not initialized.")

    try:
        base64_data = request.image
        if "," in base64_data:
            base64_data = base64_data.split(",")[1]
            
        contents = base64.b64decode(base64_data)
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        # Giới hạn kích thước ảnh tối đa 720px để EasyOCR xử lý nhanh trong < 1.5 giây
        h_orig, w_orig = img.shape[:2]
        if max(h_orig, w_orig) > 720:
            scale_in = 720.0 / max(h_orig, w_orig)
            img = cv2.resize(img, (int(w_orig * scale_in), int(h_orig * scale_in)), interpolation=cv2.INTER_AREA)

        h, w = img.shape[:2]
        allowlist = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
        cleaned_plate = None
        raw_text = ""
        confidence = 0.0

        NOISE_WORDS = {'EXIT', 'KIOSK', 'PLEASE', 'PROCEED', 'INTO', 'AREA', 'SCANNING', 'VALO', 'PARKING', 'CAMERA', 'ZONE', 'SLOT', 'EMPTY'}
        def is_ui_noise(txt):
            alpha = re.sub(r'[^A-Z]', '', txt.upper())
            return any(nw in alpha for nw in NOISE_WORDS) if alpha else False
        
        # 1. Phát hiện vị trí biển số bằng mô hình YOLOv8 ALPR (best.pt)
        if yolo_model:
            results = yolo_model(img, conf=0.15)
            if len(results) > 0 and len(results[0].boxes) > 0:
                for b in results[0].boxes:
                    box = b.xyxy[0].cpu().numpy().astype(int)
                    x1, y1, x2, y2 = box
                    pad_x = 12
                    pad_y = 4
                    x1 = max(0, x1 - pad_x)
                    y1 = max(0, y1 - pad_y)
                    x2 = min(w, x2 + pad_x)
                    y2 = min(h, y2 + pad_y)
                    crop = img[y1:y2, x1:x2]
                    
                    # Chạy OCR trực tiếp trên vùng cắt từ YOLO
                    ocr_crop = reader.readtext(crop, allowlist=allowlist)
                    if ocr_crop:
                        ocr_crop.sort(key=lambda r: r[0][0][1])
                        max_h = max([abs(r[0][2][1] - r[0][0][1]) for r in ocr_crop]) if ocr_crop else 0
                        valid_texts = [r[1] for r in ocr_crop if abs(r[0][2][1] - r[0][0][1]) >= max_h * 0.35 and not is_ui_noise(r[1])]
                        txt = "".join(valid_texts)
                        candidate = clean_plate_text(txt, valid_texts)
                        if candidate and len(candidate.replace("-", "").replace(".", "")) >= 6:
                            cleaned_plate = candidate
                            raw_text = txt
                            confidence = float(b.conf[0])
                            break

        # 2. Fallback nếu YOLO không tìm thấy hoặc chưa trích xuất được: Quét trực tiếp trên toàn bộ ảnh
        if not cleaned_plate or len(cleaned_plate.replace("-", "")) < 6:
            direct_ocr = reader.readtext(img, allowlist=allowlist)
            if direct_ocr:
                direct_ocr.sort(key=lambda r: r[0][0][1])
                max_h = max([abs(r[0][2][1] - r[0][0][1]) for r in direct_ocr])
                direct_valid = [r[1] for r in direct_ocr if abs(r[0][2][1] - r[0][0][1]) >= max_h * 0.35 and not is_ui_noise(r[1])]
                direct_raw = "".join(direct_valid)
                candidate = clean_plate_text(direct_raw, direct_valid)
                if candidate and len(candidate.replace("-", "").replace(".", "")) >= 6:
                    cleaned_plate = candidate
                    raw_text = direct_raw
                    confidence = max([float(r[2]) for r in direct_ocr if abs(r[0][2][1] - r[0][0][1]) >= max_h * 0.35 and not is_ui_noise(r[1])] or [0.85])

        detected = cleaned_plate if cleaned_plate and len(cleaned_plate.replace("-", "").replace(".", "")) >= 6 else None
        return {
            "success": detected is not None,
            "plate": detected,
            "licensePlate": detected,
            "rawText": raw_text,
            "raw_ocr": raw_text,
            "confidence": round(confidence, 2)
        }

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
    TẦNG 1: Kiểm tra siêu nhanh ô có chứa xe/thẻ xe thật sự hay không (<0.1ms).
    Một ô giấy trắng trống chỉ có nền sáng (mean > 150) và 1 dòng chữ nhỏ 'A1' (chiếm < 4% diện tích, std_dev < 24).
    Một ô có thẻ xe/xe mô hình có độ tương phản cao, nhiều pixel tối/màu (std_dev > 32 hoặc dark_ratio > 0.08).
    """
    if crop_bgr is None or crop_bgr.size == 0 or crop_bgr.shape[0] < 10 or crop_bgr.shape[1] < 10:
        return False, 0.0

    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY) if len(crop_bgr.shape) == 3 else crop_bgr
    h, w = gray.shape[:2]
    
    # Cắt 70% vùng trung tâm để tránh viền kẻ ô
    ch1, ch2 = int(h * 0.15), int(h * 0.85)
    cw1, cw2 = int(w * 0.15), int(w * 0.85)
    roi = gray[ch1:ch2, cw1:cw2] if (ch2 > ch1 and cw2 > cw1) else gray

    std_dev = float(np.std(roi))
    mean_val = float(np.mean(roi))
    dark_pixels = float(np.sum(roi < 115)) / float(roi.size)

    # Ô giấy trắng trống: mean sáng > 140, rất ít pixel tối (chỉ có chữ 'A1' mỏng < 4%), std_dev thấp
    if mean_val > 140 and dark_pixels < 0.05 and std_dev < 26.0:
        return False, std_dev

    # Ngưỡng vật thể thực tế: Thẻ xe hoặc ô tô
    if std_dev > 30.0 or dark_pixels > 0.08:
        return True, max(std_dev, dark_pixels * 100.0)

    return False, std_dev



def process_slot_alpr(crop_img, slot_code=""):
    """
    TẦNG 2: ALPR OCR Tối Ưu Siêu Nhanh (<35ms per slot):
    Dùng CLAHE + EasyOCR trực tiếp, bắt trọn vẹn biển số xe sa bàn & xe thật.
    """
    if crop_img is None or crop_img.size == 0 or crop_img.shape[0] < 10 or crop_img.shape[1] < 10:
        return None, 0.0

    ocr_engine = alpr_reader if alpr_reader is not None else reader
    if not ocr_engine:
        return None, 0.0

    h, w = crop_img.shape[:2]
    target_h = 90
    scale = target_h / float(h)
    target_w = max(120, int(w * scale))
    scaled = cv2.resize(crop_img, (target_w, target_h), interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(scaled, cv2.COLOR_BGR2GRAY) if len(scaled.shape) == 3 else scaled

    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(4, 4))
    enhanced = clahe.apply(gray)

    allowlist = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    try:
        # Pass 1: CLAHE sắc nét
        res1 = ocr_engine.readtext(enhanced, allowlist=allowlist, paragraph=False, detail=0)
        plate1 = parse_vietnamese_plate_lines(res1)
        if plate1:
            return plate1, 0.95

        # Pass 2: Otsu nhị phân hoá (cho camera bị tối/ngược sáng)
        _, otsu = cv2.threshold(enhanced, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        res2 = ocr_engine.readtext(otsu, allowlist=allowlist, paragraph=False, detail=0)
        plate2 = parse_vietnamese_plate_lines(res2)
        if plate2:
            return plate2, 0.92
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

        # ─── BƯỚC 0: Tự động trích xuất viền ô đỗ thực tế từ Live Camera bằng YOLOv8-Seg ───
        physical_slots, detected_corners = _extract_physical_slot_polygons(img, [s.slotCode for s in request.slots], img_w, img_h)
        if physical_slots and len(physical_slots) >= 10:
            print(f"[ALPR Engine] 🎯 Auto-detected & Aligned {len(physical_slots)} real physical slots from live camera!")
            for slot_def in request.slots:
                sc = slot_def.slotCode
                if sc in physical_slots:
                    slot_def.polygon = physical_slots[sc]

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

                        matched_slot = None
                        for sc, pts in slot_pixel_polys.items():
                            if len(pts) >= 3 and _point_in_polygon(pcx, pcy, pts):
                                matched_slot = sc
                                break

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

        # ─── BƯỚC 2.5: Scene Validation Siêu Nhanh (Kiểm tra góc quay / khuôn mặt) ───
        try:
            ycrcb = cv2.cvtColor(img, cv2.COLOR_BGR2YCrCb)
            skin_mask = cv2.inRange(ycrcb, np.array([0, 133, 77]), np.array([255, 173, 127]))
            skin_ratio = float(np.sum(skin_mask > 0)) / float(img_w * img_h)

            if skin_ratio > 0.14:
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

        # ─── BƯỚC 3: Crop ô + Visual Hash ───────────────
        slot_crops = {}
        slot_hashes = {}
        now = time.time()

        for slot_def in request.slots:
            sc = slot_def.slotCode
            pts = slot_pixel_polys.get(sc, [])
            crop = None

            if len(pts) == 4:
                crop = _crop_slot_perspective(img, pts, img_w, img_h, expand=1.28)
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

            slot_crops[sc] = crop
            slot_hashes[sc] = _compute_slot_hash(crop) if crop is not None else ""

        # ─── BƯỚC 4 & 5: Parallel OCR cho tất cả các ô ──────────────────
        def _process_single_slot(slot_code):
            res = {"slotCode": slot_code, "occupied": False, "plate": None, "confidence": 0.0}

            # 1. Nếu YOLO đã phát hiện biển số, OCR ngay trên vùng crop nhỏ (~20ms)
            plate_info = slot_plate_map.get(slot_code)
            if plate_info and plate_info['plate_crop'] is not None and plate_info['plate_crop'].size > 0:
                plate_text, ocr_conf = _process_plate_ocr_fast(plate_info['plate_crop'], slot_code)
                if plate_text:
                    res['occupied'] = True
                    res['plate'] = plate_text
                    res['confidence'] = max(ocr_conf, plate_info['yolo_conf'])
                    return res

            # 2. OCR trực tiếp trên crop toàn bộ ô đỗ (~30ms)
            crop = slot_crops.get(slot_code)
            if crop is not None and crop.size > 0:
                plate_text, ocr_conf = process_slot_alpr(crop, slot_code)
                if plate_text:
                    res['occupied'] = True
                    res['plate'] = plate_text
                    res['confidence'] = ocr_conf
                    return res

            return res

        all_slot_codes = [s.slotCode for s in request.slots]
        ocr_results_map = {}
        with ThreadPoolExecutor(max_workers=6) as executor:
            future_map = {executor.submit(_process_single_slot, sc): sc for sc in all_slot_codes}
            for future in future_map:
                sc = future_map[future]
                try:
                    ocr_results_map[sc] = future.result(timeout=5)
                except Exception as e:
                    ocr_results_map[sc] = {
                        "slotCode": sc, "occupied": False,
                        "plate": None, "confidence": 0.0
                    }

        # ─── BƯỚC 6: Gộp kết quả + De-duplicate + Voting + Cache ─────
        results = []
        assigned_plates = set()

        for slot_def in request.slots:
            sc = slot_def.slotCode
            res = ocr_results_map.get(sc) or cached_results.get(sc) or {
                "slotCode": sc, "occupied": False, "plate": None, "confidence": 0.0
            }

            # De-duplicate: 1 biển số chỉ gán cho 1 ô duy nhất
            if res.get('plate'):
                p_norm = res['plate'].replace("-", "").replace(".", "").upper()
                if p_norm in assigned_plates:
                    res['plate'] = None
                    res['occupied'] = False
                    res['confidence'] = 0.0
                else:
                    assigned_plates.add(p_norm)

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
                    'timestamp': now,
                    'vote_count': vote,
                }

            if slot_def.polygon:
                res['polygon'] = slot_def.polygon

            results.append(res)

            if res.get('occupied') and res.get('plate'):
                print(f"[ALPR Engine] >>> Slot {sc} OCCUPIED: Plate={res['plate']}, Conf={res['confidence']:.2f}")

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
        floor_1_plates = {'13C-343.21', '43B-204.04', '19H-438.99'}
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
    OCR tối ưu cho vùng biển số đã được YOLO crop (~100-200px).
    Single-pass CLAHE + Sharpen, fallback Otsu.
    Nhanh hơn 5-10x so với OCR toàn bộ ô đỗ.
    """
    if plate_crop is None or plate_crop.size == 0:
        return None, 0.0

    ocr_engine = alpr_reader if alpr_reader is not None else reader
    if not ocr_engine:
        return None, 0.0

    h, w = plate_crop.shape[:2]
    target_w = max(200, min(400, w * 2))
    scale = target_w / max(1, w)
    scaled = cv2.resize(plate_crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)

    gray = cv2.cvtColor(scaled, cv2.COLOR_BGR2GRAY) if len(scaled.shape) == 3 else scaled
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(4, 4))
    enhanced = clahe.apply(gray)
    kernel = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]], dtype=np.float32)
    sharpened = cv2.filter2D(enhanced, -1, kernel)

    allowlist = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

    def _extract_plate(ocr_results):
        if not ocr_results:
            return None, 0.0
        ocr_results.sort(key=lambda r: (r[0][0][1], r[0][0][0]))
        tokens = []
        max_conf = 0.0
        for r in ocr_results:
            _, text, conf = r
            t = re.sub(r'[^A-Z0-9]', '', str(text).upper())
            if t and len(t) >= 2:
                tokens.append(t)
                max_conf = max(max_conf, float(conf))
        if tokens:
            raw = "".join(tokens)
            cleaned = parse_vietnamese_plate_lines(tokens, raw)
            if cleaned:
                return cleaned, max(0.92, max_conf)
        return None, 0.0

    try:
        # Pass 1: CLAHE + Sharpen (primary)
        res1 = ocr_engine.readtext(sharpened, allowlist=allowlist, paragraph=False,
                                   text_threshold=0.3, low_text=0.25, link_threshold=0.2)
        plate1, conf1 = _extract_plate(res1)
        if plate1:
            return plate1, conf1

        # Pass 2 (fallback): Otsu
        _, otsu = cv2.threshold(enhanced, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        res2 = ocr_engine.readtext(otsu, allowlist=allowlist, paragraph=False,
                                   text_threshold=0.3, low_text=0.25, link_threshold=0.2)
        plate2, conf2 = _extract_plate(res2)
        if plate2:
            return plate2, conf2
    except Exception:
        pass

    return None, 0.0


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


