from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import yt_dlp
import urllib.parse
import asyncio
import os
import tempfile
import uuid
import subprocess
import httpx
from fastapi.responses import FileResponse
import json
import time
import threading

app = FastAPI(title="SaveWave API")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
COOKIE_FILE = os.path.join(BASE_DIR, "cookies.txt")

# ──────────────────────────────────────────
# PO_TOKEN YÖNETİCİSİ
# ──────────────────────────────────────────
_po_token_cache = {"token": None, "visitor_data": None, "ts": 0}
_token_lock = threading.Lock()
TOKEN_TTL = 3600  # 1 saat geçerli

def _refresh_po_token():
    try:
        result = subprocess.run(
            ["youtube-po-token-generator"],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            data = json.loads(result.stdout.strip())
            with _token_lock:
                _po_token_cache["token"] = data.get("poToken")
                _po_token_cache["visitor_data"] = data.get("visitorData")
                _po_token_cache["ts"] = time.time()
                print(f"✅ po_token yenilendi: {_po_token_cache['token'][:20]}...")
        else:
            print(f"❌ po_token alınamadı: {result.stderr}")
    except Exception as e:
        print(f"❌ po_token hatası: {e}")

def get_po_token():
    with _token_lock:
        age = time.time() - _po_token_cache["ts"]
        if _po_token_cache["token"] and age < TOKEN_TTL:
            return _po_token_cache["token"], _po_token_cache["visitor_data"]
    _refresh_po_token()
    return _po_token_cache["token"], _po_token_cache["visitor_data"]

def build_ydl_opts_base(url: str) -> dict:
    """Her yt-dlp isteği için temel ayarları döndürür."""
    opts = {
        'quiet': False,
        'noplaylist': True,
        'remote_components': ['ejs:github'],
        'extractor_args': {'youtube': ['player_client=ios,android,web']}
    }

    # Cookie dosyası varsa ekle
    if os.path.exists(COOKIE_FILE):
        opts['cookiefile'] = COOKIE_FILE
        print("🍪 Cookie dosyası kullanılıyor.")

    # YouTube URL'si ise po_token ekle
    if "youtube.com" in url or "youtu.be" in url:
        token, visitor_data = get_po_token()
        if token and visitor_data:
            opts['extractor_args']['youtube'] = [
                'player_client=ios,android,web',
                f'po_token=web+{token}',
            ]
            opts['http_headers'] = {'X-Youtube-Identity-Token': visitor_data}
            print("🔑 po_token eklendi.")

    return opts

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

QUALITY_MAP = {"4k": "2160", "1080": "1080", "720": "720", "480": "480", "360": "360"}


def build_format(media_type: str, quality: str, url: str):
    target_res = QUALITY_MAP.get(quality, "720")

    if media_type == "audio":
        # ÇÖZÜM: Instagram ve TikTok bazen sadece video+ses (best) sunar. 
        # Güvenli çözüm için bu platformlarda "best" indirip FFmpeg ile mp3'e çeviriyoruz.
        fmt = "best" if ("instagram.com" in url or "tiktok.com" in url) else "bestaudio/best"
        return fmt, [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }], "mp3"

    if "instagram.com" in url or "tiktok.com" in url:
        return "best", [], "mp4"

    # ÇÖZÜM: [ext=mp4] zorunluluğunu kaldırdık ki 1080p (WEBM vb.) atlanmasın.
    # yt-dlp en iyi görüntü ve sesi ayrı ayrı indirecek, FFmpeg birleştirecek.
    fmt = (
        f"bestvideo[height<={target_res}]+bestaudio"
        f"/best[height<={target_res}]"
        f"/best"
    )
    return fmt, [], "mp4"


