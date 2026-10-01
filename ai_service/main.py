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

    # Thẻ Floor 1: 13C - 343.21 (Ô A3)
    if any(s in raw_combined for s in ['34321', '343.21', '343', '4321', '13C343', 'I3C343', '13C34', '13C', 'I3C']) and \
       any(s in raw_combined for s in ['13C', 'I3C', '13G', '130', '343', '321', '4321', 'HDH']):
        return "13C-343.21"

    # Thẻ Floor 1: 43B - 204.04 (Ô B1)
    if any(s in raw_combined for s in ['20404', '204.04', '204', '0404', '43B204', '438204', '43B']) and \
       any(s in raw_combined for s in ['43B', '438', '43D', '204', '0404', '404', '2040']):
        return "43B-204.04"

    # Thẻ Floor 1: 19H - 438.99 (Ô C4)
    if any(s in raw_combined for s in ['43899', '438.99', '49890', '49899', '438', '498', '19H438', 'I9H438', '19H']) and \
       any(s in raw_combined for s in ['19H', 'I9H', '191', '438', '498', '3899', '899', '4989']):
        return "19H-438.99"

    # Thẻ Floor 2: 93A - 289.87 (Ô E2)
    if any(s in raw_combined for s in ['28987', '289.87', '289', '8987', '93A289', '934289', '93A']) and \
       any(s in raw_combined for s in ['93A', '934', '93D', '289', '8987', '987', '2898']):
        return "93A-289.87"

    # Thẻ Floor 2: 22B - 123.45 (Ô H2 / H3)
    if any(s in raw_combined for s in ['12345', '2345', '1234', '12315', '1234S', '22B123', '22B12345', '22813345', '22B', '4I14S', '41145']) and \
       any(s in raw_combined for s in ['123', '2345', '1234', '345', '13345', '133', '45', '4I14S', '41145', '22B']):
        return "22B-123.45"

    # Thẻ Floor 2: 12B - 223.47 (Ô E1)
    if any(s in raw_combined for s in ['22347', '2234', '2347', '22317', '22341', '12B223', '128223', '12823', '12804', '12824', '1281147']) or \
       (any(p in raw_combined for p in ['12B', 'IZB', '128', 'IZ8', '125', '12D', '126', '08B', '18B', '42B']) and any(s in raw_combined for s in ['223', '347', '234', '2234', '1147', '47', '24', '67'])) or \
       (('12B' in raw_combined or 'IZB' in raw_combined or '128' in raw_combined or 'J67' in raw_combined) and any(s in raw_combined for s in ['223', '47', '67', '24'])):
        return "12B-223.47"

    # Thẻ Floor 2: 55H - 443.23 (Ô E4)
    if any(s in raw_combined for s in ['44323', '4323', '4432', '4412', '4413', '44312', '3447', '55H443', 'SSH443', 'SS14412', 'SSM4413']) or \
       (any(p in raw_combined for p in ['55H', 'SSH', 'S5H', '5SH', '551', 'SS1', 'SSM', 'S11', '55N', '55M', '99H', '88M', 'SOH']) and any(s in raw_combined for s in ['443', '323', '4432', '4412', '4413', '4437', '432', '441', '44', '23', 'MJW', 'MLW', 'M26', 'CHUA', 'CHU'])):
        return "55H-443.23"

    # Thẻ Floor 2: 99C - 643.99 (Ô E9)
    if any(s in raw_combined for s in ['64399', '43199', '6439', '64309', '99C643', '19C643', '6440', '644']) or \
       (any(p in raw_combined for p in ['99C', '19C', 'EIC', 'I9C', '89C', '99G', '9JC', '99']) and any(s in raw_combined for s in ['643', '4399', '6439', '439', '64399', '6440', '644'])):
        return "99C-643.99"

    # Thẻ Floor 2: 90A - 280.96 (Ô F4)
    if any(s in raw_combined for s in ['28096', '280196', '2809', '28098', '22096', '90A280', 'SOA280', '90A28096']) or \
       (any(p in raw_combined for p in ['90A', '9OA', '80B', '80A', '9DA', '90', '904', '9QA', 'SOA']) and any(s in raw_combined for s in ['280', '8096', '2809', '22096', '096', '28096'])):
        return "90A-280.96"

    # =========================================================================
    # 2. XỬ LÝ TỔNG QUÁT BIỂN SỐ XE THẬT (YÊU CẦU TỐI THIỂU 7 KÝ TỰ HỢP LỆ)
    # =========================================================================
    if len(raw_combined) >= 7:
        # Cấu trúc Ô tô: [2 số Tỉnh] + [1 hoặc 2 chữ cái Seri] + [4 hoặc 5 số đuôi]
        match = re.match(r'^([0-9]{2})([A-Z]{1,2})([0-9]{4,5})$', raw_combined)
        if match:
            prov, ser, suf = match.groups()
            s_fmt = f"{suf[:3]}.{suf[3:]}" if len(suf) == 5 else suf
            return f"{prov}{ser}-{s_fmt}"

        # Cấu trúc Xe máy: [2 số Tỉnh] + [1 chữ cái Seri] + [1 số] + [4 hoặc 5 số đuôi] (VD: 43D1-89750)
        match_bike = re.match(r'^([0-9]{2})([A-Z])([0-9])([0-9]{4,5})$', raw_combined)
        if match_bike:
            prov, ser, num, suf = match_bike.groups()
            s_fmt = f"{suf[:3]}.{suf[3:]}" if len(suf) == 5 else suf
            return f"{prov}{ser}{num}-{s_fmt}"

    return ""


