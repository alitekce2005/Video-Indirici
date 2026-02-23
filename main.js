/* ---------- State ---------- */
let currentPlatform = 'instagram';
let selectedOpt = 'video';
let selectedQuality = '720';
let activeDownloadCount = 0;
const MAX_CONCURRENT_DOWNLOADS = 3;

/* ---------- Bildirim İzni ---------- */
async function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission();
    }
}
document.addEventListener('DOMContentLoaded', requestNotificationPermission);

function sendNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, {
            body,
            icon: '/arma3-Photoroom.png',
            badge: '/arma3-Photoroom.png',
            silent: false
        });
    }
}

/* ---------- Tema ---------- */
function toggleTheme() {
    const html = document.documentElement;
    const isLight = html.getAttribute('data-theme') === 'light';
    if (isLight) {
        html.removeAttribute('data-theme');
        document.getElementById('theme-icon').textContent = '☀️';
        localStorage.setItem('sw-theme', 'dark');
    } else {
        html.setAttribute('data-theme', 'light');
        document.getElementById('theme-icon').textContent = '🌙';
        localStorage.setItem('sw-theme', 'light');
    }
}
(function () {
    if (localStorage.getItem('sw-theme') === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
        window.addEventListener('DOMContentLoaded', () => {
            const icon = document.getElementById('theme-icon');
            if (icon) icon.textContent = '🌙';
        });
    }
})();
/* ---------- Platform switch ---------- */
function switchPlatform(platform, btn) {
    currentPlatform = platform;
    document.querySelectorAll('.tab-btn').forEach(b => {
        b.className = 'tab-btn';
    });
    btn.classList.add('active-' + (platform === 'instagram' ? 'ig' : platform === 'youtube' ? 'yt' : 'tt'));

    // Update placeholder
    const placeholders = {
        instagram: 'https://www.instagram.com/p/... veya /reel/... girin',
        youtube: 'https://www.youtube.com/watch?v=... veya youtu.be/... girin',
        tiktok: 'https://www.tiktok.com/@user/video/... girin'
    };
    document.getElementById('url-input').placeholder = placeholders[platform];

    // Show/hide story option
    document.getElementById('opt-story').style.display = (platform === 'youtube') ? 'none' : '';

    // Reset result
    hideAll();
    showToast('Platform değiştirildi: ' + platform.charAt(0).toUpperCase() + platform.slice(1), 'blue');
}

/* ---------- Select option chip ---------- */
function selectOpt(type, el) {
    selectedOpt = type;
    document.querySelectorAll('.opt-chip').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');

    // Show/hide quality row
    document.getElementById('quality-row').style.display = (type === 'audio' || type === 'photo') ? 'none' : '';
}

/* ---------- Select quality ---------- */
function selectQuality(q, btn) {
    selectedQuality = q;
    document.querySelectorAll('.q-btn').forEach(b => b.classList.remove('q-active'));
    btn.classList.add('q-active');
}

/* ---------- Paste ---------- */
async function pasteURL() {
    try {
        const text = await navigator.clipboard.readText();
        document.getElementById('url-input').value = text;
        autoDetectPlatform(text);
        showToast('URL yapıştırıldı!', 'green');
    } catch {
        document.getElementById('url-input').focus();
        showToast('Manuel yapıştırın (Ctrl+V)', 'blue');
    }
}

/* ---------- Auto detect platform ---------- */
function autoDetectPlatform(url) {
    if (url.includes('instagram.com')) {
        const btn = document.querySelector('[data-platform="instagram"]');
        switchPlatform('instagram', btn);
    } else if (url.includes('youtube.com') || url.includes('youtu.be')) {
        const btn = document.querySelector('[data-platform="youtube"]');
        switchPlatform('youtube', btn);
    } else if (url.includes('tiktok.com')) {
        const btn = document.querySelector('[data-platform="tiktok"]');
        switchPlatform('tiktok', btn);
    }
}