@app.get("/api/download")
async def get_video_info(url: str, media_type: str = "video", quality: str = "720"):
    info_opts = build_ydl_opts_base(url)
    info_opts['quiet'] = True
    info_opts['skip_download'] = True

    try:
        with yt_dlp.YoutubeDL(info_opts) as ydl:
            info = ydl.extract_info(url, download=False)

        duration_sec = info.get('duration') or 0
        try:
            duration_str = f"{int(duration_sec) // 60}:{int(duration_sec) % 60:02d}"
        except Exception:
            duration_str = "Bilinmiyor"

        raw_title = info.get('title') or 'video'
        safe_title = "".join([c for c in raw_title if c.isalnum() or c in " _-"]).rstrip()
        ext = "mp3" if media_type == "audio" else "mp4"
        filename = f"SaveWave_{safe_title}.{ext}"

        return {
            "success": True,
            "title": raw_title,
            "duration": duration_str,
            "views": f"{info.get('view_count', 0):,} goruntulenme" if info.get('view_count') else "---",
            "likes": f"{info.get('like_count', 0):,} begeni" if info.get('like_count') else "---",
            "thumbnailUrl": info.get('thumbnail', ''),
            "directDownloadUrl": url,
            "filename": filename,
            "media_type": media_type,
            "quality": quality
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Video bilgisi alinamadi: {str(e)}")


@app.get("/api/proxy")
async def proxy_download(url: str, filename: str, media_type: str = "video", quality: str = "720"):
    fmt, postprocessors, final_ext = build_format(media_type, quality, url)

    tmp_dir = tempfile.gettempdir()
    tmp_id = str(uuid.uuid4())
    output_path = os.path.join(tmp_dir, f"{tmp_id}.%(ext)s")

    ydl_opts = build_ydl_opts_base(url)
    ydl_opts['format'] = fmt
    ydl_opts['outtmpl'] = output_path
    ydl_opts['postprocessors'] = postprocessors

    # Railway'de ffmpeg sistem PATH'inde olur, .exe olmaz
    ffmpeg_path = os.path.join(BASE_DIR, "ffmpeg.exe")
    if os.path.exists(ffmpeg_path):
        ydl_opts['ffmpeg_location'] = ffmpeg_path
        print(f"✅ FFmpeg bulundu: {ffmpeg_path}")
    else:
        print("ℹ️ ffmpeg sistem PATH'inden kullanılacak.")

    if media_type != "audio":
        ydl_opts['merge_output_format'] = 'mp4'

    loop = asyncio.get_event_loop()

    def do_download():
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            return ydl.prepare_filename(info)

    try:
        prepared = await loop.run_in_executor(None, do_download)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Indirme hatasi: {str(e)}")

    base = os.path.splitext(prepared)[0]
    final_path = None
    for ext in [final_ext, "mp4", "mkv", "webm", "mp3", "m4a"]:
        candidate = f"{base}.{ext}"
        if os.path.exists(candidate):
            final_path = candidate
            break

    if not final_path:
        for f in os.listdir(tmp_dir):
            if f.startswith(tmp_id):
                final_path = os.path.join(tmp_dir, f)
                break

    if not final_path or not os.path.exists(final_path):
        raise HTTPException(status_code=500, detail="Indirilen dosya bulunamadi.")

    safe_filename = urllib.parse.quote(filename)

    def iterfile():
        try:
            with open(final_path, "rb") as f:
                while chunk := f.read(1024 * 1024):
                    yield chunk
        finally:
            try:
                os.remove(final_path)
            except Exception:
                pass

    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{safe_filename}",
        "Content-Length": str(os.path.getsize(final_path)),
    }

    return StreamingResponse(iterfile(), headers=headers, media_type="application/octet-stream")


