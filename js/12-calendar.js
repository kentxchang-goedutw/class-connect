/* ══════════════════════════════════════════════════════════════════
   12-calendar.js  班級日曆（前台月曆與活動顯示）
══════════════════════════════════════════════════════════════════ */

/* ════════ 模組 2：班級日曆 ════════ */
function setupCalendar() {
  APP_STATE.calMonth = new Date(); APP_STATE.calMonth.setDate(1);
  db.collection("calendar").onSnapshot(snap => { APP_STATE.calEvents = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderCalendar(); }, err => console.warn("日曆監聽失敗", err));
}
function calMove(delta) { APP_STATE.calMonth.setMonth(APP_STATE.calMonth.getMonth() + delta); renderCalendar(); }
function renderCalendar() {
  const locked = document.getElementById("calLocked"), grid = document.getElementById("calGrid");
  if (!canView("calendar")) { locked.classList.remove("hidden"); grid.classList.add("hidden"); return; }
  locked.classList.add("hidden"); grid.classList.remove("hidden");
  const m = APP_STATE.calMonth;
  document.getElementById("calLabel").textContent = `${m.getFullYear()}年${m.getMonth()+1}月`;
  const year = m.getFullYear(), month = m.getMonth();
  const first = new Date(year, month, 1).getDay(), days = new Date(year, month + 1, 0).getDate();
  const weekHead = ["日","一","二","三","四","五","六"];
  let html = weekHead.map((w,i) => `<div class="font-bold py-1 ${i===0?'text-rose-400':i===6?'text-blue-400':'text-slate-400'}">${w}</div>`).join("");
  for (let i = 0; i < first; i++) html += "<div></div>";
  for (let d = 1; d <= days; d++) {
    const evs = APP_STATE.calEvents.filter(e => normDate(e.date) === `${year}/${month+1}/${d}`);
    const isToday = todayStr() === `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    html += `<div class="min-h-[3.6rem] rounded-xl border p-1 text-left ${isToday?'border-violet-400 bg-violet-50/70':'border-white/60 bg-white/40'}">
      <div class="text-xs ${isToday?'text-violet-600 font-bold':'text-slate-400'}">${d}</div>
      ${evs.map(e => `<button onclick='showEvent(${JSON.stringify(JSON.stringify(e))})' class="block w-full truncate text-[11px] leading-tight mt-0.5 px-1 py-0.5 rounded-lg bg-violet-200/80 text-violet-800 hover:bg-violet-300">${escapeHtml(e.title||"活動")}</button>`).join("")}
    </div>`;
  }
  grid.innerHTML = html;
}
function normDate(s = "") { const m = String(s).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/); return m ? `${+m[1]}/${+m[2]}/${+m[3]}` : s; }
function showEvent(json) {
  const e = JSON.parse(json);
  const linkHtml = e.url ? `<a href="${escapeHtml(e.url)}" target="_blank" rel="noopener" class="inline-block mt-2 text-blue-600 underline text-sm">🔗 相關連結</a>` : "";
  showModal(`
    <div class="p-6 space-y-3">
      <div class="flex items-start justify-between gap-3">
        <div><div class="text-xs text-violet-600 font-medium">${escapeHtml(normDate(e.date))}</div><h3 class="text-lg font-bold">${escapeHtml(e.title || "活動")}</h3></div>
        <button onclick="closeModal()" class="text-slate-400 hover:text-slate-600 text-xl">×</button>
      </div>
      <div class="rich-content text-sm text-slate-700 leading-relaxed">${e.desc ? renderRich(e.desc) : '<span class="text-slate-400">（無詳細描述）</span>'}</div>
      ${linkHtml}
    </div>`, { size: "max-w-md" });
}