/* ---------- Input auto-detect on paste/input ---------- */
let previewTimer = null;
document.getElementById('url-input').addEventListener('input', function () {
    const val = this.value.trim();
    if (val.length > 10) autoDetectPlatform(val);
    hideAll();
    window._previewData = null;
    clearTimeout(previewTimer);
    const box = document.getElementById('url-preview');
    if (val.length < 15) { if (box) box.style.display = 'none'; return; }
    previewTimer = setTimeout(() => fetchURLPreview(val), 1200);
});
/* ---------- URL Validation ---------- */
function validateURL(url) {
    url = url.trim();
    if (!url) return { valid: false, msg: 'URL alanı boş bırakılamaz.' };

    const patterns = {
        instagram: /instagram\.com\/(p|reel|tv|stories|s|)\//,
        youtube: /(youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts\/)/,
        tiktok: /tiktok\.com\/@[\w.]+\/video\/\d+/
    };

    if (!patterns[currentPlatform].test(url)) {
        const examples = {
            instagram: 'Örnek: https://www.instagram.com/p/ABC123/',
            youtube: 'Örnek: https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            tiktok: 'Örnek: https://www.tiktok.com/@user/video/1234567890'
        };
        return { valid: false, msg: 'Geçersiz ' + currentPlatform + ' URL\'si. ' + examples[currentPlatform] };
    }
    return { valid: true };
}

/* ---------- Gerçek İndirme İşlemi ---------- */
async function startDownload() {
    const url = document.getElementById('url-input').value.trim();
    const validation = validateURL(url);

    hideAll();

    if (!validation.valid) {
        showError('Geçersiz URL', validation.msg);
        return;
    }

    showLoading();
    document.getElementById('loading-text').textContent = "İçerik analiz ediliyor...";

    try {
        let qualityVal = selectedQuality;
        let mediaType = (selectedOpt === 'audio') ? 'audio' : 'video';

        let data;
        // Önizleme cache'i varsa tekrar istek atma
        if (window._previewData && window._previewData.directDownloadUrl) {
            data = window._previewData;
            window._previewData = null;
        } else {
            const apiEndpoint = `http://localhost:8000/api/download?url=${encodeURIComponent(url)}&media_type=${mediaType}&quality=${qualityVal}`;
            const response = await fetch(apiEndpoint);
            data = await response.json();
            if (!response.ok) throw new Error(data.detail || "Bir hata oluştu.");
        }

        hideAll();
        showRealResult(data);

    } catch (error) {
        hideAll();
        showError('İşlem Başarısız', error.message);
    }
}

/* ---------- Show/Hide helpers ---------- */
function hideAll() {
    document.getElementById('loading-bar').classList.remove('visible');
    document.getElementById('error-box').classList.remove('visible');
    document.getElementById('result-panel').classList.remove('visible');

    // Aktif indirme yoksa downloads panelini de kapat
    if (activeDownloadCount === 0) {
        const dp = document.getElementById('downloads-panel');
        if (dp) dp.style.display = 'none';
    }
}

function showLoading() {
    document.getElementById('loading-bar').classList.add('visible');
    // reset progress animation
    const fill = document.getElementById('progress-fill');
    fill.style.animation = 'none';
    fill.offsetHeight;
    fill.style.animation = '';
}

function showError(title, detail) {
    document.getElementById('error-title').textContent = title;
    document.getElementById('error-detail').textContent = detail;
    document.getElementById('error-box').classList.add('visible');
}

