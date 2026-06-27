/* ══════════════════════════════════════════════════════════════════
   10-contactbook.js  每日聯絡簿（前台顯示、放大全螢幕、已讀回報）
══════════════════════════════════════════════════════════════════ */

/* ════════ 模組 1：每日聯絡簿 ════════ */
let cbUnsub = null, CB_DATA = null;
function setupContactbook() {
  const dateInput = document.getElementById("cbDate");
  dateInput.value = todayStr(); dateInput.onchange = loadContactbook; loadContactbook();
}
function loadContactbook() {
  if (cbUnsub) cbUnsub();
  const date = document.getElementById("cbDate").value || todayStr();
  cbUnsub = db.collection("contactbook").doc(date).onSnapshot(doc => { CB_DATA = doc.exists ? doc.data() : null; renderContactbook(); });
}
function renderContactbook() {
  const locked = document.getElementById("cbLocked"), body = document.getElementById("cbBody");
  if (!canView("contactbook")) { locked.classList.remove("hidden"); body.classList.add("hidden"); return; }
  locked.classList.add("hidden"); body.classList.remove("hidden");
  document.getElementById("cbContent").innerHTML = CB_DATA?.content ? `<div class="cb-cols">${renderContactbookContent(CB_DATA.content)}</div>` : '<span class="text-slate-400">本日尚無聯絡簿內容。</span>';
  const row = document.getElementById("cbReadRow"), state = document.getElementById("cbReadState"), btn = document.getElementById("cbReadBtn");
  if (APP_STATE.session && CB_DATA) {
    row.classList.remove("hidden");
    const reads = CB_DATA.reads || {};
    if (reads[APP_STATE.session.seat]) { state.textContent = "✅ 您已完成已讀簽章"; btn.classList.add("hidden"); }
    else { state.textContent = "尚未簽章"; btn.classList.remove("hidden"); }
  } else row.classList.add("hidden");

  // 教師：直接在聯絡簿區塊呈現家長已讀狀況
  const rep = document.getElementById("cbReadReport");
  if (rep) {
    if (APP_STATE.isTeacher) {
      rep.classList.remove("hidden");
      rep.innerHTML = `<div class="text-sm font-bold text-sky-700 mb-2">📊 家長已讀狀況</div>${readReportHtml(CB_DATA?.reads || {})}`;
    } else rep.classList.add("hidden");
  }
}
/* 已讀/未讀座號報表 HTML（教師端共用） */
function readReportHtml(reads) {
  const readSeats = Object.keys(reads || {});
  const all = APP_STATE.students.map(s => String(s.seat));
  const unread = all.filter(s => !readSeats.includes(s));
  return `<div class="space-y-2 text-sm">
    <div><span class="text-emerald-600 font-medium">✅ 已讀 (${readSeats.length})：</span>${readSeats.length ? readSeats.map(s => `<span class="inline-block bg-emerald-100 text-emerald-700 rounded px-1.5 py-0.5 text-xs m-0.5">${escapeHtml(s)}</span>`).join("") : "<span class='text-slate-400'>無</span>"}</div>
    <div><span class="text-rose-600 font-medium">❌ 未讀 (${unread.length})：</span>${unread.length ? unread.map(s => `<span class="inline-block bg-rose-100 text-rose-700 rounded px-1.5 py-0.5 text-xs m-0.5">${escapeHtml(s)}</span>`).join("") : "<span class='text-slate-400'>全部已讀 🎉</span>"}</div>
  </div>`;
}
/* 可被視為「作業項目」的行首符號：- • * ・ ◦ ‧ ／ 數字編號(1. 1) 1、 (1) ①…) ／ ▪ ◆ ★ 等 */
const CB_BULLET = /^([-－•‧・◦▪◆■●○★☆※*✦✓✔]|\d+[.\)、,．]|[（(]\d+[）)]|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫])\s*/;
function inlineRich(s = "") {
  let h = escapeHtml(s);
  h = h.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  h = h.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  return h;
}
function renderContactbookContent(text = "") {
  const out = []; let idx = 0;
  text.split("\n").forEach(raw => {
    const ln = raw.trim();
    if (!ln) return;
    if (/[:：]\s*$/.test(ln)) {
      // 以「：」結尾的行 → 區段標題（如「今日作業：」）
      out.push(`<div class="cb-head">${inlineRich(ln)}</div>`);
    } else {
      // 其餘每一行 → 一張編號作業卡片（自動去掉開頭既有的符號/編號）
      idx++;
      out.push(`<div class="cb-item"><div class="cb-num">${idx}</div><div class="cb-text">${inlineRich(ln.replace(CB_BULLET, ""))}</div></div>`);
    }
  });
  return out.join("") || '<span class="text-slate-400">本日尚無聯絡簿內容。</span>';
}

