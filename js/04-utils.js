/* ══════════════════════════════════════════════════════════════════
   04-utils.js  共用工具：日期、HTML 跳脫、富文本、圖片壓縮
══════════════════════════════════════════════════════════════════ */

/* ════════ 工具：日期、富文本、圖片壓縮 ════════ */
function todayStr(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function escapeHtml(s = "") { return String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }
function renderRich(text = "") {
  let html = escapeHtml(text);
  html = html.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  html = html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  const lines = html.split("\n"); let out = "", inList = false;
  for (const ln of lines) {
    if (/^\s*[-•]\s+/.test(ln)) { if (!inList) { out += "<ul>"; inList = true; } out += "<li>" + ln.replace(/^\s*[-•]\s+/, "") + "</li>"; }
    else { if (inList) { out += "</ul>"; inList = false; } out += ln + "<br/>"; }
  }
  if (inList) out += "</ul>";
  return out;
}
function compressImage(file, maxW = 800, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject; img.src = e.target.result;
    };
    reader.onerror = reject; reader.readAsDataURL(file);
  });
}