/* ---------- Show result (mock) ---------- */
/* ---------- API'den Gelen Veriyi Ekrana Basma ve OTOMATİK İNDİRME ---------- */
function showRealResult(data) {
    const panel = document.getElementById('result-panel');
    panel.classList.add('visible');

    // Metadataları doldur
    document.getElementById('media-title').textContent = data.title;
    document.getElementById('meta-duration').textContent = data.duration;
    document.getElementById('meta-views').textContent = data.views;
    document.getElementById('meta-likes').textContent = data.likes;
    document.getElementById('meta-platform').textContent = currentPlatform.toUpperCase();

    // Kapak fotoğrafını göster
    if (data.thumbnailUrl) {
        const thumbImg = document.getElementById('thumb-img');
        thumbImg.src = data.thumbnailUrl;
        thumbImg.style.display = 'block';
        document.getElementById('thumb-placeholder').style.display = 'none';
    }

    // Proxy indirme linkini oluştur
    // Eski Hali: const proxyDownloadUrl = `http://localhost:8000/api/proxy...
    const proxyDownloadUrl = `/api/proxy?url=${encodeURIComponent(data.directDownloadUrl)}&filename=${encodeURIComponent(data.filename)}&media_type=${data.media_type}&quality=${data.quality}`;
    const grid = document.getElementById('dl-grid');
    // Sadece önceki indirme butonunu temizle, clip-panel ve thumb-dl-row'u koru
    const existingBtn = grid.querySelector('.dl-option');
    if (existingBtn) existingBtn.remove();

    const el = document.createElement('a');
    el.className = 'dl-option';

    // YENİ EKLENEN KISIM: Tarayıcının kendi indirmesini engelliyor ve bizim progress bar fonksiyonunu tetikliyoruz
    el.href = '#';
    el.onclick = (e) => {
        e.preventDefault();
        triggerDownloadWithProgress(proxyDownloadUrl, data.filename);
    };

    // Tasarım
    let typeText = data.media_type === 'audio' ? 'Ses Dosyası (MP3)' : `Video İndir (${selectedQuality}p)`;

    el.innerHTML = `
    <div class="dl-opt-left">
      <div class="dl-opt-type">${typeText}</div>
      <div class="dl-opt-size">Otomatik İndirme Başlıyor</div>
    </div>
    <div class="dl-opt-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
    </div>`;

    grid.appendChild(el);
    // YENİ: Thumbnail butonu ve kırpma panelini göster
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Kırpma panelini göster ve URL'yi sakla
    window._currentVideoUrl = data.directDownloadUrl;
    window._currentQuality = data.quality || selectedQuality;
    window._currentDuration = data.duration || '';

    const clipPanel = document.getElementById('clip-panel');
    if (clipPanel) {
        clipPanel.style.cssText = 'display:block; margin-top:16px; background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:12px; padding:16px 18px;';

        // Süre bilgisini göster
        const durEl = document.getElementById('clip-duration-info');
        if (durEl && data.duration && data.duration !== '—' && data.duration !== 'Bilinmiyor') {
            durEl.textContent = `⏱ Video süresi: ${data.duration}`;
            durEl.style.display = 'block';
        } else if (durEl) {
            durEl.style.display = 'none';
        }

        // Bitiş inputuna max süreyi placeholder olarak yaz
        const clipEnd = document.getElementById('clip-end');
        if (clipEnd && data.duration && data.duration !== '—') {
            clipEnd.placeholder = data.duration;
        }
    }

    // === OTOMATİK İNDİRMEYİ TETİKLE ===
    showToast("İndirme otomatik olarak başlatılıyor...", "green");

    // Kart ekranda göründükten 1 saniye sonra ilerleme çubuklu indirmeyi otomatik başlatıyoruz
    setTimeout(() => {
        triggerDownloadWithProgress(proxyDownloadUrl, data.filename);
    }, 1000);
}

