# =========================================================================
# VALOPARKING - HUẤN LUYỆN MODEL YOLOv8-SEGMENTATION TRÊN GOOGLE COLAB
# =========================================================================
# Hướng dẫn:
# 1. Truy cập https://colab.research.google.com/ -> New Notebook
# 2. Chọn Runtime -> Change runtime type -> Chọn T4 GPU -> Save
# 3. Copy toàn bộ nội dung file này vào 1 ô code trên Colab rồi bấm Play (Run)

# Bước 1: Cài đặt thư viện
!pip install -q ultralytics roboflow

# Bước 2: Tải Dataset v3 từ Roboflow của bạn
from roboflow import Roboflow
rf = Roboflow(api_key="D5zQa7sJjr1GUVrtYt0J")
project = rf.workspace("vo-dai-vy-k18-dn").project("parking-slot-detection-gdqpe")
version = project.version(3)
dataset = version.download("yolov8")

print("\n--- Đã tải xong Dataset tại:", dataset.location)

# Bước 3: Huấn luyện mô hình YOLOv8 Segmentation
from ultralytics import YOLO

# Sử dụng mô hình nền yolov8n-seg (~6.7MB) siêu nhẹ
model = YOLO('yolov8n-seg.pt')

# Huấn luyện 50 vòng (epochs) với GPU T4 miễn phí (~3-5 phút)
results = model.train(
    data=f"{dataset.location}/data.yaml",
    epochs=50,
    imgsz=640,
    plots=True
)

print("\n=======================================================")
print("HUẤN LUYỆN HOÀN TẤT THÀNH CÔNG!")
print("File model của bạn nằm tại: runs/segment/train/weights/best.pt")
print("Hãy tải file best.pt về máy và đổi tên thành: parking_slots_yolo.pt")
print("=======================================================")
