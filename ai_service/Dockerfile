FROM python:3.10-slim

# Install system dependencies for OpenCV and EasyOCR
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    YOLO_CONFIG_DIR=/app/.cache/ultralytics \
    EASYOCR_MODULE_PATH=/app/.cache/easyocr

RUN mkdir -p /app/.cache/ultralytics /app/.cache/easyocr && chmod -R 777 /app/.cache

# Copy requirements and install python packages
COPY requirements.txt .
RUN pip install --no-cache-dir --default-timeout=2000 --retries 20 -r requirements.txt

# Pre-download EasyOCR weights into /app/.cache/easyocr so cold starts are fast
RUN python -c "import easyocr; easyocr.Reader(['en'], gpu=False)" && chmod -R 777 /app/.cache

# Copy source code and trained weights (best.pt, parking_slots_yolo.pt)
COPY . .

# Expose default port (honors $PORT dynamically at runtime)
EXPOSE 8000

# Run the API
CMD ["python", "main.py"]
