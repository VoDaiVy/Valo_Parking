# =========================================================================
# VALOPARKING - HUẤN LUYỆN MODEL YOLOv8-SEGMENTATION TRÊN GOOGLE COLAB
# (PHIÊN BẢN VERSION 4: HỌC SA BÀN THỰC TẾ & GÓC NGHIÊNG)
# =========================================================================
# Hướng dẫn:
# 1. Truy cập https://colab.research.google.com/ -> New Notebook
# 2. Chọn Runtime -> Change runtime type -> Chọn T4 GPU -> Save
# 3. Copy toàn bộ nội dung file này vào 1 ô code trên Colab rồi bấm Play (Run)

# Bước 1: Cài đặt thư viện
!pip install -q ultralytics roboflow

# Bước 2: Tải Dataset Version 4 mới nhất từ Roboflow
from roboflow import Roboflow
rf = Roboflow(api_key="D5zQa7sJjr1GUVrtYt0J")
project = rf.workspace("vo-dai-vy-k18-dn").project("parking-slot-detection-gdqpe")
version = project.version(4) # Sử dụng Dataset Version 4 mới vừa tạo!
dataset = version.download("yolov8")

print("\n--- Đã tải xong Dataset Version 4 tại:", dataset.location)

# Bước 3: Huấn luyện mô hình YOLOv8 Segmentation
from ultralytics import YOLO

# Sử dụng mô hình nền yolov8n-seg (~6.7MB) siêu nhẹ
model = YOLO('yolov8n-seg.pt')

# Huấn luyện 60 vòng (epochs) với GPU T4 miễn phí (~4-6 phút)
results = model.train(
    data=f"{dataset.location}/data.yaml",
    epochs=60,
    imgsz=640,
    batch=16,
    plots=True
)

print("\n=======================================================")
print("🎉 HUẤN LUYỆN VERSION 4 HOÀN TẤT THÀNH CÔNG!")
print("📁 File model của bạn nằm tại: runs/segment/train/weights/best.pt")
print("👉 Hãy tải file best.pt về máy và đổi tên thành: parking_slots_yolo.pt")
print("👉 Đặt đè vào thư mục: ValoParking/ai_service/")
print("=======================================================")