function buildOptions() {
    const dlIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
    const imgIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
    const audioIco = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;

    if (currentPlatform === 'youtube') {
        return [
            { label: '4K UHD – MP4', size: '~2.1 GB', icon: dlIcon },
            { label: '1080p FHD – MP4', size: '~890 MB', icon: dlIcon },
            { label: '720p HD – MP4', size: '~420 MB', icon: dlIcon },
            { label: '480p – MP4', size: '~180 MB', icon: dlIcon },
            { label: '360p – MP4', size: '~80 MB', icon: dlIcon },
            { label: 'MP3 320kbps', size: '~28 MB', icon: audioIco, type: 'audio' },
            { label: 'MP3 128kbps', size: '~11 MB', icon: audioIco, type: 'audio' },
            { label: 'Thumbnail HD', size: '~320 KB', icon: imgIcon, type: 'photo' },
        ];
    } else if (currentPlatform === 'instagram') {
        return [
            { label: 'Orijinal MP4', size: '~45 MB', icon: dlIcon },
            { label: '720p HD – MP4', size: '~22 MB', icon: dlIcon },
            { label: '480p – MP4', size: '~12 MB', icon: dlIcon },
            { label: 'MP3 Ses', size: '~4 MB', icon: audioIco, type: 'audio' },
            { label: 'Kapak Görseli', size: '~200 KB', icon: imgIcon, type: 'photo' },
        ];
    } else { // tiktok
        return [
            { label: 'Filigrансыз HD', size: '~18 MB', icon: dlIcon },
            { label: 'Standart MP4', size: '~9 MB', icon: dlIcon },
            { label: 'MP3 Ses', size: '~3 MB', icon: audioIco, type: 'audio' },
            { label: 'Kapak Fotoğrafı', size: '~150 KB', icon: imgIcon, type: 'photo' },
        ];
    }
}