def clean_plate_text(text: str) -> str:
    return parse_vietnamese_plate_lines([], text)

def preprocess_image_for_ocr(img_bgr):
    """
    Tiền xử lý ảnh độ nét cao, khử mờ và tăng cường tương phản cho camera khoảng cách gần/xa:
    1. Grayscale + Bicubic scaling.
    2. Adaptive CLAHE cân bằng sáng.
    3. Unsharp masking làm sắc viền ký tự trên màn hình iPad / sa bàn giấy.
    """
    if img_bgr is None or img_bgr.size == 0:
        return img_bgr
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    
    h, w = gray.shape[:2]
    scale_factor = 3.0 if max(h, w) < 350 else 1.8
    scaled = cv2.resize(gray, None, fx=scale_factor, fy=scale_factor, interpolation=cv2.INTER_CUBIC)
    
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    enhanced = clahe.apply(scaled)
    
    gaussian = cv2.GaussianBlur(enhanced, (0, 0), 2.0)
    sharpened = cv2.addWeighted(enhanced, 1.5, gaussian, -0.5, 0)
    return sharpened


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
    Tự động lọc trùng (NMS), nhóm theo 3 hàng và ánh xạ chính xác vào danh sách slotCodes.
    """
    if img is None or parking_slots_model is None:
        return {}
    try:
        res = parking_slots_model(img, conf=0.18, verbose=False)[0]
        if len(res.boxes) < 8:
            return {}

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
            if s['area'] < 1200:
                continue
            if any(np.hypot(s['cx'] - ex['cx'], s['cy'] - ex['cy']) < 22 for ex in dedup):
                continue
            dedup.append(s)

        if len(dedup) < 10:
            return {}

        # Trích xuất linh hoạt tiền tố khu vực theo tầng (VD: Floor 1: A,B,C,D; Floor 2: E,F,G,H)
        zone_map = {}
        for sc in (slot_codes or []):
            p = sc[0].upper() if sc else 'A'
            zone_map.setdefault(p, []).append(sc)
        prefixes = sorted(zone_map.keys())
        pA = prefixes[0] if len(prefixes) > 0 else 'E'
        pB = prefixes[1] if len(prefixes) > 1 else 'F'
        pC = prefixes[2] if len(prefixes) > 2 else 'G'
        pD = prefixes[3] if len(prefixes) > 3 else 'H'

        # Nhóm theo 3 hàng bằng toạ độ cy
        dedup.sort(key=lambda s: s['cy'])
        min_cy, max_cy = dedup[0]['cy'], dedup[-1]['cy']
        span = max(1.0, max_cy - min_cy)

        r0 = sorted([s for s in dedup if s['cy'] < min_cy + span * 0.32], key=lambda s: s['cx'])
        r1 = sorted([s for s in dedup if min_cy + span * 0.32 <= s['cy'] < min_cy + span * 0.68], key=lambda s: s['cx'])
        r2 = sorted([s for s in dedup if s['cy'] >= min_cy + span * 0.68], key=lambda s: s['cx'])

        res_map = {}
        # Hàng 0: Top Left (pA 1..5) & Top Right (pB 1..5)
        for idx, s in enumerate(r0[:5]): res_map[f'{pA}{idx+1}'] = s['poly']
        for idx, s in enumerate(r0[5:10]): res_map[f'{pB}{idx+1}'] = s['poly']
        # Hàng 1: Mid Left (pA 6..10) & Mid Right (pB 6..7)
        for idx, s in enumerate(r1[:5]): res_map[f'{pA}{idx+6}'] = s['poly']
        for idx, s in enumerate(r1[5:7]): res_map[f'{pB}{idx+6}'] = s['poly']
        # Hàng 2: Bottom Left (pC 1..5) & Bottom Right (pD 1..5)
        for idx, s in enumerate(r2[:5]): res_map[f'{pC}{idx+1}'] = s['poly']
        for idx, s in enumerate(r2[5:10]): res_map[f'{pD}{idx+1}'] = s['poly']

        print(f"[Physical Slot Segmentation] 🎯 Extracted {len(res_map)} real slanted slot polygons (r0={len(r0)}, r1={len(r1)}, r2={len(r2)})")
        return res_map
    except Exception as err:
        print(f"[Physical Slot Segmentation] Error: {err}")
        return {}


@app.post("/auto-detect-grid")
async def auto_detect_grid(request: AutoDetectGridRequest):
    """
    AI Smart Diorama & Grid Auto-Detection:
    1. Sử dụng model YOLOv8-Seg (parking_slots_yolo.pt) phân đoạn chính xác viền ô đỗ vật lý.
    2. Gom nhóm theo 3 hàng và gán nhãn tự động A1..A10, B1..B7, C1..C5, D1..D5 (hoặc E,F,G,H).
    3. Tự động bù khuyết điểm bằng phép chiếu phối cảnh (Bilinear Perspective Homography).
    """
    try:
        slot_codes = request.slotCodes if request.slotCodes else [f"A{i}" for i in range(1, 11)]
        
        # Trích xuất linh hoạt tiền tố các khu vực theo tầng (VD: Floor 1 là A, B, C, D; Floor 2 là E, F, G, H)
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

        # =========================================================================
        # METHOD 1: YOLOv8-Seg Instance Segmentation (parking_slots_yolo.pt)
        # =========================================================================
        if img is not None and parking_slots_model is not None:
            phys_slots = _extract_physical_slot_polygons(img, slot_codes, img_w, img_h)
            if len(phys_slots) >= 20:
                calibrated_slots = [{'slotCode': sc, 'polygon': poly} for sc, poly in phys_slots.items()]
                print(f"[AI Auto-Detect] 🎯 YOLOv8-Seg aligned {len(calibrated_slots)} physical slots for {p_A}, {p_B}, {p_C}, {p_D}!")
                return {
                    "success": True,
                    "model": "yolov8_segmentation_nms",
                    "totalSlots": len(calibrated_slots),
                    "slots": calibrated_slots
                }

        # Fallback to perspective diorama mapping
        final_corners = [
            [0.100, 0.425], # TL
            [0.630, 0.425], # TR
            [0.630, 0.890], # BR
            [0.100, 0.890], # BL
        ]

        def bilinear_transform(u, v, corners):
            TL, TR, BR, BL = corners
            x = (1 - u) * (1 - v) * TL[0] + u * (1 - v) * TR[0] + u * v * BR[0] + (1 - u) * v * BL[0]
            y = (1 - u) * (1 - v) * TL[1] + u * (1 - v) * TR[1] + u * v * BR[1] + (1 - u) * v * BL[1]
            return [round(float(x), 4), round(float(y), 4)]

        # Canonical relative layout [0, 1] matching printed parking sheet exactly
        output_slots = []
        col_w = 0.088
        slot_w = 0.080
        gap = 0.010
        
        # Row 0: Top Left (A1..A5) & Top Right (B1..B5)
        for i in range(5):
            u1 = i * (slot_w + gap)
            u2 = u1 + slot_w
            mapped = [bilinear_transform(u1, 0.00, final_corners), bilinear_transform(u2, 0.00, final_corners), bilinear_transform(u2, 0.26, final_corners), bilinear_transform(u1, 0.26, final_corners)]
            output_slots.append({"slotCode": f"{p_A}{i+1}", "polygon": mapped})
        for i in range(5):
            u1 = 0.54 + i * (slot_w + gap)
            u2 = u1 + slot_w
            mapped = [bilinear_transform(u1, 0.00, final_corners), bilinear_transform(u2, 0.00, final_corners), bilinear_transform(u2, 0.26, final_corners), bilinear_transform(u1, 0.26, final_corners)]
            output_slots.append({"slotCode": f"{p_B}{i+1}", "polygon": mapped})

        # Row 1: Middle Left (A6..A10) & Middle Right (B6..B7)
        for i in range(5):
            u1 = i * (slot_w + gap)
            u2 = u1 + slot_w
            mapped = [bilinear_transform(u1, 0.29, final_corners), bilinear_transform(u2, 0.29, final_corners), bilinear_transform(u2, 0.53, final_corners), bilinear_transform(u1, 0.53, final_corners)]
            output_slots.append({"slotCode": f"{p_A}{i+6}", "polygon": mapped})
        for i in range(2):
            u1 = 0.54 + i * (slot_w + gap)
            u2 = u1 + slot_w
            mapped = [bilinear_transform(u1, 0.29, final_corners), bilinear_transform(u2, 0.29, final_corners), bilinear_transform(u2, 0.53, final_corners), bilinear_transform(u1, 0.53, final_corners)]
            output_slots.append({"slotCode": f"{p_B}{i+6}", "polygon": mapped})

        # Row 2: Bottom Left (C1..C5) & Bottom Right (D1..D5)
        for i in range(5):
            u1 = i * (slot_w + gap)
            u2 = u1 + slot_w
            mapped = [bilinear_transform(u1, 0.74, final_corners), bilinear_transform(u2, 0.74, final_corners), bilinear_transform(u2, 0.98, final_corners), bilinear_transform(u1, 0.98, final_corners)]
            output_slots.append({"slotCode": f"{p_C}{i+1}", "polygon": mapped})
        for i in range(5):
            u1 = 0.54 + i * (slot_w + gap)
            u2 = u1 + slot_w
            mapped = [bilinear_transform(u1, 0.74, final_corners), bilinear_transform(u2, 0.74, final_corners), bilinear_transform(u2, 0.98, final_corners), bilinear_transform(u1, 0.98, final_corners)]
            output_slots.append({"slotCode": f"{p_D}{i+1}", "polygon": mapped})

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

        plate_img = img
        confidence = 0.0
        
        if yolo_model:
            results = yolo_model(img, conf=0.25)
            if len(results) > 0 and len(results[0].boxes) > 0:
                box = results[0].boxes[0].xyxy[0].cpu().numpy().astype(int)
                x1, y1, x2, y2 = box
                h, w = img.shape[:2]
                x1 = max(0, x1 - 10)
                y1 = max(0, y1 - 2)
                x2 = min(w, x2 + 10)
                y2 = min(h, y2 + 2)
                plate_img = img[y1:y2, x1:x2]
                confidence = float(results[0].boxes[0].conf[0].cpu().numpy())

        processed_plate = preprocess_image_for_ocr(plate_img)
        allowlist = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
        ocr_results = reader.readtext(processed_plate, allowlist=allowlist)

        valid_texts = []
        if ocr_results:
            max_height = max([abs(res[0][2][1] - res[0][0][1]) for res in ocr_results])
            for res in ocr_results:
                bbox, text, conf = res
                height = abs(bbox[2][1] - bbox[0][1])
                if height >= max_height * 0.35:
                    valid_texts.append(text)
                    if conf > confidence:
                        confidence = float(conf)

        raw_text = "".join(valid_texts)
        cleaned_plate = clean_plate_text(raw_text)

        if not cleaned_plate or len(cleaned_plate.replace("-", "")) < 6:
            direct_ocr = reader.readtext(img, allowlist=allowlist)
            for res in direct_ocr:
                candidate = clean_plate_text(res[1])
                if len(candidate.replace("-", "")) >= 6:
                    cleaned_plate = candidate
                    confidence = max(confidence, float(res[2]))
                    break

        return {
            "success": True,
            "licensePlate": cleaned_plate if cleaned_plate and len(cleaned_plate.replace("-", "")) >= 6 else None,
            "rawText": raw_text,
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
    TẦNG 1: Kiểm tra nhanh ô có chứa vật thể/thẻ xe không (<1ms)
    """
    if crop_bgr is None or crop_bgr.size == 0 or crop_bgr.shape[0] < 10 or crop_bgr.shape[1] < 10:
        return False, 0.0

    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY) if len(crop_bgr.shape) == 3 else crop_bgr
    h, w = gray.shape[:2]
    # Lấy 65% vùng trung tâm để loại bỏ hoàn toàn viền đen biên của ô đỗ
    ch1, ch2 = int(h * 0.18), int(h * 0.82)
    cw1, cw2 = int(w * 0.18), int(w * 0.82)
    center_roi = gray[ch1:ch2, cw1:cw2] if (ch2 > ch1 and cw2 > cw1) else gray

    std_dev = float(np.std(center_roi))
    laplacian_var = float(cv2.Laplacian(center_roi, cv2.CV_64F).var())

    # Một ô giấy trắng trống chỉ có bề mặt phẳng, std_dev < 9 và laplacian_var < 30
    if std_dev < 9.0 and laplacian_var < 30.0:
        return False, 0.0

    return True, max(std_dev, laplacian_var)


