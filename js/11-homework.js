/* ══════════════════════════════════════════════════════════════════
   11-homework.js  作業檢核（前台即時查看、教師立即檢核）
══════════════════════════════════════════════════════════════════ */

/* ════════ 作業檢核（前台即時查看） ════════ */
let hwInlineEdit = false;   // 教師主畫面「立即檢核」模式開關
function extractHomework(content = "") {
  const lines = content.split("\n").map(l => l.trim()).filter(Boolean);
  const bullets = lines.filter(l => CB_BULLET.test(l)).map(l => l.replace(CB_BULLET, "").trim()).filter(Boolean);
  return (bullets.length ? bullets : lines);
}
/* 從 Firestore 錯誤訊息中擷取「建立索引」的連結 */
function extractIndexUrl(msg = "") {
  const m = String(msg).match(/https:\/\/console\.firebase\.google\.com\/[^\s)"']+/);
  return m ? m[0] : null;
}
/* 在網頁上直接顯示「如何建立索引」的說明與連結（免進 F12） */
function showIndexHelp(url) {
  showModal(`
    <div class="p-6 space-y-4">
      <div class="flex items-center justify-between"><h3 class="text-lg font-bold">🛠️ 首次使用需建立資料庫索引</h3><button onclick="closeModal()" class="text-slate-400 hover:text-slate-600 text-xl">×</button></div>
      <p class="text-sm text-slate-600 leading-relaxed">「作業檢核」第一次使用時，Firebase 需要您建立一個查詢索引（<b>只需做一次</b>，建立後永久有效，約 1～2 分鐘完成）。</p>
      <ol class="text-sm text-slate-600 list-decimal pl-5 space-y-1">
        <li>點下方按鈕前往 Firebase 主控台（已自動帶入此索引設定）。</li>
        <li>在開啟的頁面點「<b>建立索引 / Create index</b>」。</li>
        <li>等待索引狀態由「建立中」變為「<b>已啟用</b>」後，回到本頁再操作一次即可。</li>
      </ol>
      ${url ? `
        <a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="btn3d b-blue w-full text-center block">前往建立索引 →</a>
        <div class="flex gap-2"><input id="idxUrl" readonly value="${escapeHtml(url)}" class="flex-1 border rounded-xl px-2 py-1.5 text-xs bg-slate-50"><button onclick="copyText(document.getElementById('idxUrl').value,'已複製索引連結')" class="px-3 py-1.5 rounded-xl bg-slate-200 text-sm">複製</button></div>`
        : `<p class="text-xs text-rose-500">未能自動取得索引連結，請至 Firebase 主控台 → Firestore Database → 索引（Indexes），依提示手動建立。</p>`}
    </div>`, { size: "max-w-md" });
}

/* 查詢「前一個上課日」(嚴格早於指定日期、最近一筆有內容的聯絡簿)
   若遇到需建立索引的錯誤，會在畫面上彈出說明並丟出 __INDEX__ 讓呼叫端停止後續流程 */
async function findPrevContactbook(date) {
  try {
    const snap = await db.collection("contactbook")
      .where(firebase.firestore.FieldPath.documentId(), "<", date)
      .orderBy(firebase.firestore.FieldPath.documentId(), "desc").limit(10).get();
    for (const d of snap.docs) {
      const content = d.data().content || "";
      if (content.trim()) return { date: d.id, content };
    }
  } catch (e) {
    console.warn("查前一上課日聯絡簿失敗", e);
    const url = extractIndexUrl(e.message);
    if (url || e.code === "failed-precondition") { showIndexHelp(url); throw new Error("__INDEX__"); }
    throw e;
  }
  return null;
}

let hwTodayUnsub = null;
function setupHomeworkView() {
  if (hwTodayUnsub) hwTodayUnsub();
  const today = todayStr();
  hwTodayUnsub = db.collection("homework").doc(today).onSnapshot(s => { HW_TODAY = s.exists ? s.data() : null; renderHomeworkView(); });
}
/* 切換教師主畫面「立即檢核」模式 */
function toggleHwInline() {
  if (!APP_STATE.isTeacher) { toast("僅老師可即時檢核", "warn"); return; }
  hwInlineEdit = !hwInlineEdit;
  renderHomeworkView();
  toast(hwInlineEdit ? "已開啟即時檢核，點擊欄位即可切換並儲存" : "已結束即時檢核", "info");
}

/* 產生一個半邊的檢核表（students 為該欄學生子集） */
function hwTableHtml(students, items, status, editable, mySeat) {
  const date = todayStr();
  // 編輯模式：欄標題（作業名稱）可點 → 一次改全班該項；座號／姓名可點 → 一次改該生全部作業
  const headCell = (it, idx) => editable
    ? `<th class="hw-th hw-clickable-head" title="點此一次改動全班「${escapeHtml(it)}」的狀態" onclick="cycleHwColumn('${date}',${idx})">${escapeHtml(it)} ⇅</th>`
    : `<th class="hw-th">${escapeHtml(it)}</th>`;
  let html = '<table class="hw-table text-sm"><thead><tr><th class="hw-th-seat">座號</th>' + items.map((it, idx) => headCell(it, idx)).join("") + "</tr></thead><tbody>";
  students.forEach(st => {
    const isMe = mySeat && String(st.seat) === mySeat;
    const nameLabel = `${escapeHtml(st.seat)}${st.hideName ? "" : (st.name ? " " + escapeHtml(st.name) : "")}${isMe ? " ⭐" : ""}`;
    const seatCell = editable
      ? `<td class="hw-td-seat hw-clickable-head" title="點此一次改動 ${nameLabel} 的全部作業狀態" onclick="cycleHwRow('${date}','${escapeHtml(String(st.seat))}')">${nameLabel} ⇅</td>`
      : `<td class="hw-td-seat">${nameLabel}</td>`;
    html += `<tr class="${isMe ? "hw-row-me" : ""}">${seatCell}`;
    items.forEach((it, idx) => {
      const cur = status[st.seat + "_" + idx] || 0;
      html += editable
        ? `<td><button class="hw-cell hw-clickable hw-${cur}" onclick="cycleHw('${date}','${escapeHtml(String(st.seat))}',${idx},${cur})">${HW_STATES[cur].label}</button></td>`
        : `<td><span class="hw-cell hw-${cur}">${HW_STATES[cur].label}</span></td>`;
    });
    html += "</tr>";
  });
  return html + "</tbody></table>";
}

/* 由一組目前狀態值，決定批次點擊後要統一設定成的下一個狀態
   規則：取目前最多數的狀態 +1（循環 0→1→2→3→0），讓一次點擊把整批推進到同一狀態 */
function _nextBatchState(curValues) {
  const count = [0, 0, 0, 0];
  curValues.forEach(v => { count[(Number(v) || 0) % 4]++; });
  let major = 0;
  for (let i = 1; i < 4; i++) if (count[i] > count[major]) major = i;
  return (major + 1) % 4;
}

/* 一次改動「全班」某一項作業的狀態（點欄標題 / 作業名稱） */
window.cycleHwColumn = async function(date, idx) {
  if (!APP_STATE.isTeacher) return;
  const studs = APP_STATE.students || [];
  if (!studs.length) return;
  const status = (HW_TODAY && HW_TODAY.status) || {};
  const next = _nextBatchState(studs.map(st => status[st.seat + "_" + idx] || 0));
  const patch = {};
  studs.forEach(st => { patch[st.seat + "_" + idx] = next; });
  try {
    await db.collection("homework").doc(date).set({ status: patch }, { merge: true });
    const itemName = (HW_TODAY && HW_TODAY.items && HW_TODAY.items[idx]) || "該項作業";
    toast(`已將全班「${itemName}」設為「${HW_STATES[next].label}」`, "success");
  } catch (e) { toast("批次更新失敗：" + e.message, "error"); }
};

/* 一次改動「某位學生」全部作業的狀態（點座號 / 姓名） */
window.cycleHwRow = async function(date, seat) {
  if (!APP_STATE.isTeacher) return;
  const items = (HW_TODAY && HW_TODAY.items) || [];
  if (!items.length) return;
  const status = (HW_TODAY && HW_TODAY.status) || {};
  const next = _nextBatchState(items.map((it, idx) => status[seat + "_" + idx] || 0));
  const patch = {};
  items.forEach((it, idx) => { patch[seat + "_" + idx] = next; });
  try {
    await db.collection("homework").doc(date).set({ status: patch }, { merge: true });
    const stu = (APP_STATE.students || []).find(s => String(s.seat) === String(seat));
    const who = seat + "號" + (stu && stu.name ? " " + stu.name : "");
    toast(`已將 ${who} 全部作業設為「${HW_STATES[next].label}」`, "success");
  } catch (e) { toast("批次更新失敗：" + e.message, "error"); }
};

function renderHomeworkView() {
  const locked = document.getElementById("hwLocked"), wrap = document.getElementById("hwViewWrap"), btn = document.getElementById("hwInlineBtn");
  if (!wrap) return;
  if (!isLoggedIn()) { if (btn) btn.classList.add("hidden"); locked.classList.remove("hidden"); wrap.classList.add("hidden"); return; }
  locked.classList.add("hidden"); wrap.classList.remove("hidden");

  const box = document.getElementById("hwViewBox"), data = HW_TODAY;
  if (!data || !(data.items || []).length) {
    if (btn) btn.classList.add("hidden");
    box.innerHTML = '<p class="text-slate-400 text-sm py-3 text-center">老師尚未建立今日作業檢核。</p>';
    return;
  }
  const items = data.items, status = data.status || {};
  const mySeat = APP_STATE.session ? String(APP_STATE.session.seat) : null;
  const editable = APP_STATE.isTeacher && hwInlineEdit;

  // 老師才顯示「立即檢核」切換鈕
  if (btn) {
    if (APP_STATE.isTeacher) {
      btn.classList.remove("hidden");
      btn.textContent = hwInlineEdit ? "✓ 檢核中（點欄位即存）" : "✏️ 立即檢核";
      btn.classList.toggle("b-emerald", hwInlineEdit);
      btn.classList.toggle("b-amber", !hwInlineEdit);
    } else btn.classList.add("hidden");
  }

  const srcLine = `<div class="text-xs text-slate-500 mb-2">作業來源：<b>${escapeHtml(data.sourceDate || "—")}</b> 聯絡簿${editable ? ' ・<span class="text-emerald-600 font-medium">即時檢核中</span>' : ""}</div>`;

  if (!APP_STATE.isTeacher) {
    // 家長／學生：只顯示自己的作業檢核情形
    const me = APP_STATE.students.filter(s => String(s.seat) === mySeat);
    box.innerHTML = srcLine + (me.length
      ? `<div class="overflow-x-auto">${hwTableHtml(me, items, status, false, mySeat)}</div>`
      : '<p class="text-slate-400 text-sm py-3 text-center">找不到您的座號資料。</p>');
    return;
  }

  // 老師：依人數等分左右二欄顯示全班
  const studs = APP_STATE.students;
  const half = Math.ceil(studs.length / 2);
  const left = studs.slice(0, half), right = studs.slice(half);
  box.innerHTML = srcLine + `<div class="grid grid-cols-2 gap-3 items-start">
    <div class="overflow-x-auto">${hwTableHtml(left, items, status, editable, mySeat)}</div>
    <div class="overflow-x-auto">${right.length ? hwTableHtml(right, items, status, editable, mySeat) : ""}</div>
  </div>`;
}

