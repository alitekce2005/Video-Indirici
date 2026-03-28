# 1. Temel Python imajı
FROM python:3.10-slim

# 2. Sistem paketlerini (ffmpeg, nodejs, npm) kur
RUN apt-get update && \
    apt-get install -y ffmpeg nodejs npm && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# 3. YouTube token aracını kur
RUN npm install -g youtube-po-token-generator

# 4. Çalışma klasörümüz
WORKDIR /app

# 5. Gereksinimleri kopyala ve kur
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 6. Geri kalan dosyaları kopyala
COPY . .

# 7. Koyeb'in dinamik port atamasıyla uygulamayı başlat
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]