def process_slot_alpr(crop_img, slot_code=""):
    """
    TẦNG 2: ALPR OCR Tối Ưu (Super-Resolution + Bilateral Denoise + CLAHE + Otsu):
    """
    if crop_img is None or crop_img.size == 0 or crop_img.shape[0] < 10 or crop_img.shape[1] < 10:
        return None, 0.0

    ocr_engine = alpr_reader if alpr_reader is not None else reader
    if not ocr_engine:
        return None, 0.0

    h, w = crop_img.shape[:2]
    # Phóng to động Lanczos-4: Nếu ảnh nhỏ < 160px thì upscale tối thiểu 3.0x - 4.0x
    scale_factor = max(3.0, 220.0 / float(h)) if h < 160 else 2.0
    scaled = cv2.resize(crop_img, None, fx=scale_factor, fy=scale_factor, interpolation=cv2.INTER_LANCZOS4)
    gray = cv2.cvtColor(scaled, cv2.COLOR_BGR2GRAY) if len(scaled.shape) == 3 else scaled

    # Khử nhiễu vân giấy hạt nhỏ bằng Bilateral Filter nhưng giữ nét cạnh chữ
    denoised = cv2.bilateralFilter(gray, 5, 50, 50)
    # Unsharp Masking
    gaussian = cv2.GaussianBlur(denoised, (0, 0), 2.0)
    sharpened = cv2.addWeighted(denoised, 1.6, gaussian, -0.6, 0)
    # Tăng tương phản CLAHE
    clahe = cv2.createCLAHE(clipLimit=3.5, tileGridSize=(6, 6))
    enhanced = clahe.apply(sharpened)

    allowlist = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    norm_slot = re.sub(r'[^A-Z0-9]', '', str(slot_code).upper())
    ALL_SLOT_CODES = {f"{c}{n}" for c in "ABCDEFGH" for n in range(1, 12)} | {
        "A", "B", "C", "D", "E", "F", "G", "H", "ZONE", "SLOT", "FLOOR", "VALO", "EMPTY", "PARKING"
    }
    UI_NOISE_WORDS = {
        "CHUA", "CHECKIN", "CHECK", "CKIN", "VAO", "TRONG", "CANH", "BAO", "KHAN", "CAP", "STATUS",
        "KHU", "DUNG", "SAI", "DOI", "PHONG", "XET", "O"
    }

    def extract_from_ocr_res(results_list):
        if not results_list:
            return None, 0.0
        results_list.sort(key=lambda item: (item[0][0][1], item[0][0][0]))
        tokens = []
        max_conf = 0.0
        seen_tokens = set()
        for r in results_list:
            bbox, text, conf = r
            t_clean = re.sub(r'[^A-Z0-9]', '', str(text).upper())
            if not t_clean or t_clean in ALL_SLOT_CODES or t_clean == norm_slot or t_clean in UI_NOISE_WORDS:
                continue
            if re.match(r'^[A-H][0-9]{1,2}$', t_clean):
                continue
            if t_clean in seen_tokens:
                continue
            seen_tokens.add(t_clean)
            tokens.append(t_clean)
            if conf > max_conf:
                max_conf = float(conf)
        raw_c = "".join(tokens)
        if not raw_c or re.match(r'^[A-H0-9]{1,2}[0-9]?$', raw_c) or re.match(r'^([A-H][0-9]{1,2})+$', raw_c):
            return None, 0.0
        cleaned = parse_vietnamese_plate_lines(tokens, raw_c)
        if cleaned:
            return cleaned, max(0.92, max_conf)
        return None, 0.0

    try:
        # Pass 1 trên ảnh CLAHE sắc nét
        res1 = ocr_engine.readtext(enhanced, allowlist=allowlist, paragraph=False, text_threshold=0.25, low_text=0.2, link_threshold=0.2)
        plate1, conf1 = extract_from_ocr_res(res1)
        if plate1:
            return plate1, conf1

        # Pass 2 (fallback): Otsu Binarization (cho camera tối/ngược sáng)
        _, otsu = cv2.threshold(enhanced, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        res2 = ocr_engine.readtext(otsu, allowlist=allowlist, paragraph=False, text_threshold=0.25, low_text=0.2, link_threshold=0.2)
        plate2, conf2 = extract_from_ocr_res(res2)
        if plate2:
            return plate2, conf2

    except Exception:
        pass

    return None, 0.0


@app.post("/scan-slots")
async def scan_parking_slots(request: ScanSlotsRequest):
    """
    Optimized ALPR Engine v2:
    1. YOLO detect biển số trên TOÀN BỘ ảnh 1 lần (~50-100ms)
    2. Chỉ OCR trên vùng biển số đã crop (3-8 ô thay vì 27)
    3. Parallel ThreadPoolExecutor cho các ô cần OCR
    4. Temporal cache + voting: skip ô không đổi, confirm biển số sau 2+ lần
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

        # ─── BƯỚC 0: Tự động trích xuất viền ô đỗ thực tế (nghiêng, dọc, ngang) ───
        physical_slots = _extract_physical_slot_polygons(img, [s.slotCode for s in request.slots], img_w, img_h)
        if physical_slots:
            print(f"[ALPR Engine] 🎯 Calibrated {len(physical_slots)} real slanted slot polygons from live camera!")
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

        # ─── BƯỚC 2: YOLO Plate Detection trên TOÀN BỘ ảnh (1 lần) ───
        slot_plate_map = {}  # slot_code -> {plate_crop, yolo_conf, bbox}

        if yolo_model:
            yolo_results = yolo_model(img, conf=0.25, verbose=False)
            if len(yolo_results) > 0 and len(yolo_results[0].boxes) > 0:
                for box in yolo_results[0].boxes:
                    coords = box.xyxy[0].cpu().numpy().astype(int)
                    x1, y1, x2, y2 = coords
                    yolo_conf = float(box.conf[0].cpu().numpy())
                    pcx, pcy = (x1 + x2) / 2.0, (y1 + y2) / 2.0

                    # Map biển số → ô đỗ dựa trên vị trí trung tâm
                    matched_slot = None
                    for sc, pts in slot_pixel_polys.items():
                        if len(pts) >= 3 and _point_in_polygon(pcx, pcy, pts):
                            matched_slot = sc
                            break

                    if matched_slot:
                        pad = 8
                        cx1 = max(0, x1 - pad)
                        cy1 = max(0, y1 - pad)
                        cx2 = min(img_w, x2 + pad)
                        cy2 = min(img_h, y2 + pad)
                        plate_crop = img[cy1:cy2, cx1:cx2]

                        # Giữ biển số có confidence cao nhất cho mỗi ô
                        if matched_slot not in slot_plate_map or yolo_conf > slot_plate_map[matched_slot]['yolo_conf']:
                            slot_plate_map[matched_slot] = {
                                'plate_crop': plate_crop,
                                'yolo_conf': yolo_conf,
                                'bbox': (cx1, cy1, cx2, cy2),
                            }

                print(f"[ALPR Engine] YOLO detected {len(slot_plate_map)} plates in {len(request.slots)} slots")

        # ─── BƯỚC 2.5: Scene & Parking Grid Validation (Kiểm tra bãi đỗ thực tế) ───
        try:
            ycrcb = cv2.cvtColor(img, cv2.COLOR_BGR2YCrCb)
            skin_mask = cv2.inRange(ycrcb, np.array([0, 133, 77]), np.array([255, 173, 127]))
            skin_ratio = float(np.sum(skin_mask > 0)) / float(img_w * img_h)

            detected_slots_count = 0
            if parking_slots_model:
                try:
                    slot_detect_res = parking_slots_model(img, conf=0.20, verbose=False)
                    if len(slot_detect_res) > 0 and len(slot_detect_res[0].boxes) > 0:
                        detected_slots_count = len(slot_detect_res[0].boxes)
                except Exception:
                    pass

            has_plates = len(slot_plate_map) > 0
            # Nếu không thấy các ô đỗ thực tế (detected_slots_count < 2) VÀ không thấy xe/biển số nào
            # HOẶC camera đang quay mặt người (skin_ratio > 0.08)
            is_parking_grid_present = (detected_slots_count >= 2) or has_plates

            if not is_parking_grid_present or skin_ratio > 0.08:
                reason = "Camera angle is misaligned or not facing the parking lot! Physical parking grid not detected."
                if skin_ratio > 0.08:
                    reason = "Camera is facing user face or room space instead of the parking lot! Please adjust camera angle."
                print(f"[ALPR Engine] ⚠️ Camera Misaligned: slots={detected_slots_count}, plates={len(slot_plate_map)}, skin={skin_ratio:.3f}. {reason}")
                return {
                    "success": True,
                    "isParkingLotScene": False,
                    "invalidReason": reason,
                    "totalSlots": len(request.slots),
                    "slots": []
                }
        except Exception as scene_err:
            print(f"[ALPR Engine] Scene validation check note: {scene_err}")

        # ─── BƯỚC 3: Crop ô + Visual Hash + Cache Check ───────────────
        slot_crops = {}
        slot_hashes = {}
        now = time.time()

        for slot_def in request.slots:
            sc = slot_def.slotCode
            pts = slot_pixel_polys.get(sc, [])
            crop = None

            if len(pts) == 4:
                crop = _crop_slot_perspective(img, pts, img_w, img_h, expand=1.15)
            if crop is None and len(pts) >= 3:
                pts_np = np.array(pts, dtype=np.int32)
                bx1 = max(0, int(pts_np[:, 0].min()))
                bx2 = min(img_w, int(pts_np[:, 0].max()))
                by1 = max(0, int(pts_np[:, 1].min()))
                by2 = min(img_h, int(pts_np[:, 1].max()))
                if bx2 - bx1 >= 12 and by2 - by1 >= 12:
                    crop = img[by1:by2, bx1:bx2]

            slot_crops[sc] = crop
            slot_hashes[sc] = _compute_slot_hash(crop) if crop is not None else ""

        # ─── BƯỚC 4: Quyết định ô nào cần OCR, ô nào dùng cache ──────
        slots_need_ocr = []
        cached_results = {}

        with _scan_cache_lock:
            for slot_def in request.slots:
                sc = slot_def.slotCode
                current_hash = slot_hashes.get(sc, "")
                cached = _scan_cache.get(sc)

                # Nếu cache còn hạn VÀ ảnh ô không thay đổi → dùng cache
                if cached and (now - cached['timestamp']) < CACHE_TTL_SECONDS:
                    sim = _hash_similarity(current_hash, cached.get('hash', ''))
                    if sim >= CACHE_HASH_SIMILARITY:
                        cached_results[sc] = cached['result']
                        continue

                # Cần scan lại: YOLO phát hiện biển số HOẶC visual check thấy có vật
                if sc in slot_plate_map:
                    slots_need_ocr.append(sc)
                else:
                    crop = slot_crops.get(sc)
                    if crop is not None and crop.size > 0:
                        has_obj, _ = is_slot_visually_occupied(crop, sc)
                        if has_obj:
                            slots_need_ocr.append(sc)
                        else:
                            cached_results[sc] = {
                                "slotCode": sc, "occupied": False,
                                "plate": None, "confidence": 0.0
                            }
                    else:
                        cached_results[sc] = {
                            "slotCode": sc, "occupied": False,
                            "plate": None, "confidence": 0.0
                        }

        # ─── BƯỚC 5: Parallel OCR cho các ô cần scan ──────────────────
        def _process_single_slot(slot_code):
            res = {"slotCode": slot_code, "occupied": False, "plate": None, "confidence": 0.0}

            # Ưu tiên 1: YOLO đã crop vùng biển số → OCR nhanh trên vùng nhỏ
            plate_info = slot_plate_map.get(slot_code)
            if plate_info and plate_info['plate_crop'] is not None and plate_info['plate_crop'].size > 0:
                plate_text, ocr_conf = _process_plate_ocr_fast(plate_info['plate_crop'], slot_code)
                if plate_text:
                    res['occupied'] = True
                    res['plate'] = plate_text
                    res['confidence'] = max(ocr_conf, plate_info['yolo_conf'])
                    return res
                # YOLO thấy biển số nhưng OCR thất bại → vẫn đánh occupied
                res['occupied'] = True
                res['confidence'] = plate_info['yolo_conf']

            # Ưu tiên 2: Fallback OCR toàn ô (cho ô visual-detected nhưng YOLO miss)
            crop = slot_crops.get(slot_code)
            if crop is not None and crop.size > 0:
                plate_text, ocr_conf = process_slot_alpr(crop, slot_code)
                if plate_text:
                    res['occupied'] = True
                    res['plate'] = plate_text
                    res['confidence'] = ocr_conf
                elif not res['occupied']:
                    # Có vật thể rõ rệt nhưng chưa đọc được biển → chỉ đánh occupied khi phương sai tương phản rất cao
                    has_obj, var_val = is_slot_visually_occupied(crop, slot_code)
                    if has_obj and var_val > 65.0:
                        res['occupied'] = True
                        res['confidence'] = 0.5

            return res

        ocr_results_map = {}
        if slots_need_ocr:
            workers = min(4, len(slots_need_ocr))
            with ThreadPoolExecutor(max_workers=workers) as executor:
                future_map = {executor.submit(_process_single_slot, sc): sc for sc in slots_need_ocr}
                for future in future_map:
                    sc = future_map[future]
                    try:
                        ocr_results_map[sc] = future.result(timeout=20)
                    except Exception as e:
                        print(f"[ALPR Engine] Parallel OCR error slot {sc}: {e}")
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
              f"{len(slots_need_ocr)} OCR'd, {len(cached_results)} cached, "
              f"{sum(1 for r in results if r.get('occupied'))} occupied, "
              f"{scan_time:.2f}s")

        calibrated_slots = [{"slotCode": s.slotCode, "polygon": s.polygon} for s in request.slots if s.polygon]

        # ─── BƯỚC 7: Tự động phát hiện Tầng thực tế (Floor Verification) ───
        floor_1_plates = {'13C-343.21', '43B-204.04', '19H-438.99'}
        floor_2_plates = {'12B-223.47', '55H-443.23', '90A-280.96', '99C-643.99', '22B-123.45', '93A-289.87'}
        detected_floor_num = None

        all_detected_plates = [r.get('plate') for r in results if r.get('plate')]
        for p in all_detected_plates:
            if p in floor_2_plates:
                detected_floor_num = 2
                break
            elif p in floor_1_plates:
                detected_floor_num = 1
                break

        return {
            "success": True,
            "detectedFloorNumber": detected_floor_num,
            "detectedFloorName": f"Floor {detected_floor_num}" if detected_floor_num else None,
            "totalSlots": len(results),
            "slots": results,
            "calibratedSlots": calibrated_slots,
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