/* ---------- İndirme: Progress + Hız + Süre + İptal ---------- */
async function triggerDownloadWithProgress(downloadUrl, filename) {
    const panel = document.getElementById('downloads-panel');
    const list = document.getElementById('active-downloads-list');
    panel.style.display = 'block';

    const dlId = 'dl-' + Date.now();
    const controller = new AbortController();
    const dlCard = document.createElement('div');
    dlCard.className = 'download-item';
    dlCard.id = dlId;
    dlCard.innerHTML = `
        <div class="dl-header">
            <div class="dl-filename">${filename}</div>
            <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
                <div class="dl-speed" id="speed-${dlId}"></div>
                <div class="dl-status" id="status-${dlId}">0%</div>
                <button id="cancel-${dlId}" onclick="cancelDownload('${dlId}')"
                    style="background:rgba(255,80,80,0.15);border:1px solid rgba(255,80,80,0.4);
                    color:#ff6b6b;border-radius:6px;padding:2px 10px;font-size:12px;cursor:pointer;">
                    İptal
                </button>
            </div>
        </div>
        <div class="dl-eta-row" id="eta-${dlId}"></div>
        <div class="dl-progress-bg">
            <div class="dl-progress-fill" id="fill-${dlId}"></div>
        </div>
    `;
    list.prepend(dlCard);
    dlCard._controller = controller;
    dlCard._cancelled = false;

    // Eşzamanlı indirme limiti kontrolü
    if (activeDownloadCount >= MAX_CONCURRENT_DOWNLOADS) {
        showToast(`⚠️ Aynı anda en fazla ${MAX_CONCURRENT_DOWNLOADS} indirme yapılabilir!`, 'red');
        dlCard.remove();
        if (!list.children.length) panel.style.display = 'none';
        return;
    }
    activeDownloadCount++;

    const historyId = Date.now();
    addToHistory({ id: historyId, filename, status: 'downloading', date: new Date().toISOString() });

    try {
        const response = await fetch(downloadUrl, { signal: controller.signal });
        if (!response.ok) throw new Error("İndirme başlatılamadı.");

        const contentLength = response.headers.get('content-length');
        const total = contentLength ? parseInt(contentLength, 10) : 0;
        let loaded = 0;
        const startTime = Date.now();
        const reader = response.body.getReader();
        const chunks = [];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            chunks.push(value);
            loaded += value.length;

            const elapsed = (Date.now() - startTime) / 1000;
            const bps = elapsed > 0 ? loaded / elapsed : 0;

            const speedEl = document.getElementById(`speed-${dlId}`);
            const etaEl = document.getElementById(`eta-${dlId}`);
            const statEl = document.getElementById(`status-${dlId}`);
            const fillEl = document.getElementById(`fill-${dlId}`);

            // Hız göstergesi
            if (speedEl) {
                if (bps > 0) {
                    const { text, color } = formatSpeed(bps);
                    speedEl.textContent = text;
                    speedEl.style.color = color;
                }
            }

            // ETA satırı
            if (etaEl) {
                if (total > 0 && bps > 0) {
                    const rem = (total - loaded) / bps;
                    etaEl.textContent = `⏱ Kalan: ~${formatETA(rem)}  ·  ${formatSize(loaded)} / ${formatSize(total)}`;
                } else if (total > 0) {
                    etaEl.textContent = `📥 ${formatSize(loaded)} / ${formatSize(total)}`;
                } else {
                    etaEl.textContent = `📥 İndirilen: ${formatSize(loaded)}`;
                }
            }

            // Progress bar ve yüzde
            if (total > 0) {
                const pct = Math.round((loaded / total) * 100);
                if (statEl) statEl.textContent = `${pct}%`;
                if (fillEl) fillEl.style.width = `${pct}%`;
            } else {
                if (statEl) statEl.textContent = formatSize(loaded);
                if (fillEl) {
                    fillEl.style.width = '100%';
                    fillEl.style.animation = 'pulse 1s infinite';
                }
            }
        }

        // Tamamlandı
        const totalSec = ((Date.now() - startTime) / 1000).toFixed(1);
        const avgBps = loaded / (parseFloat(totalSec) || 1);
        const { text: avgText } = formatSpeed(avgBps);

        const cancelBtn = document.getElementById(`cancel-${dlId}`);
        if (cancelBtn) cancelBtn.remove();

        const statEl2 = document.getElementById(`status-${dlId}`);
        const fillEl2 = document.getElementById(`fill-${dlId}`);
        const etaF = document.getElementById(`eta-${dlId}`);
        const spF = document.getElementById(`speed-${dlId}`);

        if (statEl2) { statEl2.textContent = 'Tamamlandı ✅'; statEl2.style.color = 'var(--success)'; }
        if (fillEl2) { fillEl2.style.width = '100%'; fillEl2.style.background = 'var(--success)'; fillEl2.style.animation = 'none'; }
        if (etaF) etaF.textContent = `✅ ${formatSize(loaded)} · Ort: ${avgText} · ${totalSec}sn`;
        if (spF) spF.textContent = '';

        activeDownloadCount--;
        updateHistoryStatus(historyId, 'done');
        sendNotification('İndirme Tamamlandı ✅', `${filename} başarıyla indirildi.`);

        const blob = new Blob(chunks);
        const objectUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        window.URL.revokeObjectURL(objectUrl);

    } catch (error) {
        const cb = document.getElementById(`cancel-${dlId}`);
        if (cb) cb.remove();

        const statEl3 = document.getElementById(`status-${dlId}`);
        const fillEl3 = document.getElementById(`fill-${dlId}`);

        activeDownloadCount--;
        if (error.name === 'AbortError' || dlCard._cancelled) {
            if (statEl3) { statEl3.textContent = 'İptal edildi 🚫'; statEl3.style.color = '#aaa'; }
            if (fillEl3) { fillEl3.style.background = '#555'; fillEl3.style.animation = 'none'; }
            updateHistoryStatus(historyId, 'cancelled');
        } else {
            if (statEl3) { statEl3.textContent = 'Hata ❌'; statEl3.style.color = 'var(--danger)'; }
            if (fillEl3) { fillEl3.style.background = 'var(--danger)'; }
            updateHistoryStatus(historyId, 'error');
            showError('İndirme Hatası', error.message);
        }
    }
}

function cancelDownload(dlId) {
    const card = document.getElementById(dlId);
    if (card && card._controller) { card._cancelled = true; card._controller.abort(); }
}

