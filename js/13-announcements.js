/* ══════════════════════════════════════════════════════════════════
   13-announcements.js  公告與榮譽榜（前台顯示、看圖）
══════════════════════════════════════════════════════════════════ */

/* ════════ 模組 3：公告與榮譽榜 ════════ */
let ANN_DATA = [];
function setupAnnouncements() {
  db.collection("announcements").orderBy("createdAt", "desc").onSnapshot(snap => { ANN_DATA = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderAnnouncements(); }, err => console.warn("公告監聽失敗", err));
}
function renderAnnouncements() {
  const locked = document.getElementById("annLocked"), list = document.getElementById("annList");
  if (!canView("announcements")) { locked.classList.remove("hidden"); list.classList.add("hidden"); return; }
  locked.classList.add("hidden"); list.classList.remove("hidden");
  const visible = ANN_DATA.filter(a => !a.hidden);
  if (!visible.length) { list.innerHTML = '<p class="text-center text-slate-400 text-sm py-6">目前沒有公告。</p>'; return; }
  list.innerHTML = visible.map(a => {
    const imgs = (a.images || []).map(src => '<img src="' + src + '" class="rounded-xl w-full max-h-72 object-cover cursor-pointer" onclick="viewImage(\'' + src + '\')" />').join("");
    const date = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate().toLocaleDateString("zh-TW") : "";
    const hasBody = (a.content || "").trim() || imgs;
    const bodyHtml = hasBody
      ? '<div class="px-4 pb-4 pt-2 space-y-2 border-t border-slate-100">' +
          '<div class="rich-content text-sm text-slate-600 leading-relaxed">' + renderRich(a.content || "") + '</div>' +
          (imgs ? '<div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">' + imgs + '</div>' : '') +
        '</div>'
      : '';
    return '<article class="bg-white/60 border border-white/70 rounded-2xl shadow-sm overflow-hidden">' +
      '<details class="ann-details">' +
        '<summary class="flex items-center justify-between gap-2 px-4 py-3 cursor-pointer list-none select-none hover:bg-white/50 transition-colors">' +
          '<div class="flex items-center gap-2 min-w-0 flex-1">' +
            '<span class="ann-arrow text-slate-400 shrink-0" style="transition:transform .2s">▶</span>' +
            '<h3 class="font-bold text-rose-800 truncate text-left flex-1">' + escapeHtml(a.title || "公告") + '</h3>' +
          '</div>' +
          '<span class="text-xs text-slate-400 shrink-0">' + date + '</span>' +
        '</summary>' +
        bodyHtml +
      '</details>' +
    '</article>';
  }).join("");

  // 展開/收合時旋轉箭頭
  list.querySelectorAll(".ann-details").forEach(function(det) {
    det.addEventListener("toggle", function() {
      var arrow = this.querySelector(".ann-arrow");
      if (arrow) arrow.style.transform = this.open ? "rotate(90deg)" : "";
    });
  });
}
function viewImage(src) { showModal('<div class="p-2"><img src="' + src + '" class="rounded-2xl w-full" /><div class="text-center pt-2"><button onclick="closeModal()" class="px-4 py-2 text-sm rounded-xl bg-slate-100">關閉</button></div></div>', { size: "max-w-2xl" }); }