/* 全螢幕放大顯示當日聯絡簿，方便學生抄寫；可手動調整字級 */
let cbFontSize = 36; // 放大畫面基準字級(px)，可調整
function openContactbookFullscreen() {
  const date = document.getElementById("cbDate")?.value || todayStr();
  if (!CB_DATA?.content) { toast("本日尚無聯絡簿內容", "warn"); return; }
  const old = document.getElementById("cbFull"); if (old) old.remove();
  const el = document.createElement("div");
  el.id = "cbFull";
  el.className = "fixed inset-0 z-[120] bg-gradient-to-br from-sky-50 via-white to-blue-100 overflow-y-auto";
  el.innerHTML = `
    <div class="sticky top-0 bg-white/90 backdrop-blur px-4 py-3 flex items-center justify-between gap-2 flex-wrap shadow-sm">
      <div class="font-black text-sky-700 text-base md:text-xl">📒 ${escapeHtml(date)}　聯絡簿</div>
      <div class="flex items-center gap-2">
        <span class="text-xs text-slate-400 hidden sm:inline">字級</span>
        <button onclick="cbFontStep(-3)" class="w-9 h-9 rounded-xl bg-sky-100 text-sky-700 font-bold hover:bg-sky-200">A−</button>
        <input id="cbFontRange" type="range" min="20" max="80" value="${cbFontSize}" oninput="cbFontSet(this.value)" class="w-24 sm:w-32 accent-sky-600">
        <button onclick="cbFontStep(3)" class="w-9 h-9 rounded-xl bg-sky-100 text-sky-700 font-bold text-lg hover:bg-sky-200">A+</button>
        <span id="cbFontLabel" class="text-xs text-slate-500 w-10 text-center">${cbFontSize}px</span>
        <button onclick="closeContactbookFullscreen()" class="btn3d b-slate text-sm">✕ 關閉</button>
      </div>
    </div>
    <div id="cbBigContent" class="cb-big max-w-4xl mx-auto px-5 py-8" style="font-size:${cbFontSize}px">${renderContactbookContent(CB_DATA.content)}</div>`;
  document.body.appendChild(el);
  document.addEventListener("keydown", cbFullEsc);
}
function cbFontSet(v) {
  cbFontSize = Math.max(20, Math.min(80, Number(v) || 36));
  const c = document.getElementById("cbBigContent"); if (c) c.style.fontSize = cbFontSize + "px";
  const l = document.getElementById("cbFontLabel"); if (l) l.textContent = cbFontSize + "px";
  const r = document.getElementById("cbFontRange"); if (r) r.value = cbFontSize;
}
function cbFontStep(d) { cbFontSet(cbFontSize + d); }
function closeContactbookFullscreen() {
  const el = document.getElementById("cbFull"); if (el) el.remove();
  document.removeEventListener("keydown", cbFullEsc);
}
function cbFullEsc(e) { if (e.key === "Escape") closeContactbookFullscreen(); }

async function markRead() {
  if (!APP_STATE.session) { toast("請先登入", "warn"); return; }
  const date = document.getElementById("cbDate").value || todayStr();
  try {
    await db.collection("contactbook").doc(date).set({ reads: { [APP_STATE.session.seat]: firebase.firestore.FieldValue.serverTimestamp() } }, { merge: true });
    toast("已記錄您的已讀簽章，謝謝！", "success");
  } catch (e) { toast("簽章失敗：" + e.message, "error"); }
}