function formatSpeed(bps) {
    let text, color;
    if (bps > 1048576) {
        text = (bps / 1048576).toFixed(1) + ' MB/s';
        color = '#4ade80'; // yeşil — hızlı
    } else if (bps > 512000) {
        text = (bps / 1024).toFixed(0) + ' KB/s';
        color = 'var(--accent)'; // mavi — orta
    } else {
        text = (bps / 1024).toFixed(0) + ' KB/s';
        color = '#facc15'; // sarı — yavaş
    }
    return { text, color };
}
function formatSize(b) {
    if (b > 1073741824) return (b / 1073741824).toFixed(2) + ' GB';
    if (b > 1048576) return (b / 1048576).toFixed(1) + ' MB';
    if (b > 1024) return (b / 1024).toFixed(0) + ' KB';
    return b + ' B';
}
function formatETA(s) {
    if (s > 3600) return Math.floor(s / 3600) + 's ' + Math.floor((s % 3600) / 60) + 'dk';
    if (s > 60) return Math.floor(s / 60) + 'dk ' + Math.floor(s % 60) + 'sn';
    return Math.floor(s) + 'sn';
}

/* ---------- URL Önizleme ---------- */
async function fetchURLPreview(url) {
    const box = document.getElementById('url-preview');
    const spinner = document.getElementById('preview-spinner');
    const titleEl = document.getElementById('preview-title');
    const metaEl = document.getElementById('preview-meta');
    const thumbEl = document.getElementById('preview-thumb');

    box.style.display = 'flex';
    spinner.style.display = 'block';
    titleEl.textContent = 'Analiz ediliyor...';
    metaEl.textContent = '';

    try {
        const mediaType = (selectedOpt === 'audio') ? 'audio' : 'video';
        // Eski Hali: const res = await fetch(`http://localhost:8000/api/download...
        const res = await fetch(`/api/download?url=${encodeURIComponent(url)}&media_type=${mediaType}&quality=${selectedQuality}`); const data = await res.json();
        if (!res.ok) throw new Error(data.detail);
        titleEl.textContent = data.title || 'İsimsiz';
        metaEl.textContent = [data.duration, data.views].filter(x => x && x !== '—' && x !== '---').join(' · ');
        if (data.thumbnailUrl) { thumbEl.src = data.thumbnailUrl; thumbEl.style.display = 'block'; }
        else thumbEl.style.display = 'none';
        window._previewData = data;
    } catch (e) {
        box.style.display = 'none';
        window._previewData = null;
    } finally {
        spinner.style.display = 'none';
    }
}

/* ---------- İndirme Geçmişi ---------- */
const HISTORY_KEY = 'sw-history';
function getHistory() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; } }
function saveHistory(list) { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 50))); }
function addToHistory(entry) { const l = getHistory(); l.unshift(entry); saveHistory(l); renderHistory(); }
function updateHistoryStatus(id, status) {
    const l = getHistory(); const item = l.find(x => x.id === id);
    if (item) { item.status = status; saveHistory(l); renderHistory(); }
}
function clearHistory() { localStorage.removeItem(HISTORY_KEY); renderHistory(); showToast('Geçmiş temizlendi', 'blue'); }
function renderHistory() {
    const panel = document.getElementById('history-panel');
    const list = document.getElementById('history-list');
    if (!panel || !list) return;
    const items = getHistory();
    if (!items.length) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    const icon = { done: '✅', downloading: '⏳', error: '❌', cancelled: '🚫' };
    const col = { done: 'var(--success)', downloading: 'var(--accent)', error: 'var(--danger)', cancelled: '#aaa' };
    list.innerHTML = items.map(item => {
        const d = new Date(item.date);
        const ds = d.toLocaleDateString('tr-TR') + ' ' + d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
        return `<div class="history-item">
            <div style="flex:1;min-width:0;">
                <div style="font-size:.82rem;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.filename}</div>
                <div style="font-size:.72rem;color:var(--muted2);margin-top:2px;">${ds}</div>
            </div>
            <div style="font-size:.8rem;color:${col[item.status] || '#aaa'};flex-shrink:0;">${icon[item.status] || '—'}</div>
        </div>`;
    }).join('');
}
document.addEventListener('DOMContentLoaded', renderHistory);