@app.get("/api/clip")
async def clip_video(url: str, start: str = "0:00", end: str = "", quality: str = "720"):
    """Videoyu belirtilen zaman aralığında kirp (ffmpeg ile)."""

    def parse_time(t: str) -> str:
        parts = t.strip().split(":")
        if len(parts) == 2:
            return f"00:{int(parts[0]):02d}:{int(parts[1]):02d}"
        elif len(parts) == 3:
            return f"{int(parts[0]):02d}:{int(parts[1]):02d}:{int(parts[2]):02d}"
        return "00:00:00"

    start_tc = parse_time(start)
    end_tc = parse_time(end) if end else ""

    fmt, _, _ = build_format("video", quality, url)
    tmp_dir = tempfile.gettempdir()
    tmp_id = str(uuid.uuid4())
    raw_path = os.path.join(tmp_dir, f"{tmp_id}_raw.%(ext)s")
    clipped_path = os.path.join(tmp_dir, f"{tmp_id}_clip.mp4")

    ydl_opts = build_ydl_opts_base(url)
    ydl_opts['format'] = fmt
    ydl_opts['outtmpl'] = raw_path
    ydl_opts['merge_output_format'] = 'mp4'

    ffmpeg_path = os.path.join(BASE_DIR, "ffmpeg.exe")
    if os.path.exists(ffmpeg_path):
        ydl_opts['ffmpeg_location'] = ffmpeg_path

    loop = asyncio.get_event_loop()

    def do_download():
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            prepared = ydl.prepare_filename(info)
            base = os.path.splitext(prepared)[0]
            for ext in ["mp4", "mkv", "webm"]:
                candidate = f"{base}.{ext}"
                if os.path.exists(candidate):
                    return candidate
            for f in os.listdir(tmp_dir):
                if f.startswith(tmp_id + "_raw"):
                    return os.path.join(tmp_dir, f)
            return prepared

    try:
        raw_file = await loop.run_in_executor(None, do_download)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Video indirilemedi: {str(e)}")

    ffmpeg_bin = ffmpeg_path if os.path.exists(ffmpeg_path) else "ffmpeg"
    ffmpeg_cmd = [ffmpeg_bin, "-y", "-i", raw_file, "-ss", start_tc]
    if end_tc:
        ffmpeg_cmd += ["-to", end_tc]
    ffmpeg_cmd += ["-c", "copy", clipped_path]

    def run_ffmpeg():
        result = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
        return result.returncode, result.stderr

    try:
        returncode, stderr = await loop.run_in_executor(None, run_ffmpeg)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ffmpeg hatasi: {str(e)}")
    finally:
        try:
            os.remove(raw_file)
        except Exception:
            pass

    if returncode != 0 or not os.path.exists(clipped_path):
        raise HTTPException(status_code=500, detail=f"Kirpma basarisiz: {stderr[-300:]}")

    filename = f"SaveWave_clip_{start.replace(':','-')}_{end.replace(':','-')}.mp4"
    safe_filename = urllib.parse.quote(filename)

    def iterfile():
        try:
            with open(clipped_path, "rb") as f:
                while chunk := f.read(1024 * 1024):
                    yield chunk
        finally:
            try:
                os.remove(clipped_path)
            except Exception:
                pass

    return StreamingResponse(
        iterfile(),
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{safe_filename}",
            "Content-Length": str(os.path.getsize(clipped_path)),
        },
        media_type="application/octet-stream"
    )
    
@app.get("/api/thumbnail")
async def download_thumbnail(url: str):
    """Video kapak fotoğrafını veya resim gönderisini indir ve döndür."""
    info_opts = build_ydl_opts_base(url)
    info_opts['quiet'] = True
    info_opts['skip_download'] = True

    try:
        with yt_dlp.YoutubeDL(info_opts) as ydl:
            info = ydl.extract_info(url, download=False)

        # GÜNCELLEME: yt-dlp salt fotoğraf gönderilerinde resmi 'url' alanına koyabilir.
        # Bu yüzden önce 'thumbnail', yoksa 'url' alanına bakıyoruz.
        thumbnail_url = info.get('thumbnail') or info.get('url')
        
        if not thumbnail_url:
            raise HTTPException(status_code=404, detail="Kapak fotoğrafı veya resim bulunamadı.")

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(thumbnail_url)
            if resp.status_code != 200:
                raise HTTPException(status_code=502, detail="Fotoğraf kaynağına ulaşılamadı.")

        raw_title = info.get('title') or 'photo'
        safe_title = "".join([c for c in raw_title if c.isalnum() or c in " _-"]).rstrip()
        filename = f"SaveWave_{safe_title}.jpg"
        safe_filename = urllib.parse.quote(filename)

        return StreamingResponse(
            iter([resp.content]),
            media_type="image/jpeg",
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{safe_filename}",
                "Content-Length": str(len(resp.content)),
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Fotoğraf alınamadı: {str(e)}")
    
@app.get("/api/debug")
async def list_files():
    """Sunucudaki dosyalari listeler"""
    return {"files": os.listdir(BASE_DIR)}

# --- FRONTEND (ARAYÜZ) SUNUCU KODLARI ---
@app.get("/")
async def serve_index():
    """Ana sayfaya girildiğinde index.html dosyasını gösterir."""
    return FileResponse("index.html")

@app.get("/{filename}")
async def serve_static(filename: str):
    """sw.js, style.css, main.js, manifest.json ve resimleri sunar."""
    if os.path.isfile(filename):
        return FileResponse(filename)
    raise HTTPException(status_code=404, detail="Sayfa bulunamadı")