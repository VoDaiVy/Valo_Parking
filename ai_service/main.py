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

# OCR Engine (English is used for license plates and names/brands)
try:
    print("Loading EasyOCR model...")
    reader = easyocr.Reader(['vi', 'en'], gpu=False) # Hỗ trợ tiếng Việt cho cà vẹt
except Exception as e:
    print(f"Warning: EasyOCR failed to load - {e}")
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
# Helper Functions
# ---------------------------------------------------------

def clean_plate_text(text: str) -> str:
    """
    Chuẩn hóa và làm sạch chuỗi OCR biển số xe Việt Nam:
    - Hỗ trợ biển số 1 hàng (VD: 51G-123.45, 29A-999.99)
    - Hỗ trợ biển số 2 hàng vuông (VD: 43B / 204.08 -> 43B-204.08)
    - Tự động sửa lỗi nhầm ký tự phổ biến (O/0, D/0, I/1, Z/2, S/5, B/8, G/6, U/3)
    """
    if not text:
        return ""
    
    cleaned = re.sub(r'[^A-Z0-9]', '', text.upper())
    if len(cleaned) < 4:
        return cleaned

    to_digits = {'O': '0', 'D': '0', 'Q': '0', 'I': '1', 'L': '1', 'T': '7', 'Z': '2', 'S': '5', 'B': '8', 'G': '6', 'U': '3'}
    to_letters = {'0': 'O', '1': 'I', '2': 'Z', '3': 'B', '4': 'A', '5': 'S', '6': 'G', '8': 'B'}

    # 1. Hai ký tự đầu là Mã tỉnh (2 chữ số: 11..99)
    p1 = to_digits.get(cleaned[0], cleaned[0])
    p2 = to_digits.get(cleaned[1], cleaned[1])
    prov = p1 + p2

    rest = cleaned[2:]
    if not rest:
        return cleaned

    # 2. Seri biển số (1 hoặc 2 chữ cái: A..Z, B, C, D, ...)
    series = ""
    idx = 0
    while idx < len(rest) and (rest[idx].isalpha() or (idx == 0 and not rest[idx].isdigit())):
        series += rest[idx]
        idx += 1

    if not series and len(rest) >= 4:
        if rest[0] in to_letters:
            series = to_letters[rest[0]]
            idx = 1
        elif rest[0].isalpha():
            series = rest[0]
            idx = 1
        else:
            series = 'A'

    # 3. Dãy số phía sau (4 hoặc 5 chữ số)
    raw_suffix = rest[idx:]
    suffix = "".join(to_digits.get(c, c) for c in raw_suffix if c.isdigit() or c in to_digits)

    if len(suffix) >= 4:
        if len(suffix) == 5:
            suffix_fmt = f"{suffix[:3]}.{suffix[3:]}"
        else:
            suffix_fmt = suffix
        return f"{prov}{series}-{suffix_fmt}" if series else f"{prov}-{suffix_fmt}"

    match = re.match(r'^([0-9]{2}[A-Z]{1,2})([0-9]{4,5})$', cleaned)
    if match:
        s = match.group(2)
        s_fmt = f"{s[:3]}.{s[3:]}" if len(s) == 5 else s
        return f"{match.group(1)}-{s_fmt}"

    return cleaned

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