/* ---------- İndirmeyi İptal Et ---------- */
function cancelDownload(dlId) {
    const card = document.getElementById(dlId);
    if (card && card._controller) {
        card._cancelled = true;
        card._controller.abort();
    }
}

/* ---------- FAQ accordion ---------- */
function toggleFaq(item) {
    const isOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
    if (!isOpen) item.classList.add('open');
}

/* ---------- Toast ---------- */
let toastTimer = null;
function showToast(msg, color = 'blue') {
    const toast = document.getElementById('toast');
    const dot = document.getElementById('toast-dot');
    const msgEl = document.getElementById('toast-msg');
    dot.className = 'toast-dot ' + color;
    msgEl.textContent = msg;
    toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

/* ---------- Animated counters ---------- */
function animateCounters() {
    document.querySelectorAll('.stat-num[data-count]').forEach(el => {
        const target = parseInt(el.dataset.count);
        let current = 0;
        const step = Math.ceil(target / 60);
        const timer = setInterval(() => {
            current = Math.min(current + step, target);
            el.textContent = current >= 1000000
                ? (current / 1000000).toFixed(1) + 'M+'
                : current >= 1000
                    ? Math.floor(current / 1000) + 'K+'
                    : current;
            if (current >= target) clearInterval(timer);
        }, 16);
    });
}

/* Intersection observer for counter animation */
const observer = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { animateCounters(); observer.disconnect(); } });
}, { threshold: 0.5 });
const statsBar = document.querySelector('.stats-bar');
if (statsBar) observer.observe(statsBar);

/* ---------- Input Enter key ---------- */
document.getElementById('url-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') startDownload();
});

/* ---------- Thumbnail İndirme ---------- */
async function downloadThumbnail() {
    const url = window._currentVideoUrl;
    if (!url) return;
    showToast('Kapak fotoğrafı indiriliyor...', 'blue');
    try {
        // Eski Hali: const proxyUrl = `http://localhost:8000/api/thumbnail...
        const proxyUrl = `/api/thumbnail?url=${encodeURIComponent(url)}`; const response = await fetch(proxyUrl);
        if (!response.ok) throw new Error('Thumbnail alınamadı.');
        const blob = await response.blob();
        const a = document.createElement('a');
        a.href = window.URL.createObjectURL(blob);
        // Dosya adını header'dan al
        const cd = response.headers.get('content-disposition') || '';
        const match = cd.match(/filename\*?=(?:UTF-8'')?([^;]+)/i);
        a.download = match ? decodeURIComponent(match[1]) : 'thumbnail.jpg';
        document.body.appendChild(a); a.click(); a.remove();
        showToast('Kapak fotoğrafı indirildi ✅', 'green');
    } catch (e) {
        showToast('Hata: ' + e.message, 'red');
    }
}

/* ---------- Video Kırpma ---------- */
async function startClip() {
    const url = window._currentVideoUrl;
    const quality = window._currentQuality || selectedQuality;
    if (!url) { showToast('Önce bir video analiz edin', 'red'); return; }

    const start = document.getElementById('clip-start').value.trim() || '0:00';
    const end = document.getElementById('clip-end').value.trim();
    const btn = document.getElementById('clip-btn');
    const status = document.getElementById('clip-status');

    // Basit format kontrolü
    const timePattern = /^\d{1,2}:\d{2}(:\d{2})?$/;
    if (!timePattern.test(start)) { status.textContent = '⚠️ Başlangıç formatı hatalı. Örnek: 1:30 veya 0:01:30'; status.style.color = 'var(--danger)'; return; }
    if (end && !timePattern.test(end)) { status.textContent = '⚠️ Bitiş formatı hatalı. Örnek: 2:45'; status.style.color = 'var(--danger)'; return; }

    btn.disabled = true;
    btn.textContent = '⏳ İşleniyor...';
    status.textContent = 'Video indiriliyor ve kırpılıyor, lütfen bekleyin...';
    status.style.color = 'var(--muted2)';

    try {
        // Eski Hali: const clipUrl = `http://localhost:8000/api/clip...
        const clipUrl = `/api/clip?url=${encodeURIComponent(url)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&quality=${quality}`;
        // İndirme paneline ekle
        const panel = document.getElementById('downloads-panel');
        const list = document.getElementById('active-downloads-list');
        panel.style.display = 'block';
        const dlId = 'clip-' + Date.now();
        const dlCard = document.createElement('div');
        dlCard.className = 'download-item';
        dlCard.id = dlId;
        dlCard.innerHTML = `
            <div class="dl-header">
                <div class="dl-filename">✂️ Kırpılıyor: ${start} → ${end || 'son'}</div>
                <div class="dl-status" id="status-${dlId}" style="color:var(--accent);">İşleniyor...</div>
            </div>
            <div class="dl-progress-bg"><div class="dl-progress-fill" id="fill-${dlId}" style="width:100%;animation:pulse 1s infinite;"></div></div>
        `;
        list.prepend(dlCard);

        const response = await fetch(clipUrl);
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Kırpma başarısız');
        }

        const blob = await response.blob();
        const cd = response.headers.get('content-disposition') || '';
        const match = cd.match(/filename\*?=(?:UTF-8'')?([^;]+)/i);
        const filename = match ? decodeURIComponent(match[1]) : `clip_${start}-${end}.mp4`;

        const a = document.createElement('a');
        a.href = window.URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();

        document.getElementById(`status-${dlId}`).textContent = 'Tamamlandı ✅';
        document.getElementById(`status-${dlId}`).style.color = 'var(--success)';
        document.getElementById(`fill-${dlId}`).style.animation = 'none';
        document.getElementById(`fill-${dlId}`).style.background = 'var(--success)';
        document.getElementById(`fill-${dlId}`).style.width = '100%';

        status.textContent = `✅ Kırpma tamamlandı! (${start} → ${end || 'son'})`;
        status.style.color = 'var(--success)';
        showToast('Video kırpıldı ve indirildi ✅', 'green');

    } catch (e) {
        status.textContent = '❌ Hata: ' + e.message;
        status.style.color = 'var(--danger)';
        showToast('Kırpma hatası: ' + e.message, 'red');
    } finally {
        btn.disabled = false;
        btn.textContent = '✂️ Kırp ve İndir';
    }
}

/* ---------- Mobil Menü ---------- */
function toggleMobileMenu() {
    const nav = document.querySelector('header nav');
    const btn = document.getElementById('hamburger-btn');

    if (nav.classList.contains('mobile-open')) {
        nav.style.animation = 'menuSlideUp 0.22s cubic-bezier(0.4, 0, 0.2, 1) forwards';
        setTimeout(() => {
            nav.classList.remove('mobile-open');
            nav.style.animation = '';
        }, 200);
        btn.classList.remove('open');
    } else {
        nav.classList.add('mobile-open');
        btn.classList.add('open');
    }
}

// Menü dışına tıklayınca kapat
document.addEventListener('click', function (e) {
    const nav = document.querySelector('header nav');
    const btn = document.getElementById('hamburger-btn');
    if (!nav || !btn) return;
    if (!nav.contains(e.target) && !btn.contains(e.target)) {
        nav.classList.remove('mobile-open');
        btn.classList.remove('open');
    }
});

/* ---------- PWA Service Worker ---------- */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then((reg) => {
                console.log('SW kayıtlı:', reg.scope);
            })
            .catch((err) => {
                console.warn('SW kaydı başarısız:', err);
            });
    });
}

function closeMobileMenuIfOpen() {
    const nav = document.querySelector('header nav');
    const btn = document.getElementById('hamburger-btn');
    if (nav && nav.classList.contains('mobile-open')) {
        nav.style.animation = 'menuSlideUp 0.22s cubic-bezier(0.4, 0, 0.2, 1) forwards';
        setTimeout(() => {
            nav.classList.remove('mobile-open');
            nav.style.animation = '';
        }, 200);
        if (btn) btn.classList.remove('open');
    }
}