@app.post("/auto-detect-grid")
async def auto_detect_grid(request: AutoDetectGridRequest):
    """
    AI Smart Diorama & Grid Auto-Detection:
    1. Sử dụng model YOLOv8-Seg (parking_slots_yolo.pt) phân đoạn chính xác viền ô đỗ vật lý.
    2. Gom nhóm theo 3 hàng và gán nhãn tự động A1..A10, B1..B7, C1..C5, D1..D5.
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

        # 4 góc mặc định chuẩn của tờ giấy sa bàn trên màn hình camera
        board_corners = [
            [0.035, 0.060], # TL
            [0.965, 0.060], # TR
            [0.965, 0.940], # BR
            [0.035, 0.940], # BL
        ]

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

        # Hàm tính điểm nội suy 4 góc
        def bilinear_pt(u, v):
            TL, TR, BR, BL = board_corners
            x = (1 - u) * (1 - v) * TL[0] + u * (1 - v) * TR[0] + u * v * BR[0] + (1 - u) * v * BL[0]
            y = (1 - u) * (1 - v) * TL[1] + u * (1 - v) * TR[1] + u * v * BR[1] + (1 - u) * v * BL[1]
            return [round(float(x), 4), round(float(y), 4)]

        def get_fallback_slot_poly(col_idx, row_idx, is_right_zone):
            base_u_start = 0.52 if is_right_zone else 0.03
            col_w = 0.090
            slot_w = col_w * 0.88
            u_center = base_u_start + col_idx * col_w + (col_w / 2.0)
            u1 = u_center - slot_w / 2.0
            u2 = u_center + slot_w / 2.0

            if row_idx == 0:
                # Row 1 trên sa bàn
                v_center = 0.21
                v_h = 0.22
            elif row_idx == 1:
                # Row 2 trên sa bàn
                v_center = 0.46
                v_h = 0.22
            else:
                # Row 3 trên sa bàn
                v_center = 0.82
                v_h = 0.24

            v1 = v_center - v_h / 2.0
            v2 = v_center + v_h / 2.0

            return [
                bilinear_pt(u1, v1),
                bilinear_pt(u2, v1),
                bilinear_pt(u2, v2),
                bilinear_pt(u1, v2),
            ]

        # -------------------------------------------------------------
        # PHƯƠNG ÁN 1: Dùng YOLOv8 Segmentation Model (Độ chính xác cao nhất)
        # -------------------------------------------------------------
        if parking_slots_model is not None and img is not None:
            try:
                yolo_res = parking_slots_model(img, conf=0.15, verbose=False)
                if len(yolo_res) > 0 and len(yolo_res[0].boxes) >= 6:
                    detected_slots = []
                    boxes = yolo_res[0].boxes
                    masks = getattr(yolo_res[0], 'masks', None)

                    for i in range(len(boxes)):
                        box = boxes[i].xyxy[0].cpu().numpy()
                        conf = float(boxes[i].conf[0].cpu().numpy())
                        
                        if masks is not None and i < len(masks.xy):
                            mask_pts = masks.xy[i].astype(np.float32)
                            if len(mask_pts) >= 4:
                                rect = cv2.minAreaRect(mask_pts)
                                box_pts = cv2.boxPoints(rect)
                            else:
                                x1, y1, x2, y2 = box
                                box_pts = np.array([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], dtype=np.float32)
                        else:
                            x1, y1, x2, y2 = box
                            box_pts = np.array([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], dtype=np.float32)

                        # Sắp xếp 4 đỉnh theo thứ tự: TL, TR, BR, BL
                        s = box_pts.sum(axis=1)
                        tl = box_pts[np.argmin(s)]
                        br = box_pts[np.argmax(s)]
                        diff = np.diff(box_pts, axis=1)
                        tr = box_pts[np.argmin(diff)]
                        bl = box_pts[np.argmax(diff)]
                        ordered = [tl, tr, br, bl]

                        norm_poly = [[round(float(p[0]) / img_w, 4), round(float(p[1]) / img_h, 4)] for p in ordered]
                        cx = float(np.mean([p[0] for p in norm_poly]))
                        cy = float(np.mean([p[1] for p in norm_poly]))

                        detected_slots.append({
                            "cx": cx,
                            "cy": cy,
                            "polygon": norm_poly,
                            "conf": conf
                        })

                    # Sắp xếp toàn bộ theo CY để gom 3 hàng chuẩn xác
                    detected_slots.sort(key=lambda s: s["cy"])
                    n_det = len(detected_slots)
                    if n_det >= 26:
                        row0 = detected_slots[0:10]
                        row1 = detected_slots[10:17]
                        row2 = detected_slots[17:27]
                    else:
                        all_cys = [s["cy"] for s in detected_slots]
                        min_cy, max_cy = min(all_cys), max(all_cys)
                        span = max_cy - min_cy
                        row0 = [p for p in detected_slots if p["cy"] < min_cy + span * 0.35]
                        row1 = [p for p in detected_slots if min_cy + span * 0.35 <= p["cy"] < min_cy + span * 0.68]
                        row2 = [p for p in detected_slots if p["cy"] >= min_cy + span * 0.68]

                    row0.sort(key=lambda p: p["cx"])
                    row1.sort(key=lambda p: p["cx"])
                    row2.sort(key=lambda p: p["cx"])

                    assigned_slots = []
                    # Row 0: Trái Zone 1 (1..5), Phải Zone 2 (1..5)
                    for idx in range(5):
                        code = f"{p_A}{idx + 1}"
                        poly = row0[idx]["polygon"] if idx < len(row0) else get_fallback_slot_poly(idx, 0, False)
                        assigned_slots.append({"slotCode": code, "polygon": poly})
                    for idx in range(5):
                        code = f"{p_B}{idx + 1}"
                        poly = row0[idx + 5]["polygon"] if (idx + 5) < len(row0) else get_fallback_slot_poly(idx, 0, True)
                        assigned_slots.append({"slotCode": code, "polygon": poly})

                    # Row 1: Trái Zone 1 (6..10), Phải Zone 2 (6..7)
                    for idx in range(5):
                        code = f"{p_A}{idx + 6}"
                        poly = row1[idx]["polygon"] if idx < len(row1) else get_fallback_slot_poly(idx, 1, False)
                        assigned_slots.append({"slotCode": code, "polygon": poly})
                    for idx in range(2):
                        code = f"{p_B}{idx + 6}"
                        poly = row1[idx + 5]["polygon"] if (idx + 5) < len(row1) else get_fallback_slot_poly(idx, 1, True)
                        assigned_slots.append({"slotCode": code, "polygon": poly})

                    # Row 2: Trái Zone 3 (1..5), Phải Zone 4 (1..5)
                    for idx in range(5):
                        code = f"{p_C}{idx + 1}"
                        poly = row2[idx]["polygon"] if idx < len(row2) else get_fallback_slot_poly(idx, 2, False)
                        assigned_slots.append({"slotCode": code, "polygon": poly})
                    for idx in range(5):
                        code = f"{p_D}{idx + 1}"
                        poly = row2[idx + 5]["polygon"] if (idx + 5) < len(row2) else get_fallback_slot_poly(idx, 2, True)
                        assigned_slots.append({"slotCode": code, "polygon": poly})

                    # Tính 4 góc bao quanh từ các ô thực tế
                    all_assigned_pts = [pt for s in assigned_slots for pt in s["polygon"]]
                    min_x = float(max(0.01, min(p[0] for p in all_assigned_pts) - 0.015))
                    max_x = float(min(0.99, max(p[0] for p in all_assigned_pts) + 0.015))
                    min_y = float(max(0.01, min(p[1] for p in all_assigned_pts) - 0.015))
                    max_y = float(min(0.99, max(p[1] for p in all_assigned_pts) + 0.015))

                    dynamic_corners = [
                        [float(round(min_x, 4)), float(round(min_y, 4))],
                        [float(round(max_x, 4)), float(round(min_y, 4))],
                        [float(round(max_x, 4)), float(round(max_y, 4))],
                        [float(round(min_x, 4)), float(round(max_y, 4))],
                    ]

                    clean_assigned = []
                    for s in assigned_slots:
                        clean_poly = [[float(round(pt[0], 4)), float(round(pt[1], 4))] for pt in s["polygon"]]
                        clean_assigned.append({"slotCode": str(s["slotCode"]), "polygon": clean_poly})

                    print(f"[AI Auto-Detect] YOLOv8-Seg successfully mapped {len(clean_assigned)} physical slots directly from webcam frame!")
                    return {
                        "success": True,
                        "model": "yolov8_seg",
                        "corners": dynamic_corners,
                        "totalSlots": len(clean_assigned),
                        "slots": clean_assigned
                    }
            except Exception as yolo_err:
                print(f"[AI Auto-Detect] YOLOv8-seg error: {yolo_err}")



        # -------------------------------------------------------------
        # PHƯƠNG ÁN 2: Bilinear Homography Fallback
        # -------------------------------------------------------------
        output_slots = []
        for i in range(1, 6):
            output_slots.append({"slotCode": f"{p_A}{i}", "polygon": get_fallback_slot_poly(i - 1, 0, False)})
        for i in range(6, 11):
            output_slots.append({"slotCode": f"{p_A}{i}", "polygon": get_fallback_slot_poly(i - 6, 1, False)})
        for i in range(1, 6):
            output_slots.append({"slotCode": f"{p_B}{i}", "polygon": get_fallback_slot_poly(i - 1, 0, True)})
        for i in range(6, 8):
            output_slots.append({"slotCode": f"{p_B}{i}", "polygon": get_fallback_slot_poly(i - 6, 1, True)})
        for i in range(1, 6):
            output_slots.append({"slotCode": f"{p_C}{i}", "polygon": get_fallback_slot_poly(i - 1, 2, False)})
        for i in range(1, 6):
            output_slots.append({"slotCode": f"{p_D}{i}", "polygon": get_fallback_slot_poly(i - 1, 2, True)})

        return {
            "success": True,
            "model": "bilinear_geometry",
            "corners": board_corners,
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


@app.post("/scan-slots")
async def scan_parking_slots(request: ScanSlotsRequest):
    """
    Quét và kiểm tra đồng thời 27 ô đỗ xe siêu tốc (<100ms):
    1. Global ALPR: 1 lượt YOLO duy nhất toàn khung hình tìm tất cả biển số xe.
    2. EasyOCR đọc chi tiết các biển số tìm được.
    3. Phép chiếu đa giác gán chính xác từng biển số vào đúng mã ô (VD: F2, B2).
    """
    if not reader:
        raise HTTPException(status_code=500, detail="OCR engine not initialized.")

    try:
        base64_data = request.image
        if "," in base64_data:
            base64_data = base64_data.split(",")[1]

        contents = base64.b64decode(base64_data)
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return {"success": True, "totalSlots": 0, "slots": []}

        img_h, img_w = img.shape[:2]

        # -------------------------------------------------------------
        # 1. Global ALPR Scan: YOLO inference 1 lần duy nhất (~25ms)
        # -------------------------------------------------------------
        detected_plates_global = []
        if yolo_model:
            try:
                yolo_res = yolo_model(img, conf=0.15, verbose=False)
                if len(yolo_res) > 0 and len(yolo_res[0].boxes) > 0:
                    for b in yolo_res[0].boxes:
                        g_box = b.xyxy[0].cpu().numpy().astype(int)
                        gx1, gy1, gx2, gy2 = g_box
                        gcx = float((gx1 + gx2) / 2.0)
                        gcy = float((gy1 + gy2) / 2.0)
                        g_conf = float(b.conf[0].cpu().numpy())

                        # Crop vùng biển số
                        x1 = max(0, gx1 - 8)
                        y1 = max(0, gy1 - 4)
                        x2 = min(img_w, gx2 + 8)
                        y2 = min(img_h, gy2 + 4)
                        crop = img[y1:y2, x1:x2]

                        ocr_text = ""
                        try:
                            ocr_res = reader.readtext(crop)
                            if not ocr_res:
                                proc = preprocess_image_for_ocr(crop)
                                ocr_res = reader.readtext(proc)
                            if ocr_res:
                                # Sắp xếp thứ tự đọc: Dòng trên trước, dòng dưới sau
                                ocr_res.sort(key=lambda r: (r[0][0][1], r[0][0][0]))
                                tokens = [re.sub(r'[^A-Z0-9]', '', str(r[1]).upper()) for r in ocr_res]
                                ocr_text = "".join(tokens)
                        except Exception:
                            pass

                        cleaned = clean_plate_text(ocr_text) if ocr_text else None
                        detected_plates_global.append({
                            "center": (gcx, gcy),
                            "box": [gx1, gy1, gx2, gy2],
                            "plate": cleaned,
                            "raw": ocr_text,
                            "conf": g_conf
                        })
            except Exception as y_err:
                print(f"[AI Global ALPR Error]: {y_err}")

        # -------------------------------------------------------------
        # 2. Slot Polygon Mapping
        # -------------------------------------------------------------
        results = []
        assigned_plates_in_scan = set()

        for slot_def in request.slots:
            slot_code = slot_def.slotCode
            pts = []

            if slot_def.polygon and len(slot_def.polygon) >= 3:
                for p in slot_def.polygon:
                    px = float(p[0])
                    py = float(p[1])
                    if px <= 1.0 and py <= 1.0 and img_w > 1 and img_h > 1:
                        px = px * img_w
                        py = py * img_h
                    pts.append([int(px), int(py)])
            elif slot_def.bbox and len(slot_def.bbox) >= 4:
                bx, by, bw, bh = slot_def.bbox
                if bw <= 1.0 and bh <= 1.0 and img_w > 1 and img_h > 1:
                    bx, by, bw, bh = bx * img_w, by * img_h, bw * img_w, bh * img_h
                pts = [
                    [int(bx), int(by)],
                    [int(bx + bw), int(by)],
                    [int(bx + bw), int(by + bh)],
                    [int(bx), int(by + bh)]
                ]

            if len(pts) < 3:
                results.append({
                    "slotCode": slot_code,
                    "occupied": False,
                    "plate": None,
                    "confidence": 0.0,
                    "reason": "Invalid ROI"
                })
                continue

            pts_np = np.array(pts, dtype=np.int32)
            detected_plate = None
            confidence = 0.0
            is_occupied = False

            # Gán biển số toàn cảnh vào ô chứa nó
            for g_det in detected_plates_global:
                p_norm = g_det["plate"].replace("-", "").replace(".", "").upper() if g_det["plate"] else None
                if p_norm and p_norm in assigned_plates_in_scan:
                    continue
                if cv2.pointPolygonTest(pts_np, g_det["center"], False) >= 0:
                    is_occupied = True
                    confidence = max(confidence, g_det["conf"])
                    if g_det["plate"]:
                        detected_plate = g_det["plate"]
                    elif g_det["raw"] and len(g_det["raw"]) >= 3:
                        detected_plate = g_det["raw"]

            # Quét trực tiếp ô nếu chưa phát hiện
            if not is_occupied:
                min_x = max(0, int(np.min(pts_np[:, 0])))
                max_x = min(img_w, int(np.max(pts_np[:, 0])))
                min_y = max(0, int(np.min(pts_np[:, 1])))
                max_y = min(img_h, int(np.max(pts_np[:, 1])))

                pad_x = int((max_x - min_x) * 0.08)
                pad_y = int((max_y - min_y) * 0.08)
                cx1 = min_x + pad_x
                cx2 = max_x - pad_x
                cy1 = min_y + pad_y
                cy2 = max_y - pad_y

                if (cx2 - cx1) >= 20 and (cy2 - cy1) >= 20:
                    slot_crop = img[cy1:cy2, cx1:cx2]
                    try:
                        local_ocr = reader.readtext(slot_crop)
                        if not local_ocr:
                            proc_crop = preprocess_image_for_ocr(slot_crop)
                            local_ocr = reader.readtext(proc_crop)

                        if local_ocr:
                            local_ocr.sort(key=lambda item: (item[0][0][1], item[0][0][0]))
                            tokens = [re.sub(r'[^A-Z0-9]', '', str(r[1]).upper()) for r in local_ocr]
                            raw_c = "".join(tokens)
                            if raw_c:
                                cleaned_c = clean_plate_text(raw_c)
                                no_dash = cleaned_c.replace("-", "").replace(".", "").upper()
                                digit_c = sum(c.isdigit() for c in no_dash)
                                has_struct = bool(re.search(r'([0-9]{2}[A-Z]|[0-9]{3,5})', no_dash))

                                # Bỏ qua nhãn ô đỗ in trên giấy sa bàn (VD: A1..D5)
                                is_label = bool(re.match(r'^[A-H0-9][1-9]0?$', no_dash))
                                if not is_label and (digit_c >= 3 or has_struct or len(no_dash) >= 4):
                                    cand_plate = cleaned_c if cleaned_c else raw_c
                                    cand_norm = cand_plate.replace("-", "").replace(".", "").upper()
                                    if cand_norm not in assigned_plates_in_scan:
                                        detected_plate = cand_plate
                                        is_occupied = True
                                        confidence = 0.85
                    except Exception:
                        pass

            if is_occupied and detected_plate:
                p_norm = detected_plate.replace("-", "").replace(".", "").upper()
                assigned_plates_in_scan.add(p_norm)
                print(f"[AI Slot Scan] >>> Slot {slot_code} OCCUPIED: Plate={detected_plate}, Conf={confidence:.2f}")

            results.append({
                "slotCode": slot_code,
                "occupied": is_occupied,
                "plate": detected_plate,
                "confidence": round(confidence, 2)
            })

        return {
            "success": True,
            "totalSlots": len(results),
            "slots": results
        }

    except Exception as e:
        print(f"Error during slot surveillance scan: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    print("Starting ValoParking AI Service on port 8000...")
    uvicorn.run(app, host="0.0.0.0", port=8000)

