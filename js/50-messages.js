/* ══════════════════════════════════════════════════════════════════
   50-messages.js  私訊（家長 ↔ 老師）：浮動按鈕、對話視窗、Email 通知、後台收件匣
══════════════════════════════════════════════════════════════════ */

/* ════════════════════ ★★ 私訊（家長聯絡老師） ★★ ════════════════════ */

/* 資料更新時的統一刷新（依目前開啟的視窗重繪） */
function onMessagesUpdate() {
  updateFloatBadge();
  updateTeacherFloat();
  renderParentChatBody();
  if (document.getElementById("admMsgArea")) renderAdminMsgArea();
  if (document.getElementById("admThreadBody")) renderAdminThreadBody();
}

/* 訊息泡泡列；opts.recall=true 時顯示「收回」按鈕 */
function msgBubble(m, mine, opts = {}) {
  const t = m.createdAt?.toDate ? m.createdAt.toDate().toLocaleString("zh-TW", { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit" }) : "傳送中…";
  const recall = opts.recall ? `<button onclick="recallMsg('${m.id}')" class="ml-2 text-[10px] underline ${mine ? "text-indigo-100" : "text-slate-400"} hover:opacity-75">收回</button>` : "";
  return `<div class="flex ${mine ? "justify-end" : "justify-start"}">
    <div class="max-w-[78%] ${mine ? "bg-indigo-500 text-white" : "bg-white text-slate-700 border"} rounded-2xl px-3 py-2 text-sm shadow-sm">
      <div class="whitespace-pre-wrap break-words">${escapeHtml(m.text || "")}</div>
      <div class="text-[10px] ${mine ? "text-indigo-100" : "text-slate-400"} mt-1 text-right">${mine ? "" : "老師 · "}${t}${recall}</div>
    </div></div>`;
}

/* ── 家長端：浮動按鈕未讀數 ── */
function updateFloatBadge() {
  const badge = document.getElementById("floatBadge"); if (!badge) return;
  const seat = APP_STATE.session ? String(APP_STATE.session.seat) : null;
  if (!seat) { badge.classList.add("hidden"); return; }
  const n = MSG_DATA.filter(m => String(m.seat) === seat && m.from === "teacher" && !m.readByParent).length;
  if (n > 0) { badge.textContent = n; badge.classList.remove("hidden"); } else badge.classList.add("hidden");
}

/* ── 家長端：開啟與老師的對話視窗 ── */
function openParentChat() {
  if (!APP_STATE.session) { toast("請先以家長／學生身分登入", "warn"); return; }
  showModal(`
    <div class="flex flex-col max-h-[85vh]">
      <div class="px-5 py-4 border-b flex items-center justify-between shrink-0">
        <h3 class="font-bold">💬 聯絡老師</h3>
        <button onclick="closeModal()" class="text-slate-400 hover:text-slate-600 text-xl">×</button>
      </div>
      <div id="pChatBody" class="px-4 py-4 overflow-y-auto space-y-2 bg-slate-50" style="min-height:240px;max-height:55vh"></div>
      <div class="p-3 border-t flex gap-2 shrink-0">
        <input id="pChatInput" class="flex-1 border rounded-xl px-3 py-2 text-sm" placeholder="輸入訊息給老師…" />
        <button id="pChatSend" class="btn3d b-indigo text-sm">送出</button>
      </div>
    </div>`, { size: "max-w-md" });
  renderParentChatBody();
  markTeacherMsgsRead();
  document.getElementById("pChatSend").onclick = sendParentMsg;
  document.getElementById("pChatInput").addEventListener("keydown", e => { if (e.key === "Enter") sendParentMsg(); });
}
function renderParentChatBody() {
  const box = document.getElementById("pChatBody"); if (!box) return;
  const seat = APP_STATE.session ? String(APP_STATE.session.seat) : null; if (!seat) return;
  const msgs = MSG_DATA.filter(m => String(m.seat) === seat);
  if (!msgs.length) { box.innerHTML = '<p class="text-center text-slate-400 text-sm py-6">尚無訊息，傳送第一則訊息給老師吧！</p>'; return; }
  box.innerHTML = msgs.map(m => msgBubble(m, m.from === "parent")).join("");
  box.scrollTop = box.scrollHeight;
}
async function sendParentMsg() {
  const input = document.getElementById("pChatInput"); const text = input.value.trim(); if (!text) return;
  const s = APP_STATE.session;
  input.value = "";
  try {
    await db.collection("messages").add({ seat: s.seat, name: s.name || "", from: "parent", text, readByTeacher: false, readByParent: true, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    maybeEmailTeacher(s, text); // 視老師設定自動寄信通知
  } catch (e) { toast("傳送失敗：" + e.message, "error"); input.value = text; }
}
async function markTeacherMsgsRead() {
  const seat = APP_STATE.session ? String(APP_STATE.session.seat) : null; if (!seat) return;
  const unread = MSG_DATA.filter(m => String(m.seat) === seat && m.from === "teacher" && !m.readByParent);
  if (!unread.length) return;
  try { const batch = db.batch(); unread.forEach(m => batch.update(db.collection("messages").doc(m.id), { readByParent: true })); await batch.commit(); } catch (e) {}
}

/* ── 自動寄 Email 給老師（FormSubmit 免費服務，免後端） ── */
const MAIL_THROTTLE_MS = 10 * 60 * 1000; // 同一家長 10 分鐘內只寄一次通知信
async function maybeEmailTeacher(session, text) {
  const cfg = APP_STATE.config || {};
  if (!cfg.autoEmail || !cfg.mailKey) return;

  // 節流：第一則私訊寄信後，同座號家長 10 分鐘內的後續私訊不再寄
  const seat = String(session.seat);
  const ref = db.collection("mailThrottle").doc(seat);
  try {
    const snap = await ref.get();
    const last = snap.exists ? Number(snap.data().lastAt || 0) : 0;
    if (last && (Date.now() - last) < MAIL_THROTTLE_MS) return; // 仍在 10 分鐘冷卻內 → 不寄
    await ref.set({ lastAt: Date.now(), seat }, { merge: true });   // 記錄本次寄信時間
  } catch (e) { console.warn("通知節流讀寫失敗，仍嘗試寄信", e); }

  try {
    await fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        access_key: cfg.mailKey,
        from_name: "班級親師互動網",
        subject: `【${cfg.className || "班級親師網"}】${session.seat}號 ${session.name || ""} 傳來私訊`,
        座號: String(session.seat), 姓名: session.name || "（未提供）", 訊息內容: text,
        備註: "為避免短時間內重複通知，同一位家長 10 分鐘內的後續訊息不會再寄信，請登入系統查看完整對話。"
      })
    });
  } catch (e) { console.warn("自動寄信失敗", e); }
}

/* 用「已儲存」的設定寄測試信，走與家長私訊完全相同的通知路徑 */
async function testSavedNotify() {
  const cfg = APP_STATE.config || {};
  if (!cfg.mailKey) { toast("尚未儲存 Access Key，請先填入並按「儲存設定」", "warn"); return; }
  toast("以已儲存設定寄送測試中…", "info");
  try {
    const res = await fetch("https://api.web3forms.com/submit", {
      method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ access_key: cfg.mailKey, from_name: "班級親師互動網", subject: `【${cfg.className || "班級親師網"}】通知測試（模擬家長私訊）`, 座號: "00", 姓名: "測試家長", 訊息內容: "這是一封模擬家長私訊的通知測試。若您收到，代表家長私訊通知已正常運作。" })
    });
    const data = await res.json().catch(() => ({}));
    if (data && data.success === true) toast("已寄出，請至信箱（含垃圾郵件匣）查收", "success");
    else toast("寄送失敗：" + ((data && data.message) || "請確認 Access Key 是否正確"), "error");
  } catch (e) { toast("連線失敗：" + e.message, "error"); }
}

/* 老師主動發送測試信（Web3Forms），立即確認是否收得到 */
async function testTeacherEmail() {
  const key = (document.getElementById("setMailKey")?.value || "").trim();
  if (!key) { toast("請先填入 Web3Forms Access Key", "warn"); return; }
  toast("寄送測試信中…", "info");
  let data = {};
  try {
    const res = await fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ access_key: key, from_name: "班級親師互動網", subject: "【班級親師網】通知信測試", 訊息: "這是一封測試信。若您收到此信，表示家長私訊通知已可正常運作。" })
    });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    showModal(`
      <div class="p-6 space-y-3">
        <h3 class="text-lg font-bold text-rose-600">✉️ 寄送失敗</h3>
        <p class="text-sm text-slate-600">無法連線到寄信服務：${escapeHtml(e.message)}</p>
        <p class="text-xs text-slate-400">請檢查網路連線；若在校園網路，外連寄信服務可能被阻擋，可改用手機網路或其他網路再試。</p>
        <div class="text-right"><button onclick="closeModal()" class="btn3d b-blue text-sm">知道了</button></div>
      </div>`, { size: "max-w-md" });
    return;
  }
  const ok = data && data.success === true;
  showModal(`
    <div class="p-6 space-y-3">
      <h3 class="text-lg font-bold">✉️ 通知信測試結果</h3>
      ${ok ? `
        <p class="text-sm text-emerald-700">✅ 已成功寄出測試信，請至您申請 Key 時所用的信箱查收。</p>
        <p class="text-xs text-slate-500">若收件匣沒看到，請檢查「<b>垃圾郵件／促銷內容</b>」。看到此信即代表通知功能已可使用，記得勾選「自動寄通知信」並按「儲存設定」。</p>`
      : `
        <p class="text-sm text-rose-600">寄送未成功：${escapeHtml((data && data.message) || "請確認 Access Key 是否正確")}</p>
        <ol class="text-sm list-decimal pl-5 space-y-1 text-slate-600">
          <li>請至 <a href="https://web3forms.com" target="_blank" rel="noopener" class="underline text-blue-600">web3forms.com</a> 重新確認您的 <b>Access Key</b> 是否正確、完整。</li>
          <li>確認申請 Key 時填的 Email 沒有打錯。</li>
          <li>更正後再按一次「✉️ 測試」。</li>
        </ol>`}
      <div class="text-right"><button onclick="closeModal()" class="btn3d b-blue text-sm">知道了</button></div>
    </div>`, { size: "max-w-md" });
}

/* ── 老師端：私訊清單（依座號分組） ── */
function adminMessages(body) {
  THREAD_RETURN = () => { openAdmin(); adminGoTab(7); };
  const cfg = APP_STATE.config || {};
  body.innerHTML = `
    <div class="space-y-3">
      <p class="text-xs text-slate-500">點選座號可查看完整對話並回覆。${cfg.autoEmail && cfg.mailKey ? "Email 自動通知：<b>已開啟</b>" : '（尚未開啟 Email 自動通知，可至「設定」分頁設定）'}</p>
      <div id="admMsgArea"></div>
    </div>`;
  renderAdminMsgArea();
}
function renderAdminMsgArea() {
  const area = document.getElementById("admMsgArea"); if (!area) return;
  const bySeat = {};
  MSG_DATA.forEach(m => { const k = String(m.seat); (bySeat[k] = bySeat[k] || []).push(m); });
  const seats = Object.keys(bySeat).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!seats.length) { area.innerHTML = '<p class="text-slate-400 text-sm py-6 text-center">目前沒有家長私訊。</p>'; return; }
  area.innerHTML = `<div class="space-y-2">${seats.map(seat => {
    const msgs = bySeat[seat].slice().sort((a, b) => (a.createdAt?.seconds || 9e9) - (b.createdAt?.seconds || 9e9));
    const last = msgs[msgs.length - 1];
    const unread = msgs.filter(m => m.from === "parent" && !m.readByTeacher).length;
    const stu = APP_STATE.students.find(s => String(s.seat) === seat);
    const nm = stu && !stu.hideName ? (stu.name || "") : "";
    return `<button onclick="openAdminThread('${escapeHtml(seat)}')" class="w-full text-left border rounded-xl p-3 hover:bg-slate-50 flex items-center justify-between gap-2">
      <div class="min-w-0"><div class="font-medium text-sm">${escapeHtml(seat)}號 ${escapeHtml(nm)}</div><div class="text-xs text-slate-400 truncate">${last.from === "teacher" ? "我：" : ""}${escapeHtml(last.text || "")}</div></div>
      ${unread ? `<span class="bg-rose-500 text-white text-xs font-bold rounded-full px-2 py-0.5 shrink-0">${unread}</span>` : ""}
    </button>`;
  }).join("")}</div>`;
}

/* ── 老師端：開啟某座號對話並回覆 ── */
function openAdminThread(seat) {
  THREAD_SEAT = String(seat);
  const stu = APP_STATE.students.find(s => String(s.seat) === THREAD_SEAT);
  const nm = stu && !stu.hideName ? (stu.name || "") : "";
  showModal(`
    <div class="flex flex-col max-h-[85vh]">
      <div class="px-5 py-4 border-b flex items-center justify-between shrink-0">
        <h3 class="font-bold">💬 ${escapeHtml(seat)}號 ${escapeHtml(nm)}</h3>
        <div class="flex items-center gap-2">
          <button onclick="exportThreadHtml('${escapeHtml(String(seat))}')" class="text-xs px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200">⬇ 匯出HTML</button>
          <button onclick="threadBack()" class="text-slate-400 hover:text-slate-600 text-xl">×</button>
        </div>
      </div>
      <div id="admThreadBody" class="px-4 py-4 overflow-y-auto space-y-2 bg-slate-50" style="min-height:240px;max-height:55vh"></div>
      <div class="p-3 border-t flex gap-2 shrink-0">
        <input id="admReplyInput" class="flex-1 border rounded-xl px-3 py-2 text-sm" placeholder="回覆家長…" />
        <button id="admReplySend" class="btn3d b-indigo text-sm">回覆</button>
      </div>
    </div>`, { size: "max-w-md", noBackdropClose: true });
  renderAdminThreadBody();
  markParentMsgsRead(THREAD_SEAT);
  document.getElementById("admReplySend").onclick = sendAdminReply;
  document.getElementById("admReplyInput").addEventListener("keydown", e => { if (e.key === "Enter") sendAdminReply(); });
}
function renderAdminThreadBody() {
  const box = document.getElementById("admThreadBody"); if (!box || !THREAD_SEAT) return;
  const msgs = MSG_DATA.filter(m => String(m.seat) === THREAD_SEAT).slice().sort((a, b) => (a.createdAt?.seconds || 9e9) - (b.createdAt?.seconds || 9e9));
  box.innerHTML = msgs.length ? msgs.map(m => msgBubble(m, m.from === "teacher", { recall: m.from === "teacher" })).join("") : '<p class="text-center text-slate-400 text-sm py-6">尚無訊息。</p>';
  box.scrollTop = box.scrollHeight;
}
async function sendAdminReply() {
  const input = document.getElementById("admReplyInput"); const text = input.value.trim(); if (!text) return;
  input.value = "";
  try { await db.collection("messages").add({ seat: THREAD_SEAT, from: "teacher", text, readByTeacher: true, readByParent: false, createdAt: firebase.firestore.FieldValue.serverTimestamp() }); }
  catch (e) { toast("回覆失敗：" + e.message, "error"); input.value = text; }
}
async function markParentMsgsRead(seat) {
  const unread = MSG_DATA.filter(m => String(m.seat) === String(seat) && m.from === "parent" && !m.readByTeacher);
  if (!unread.length) return;
  try { const batch = db.batch(); unread.forEach(m => batch.update(db.collection("messages").doc(m.id), { readByTeacher: true })); await batch.commit(); } catch (e) {}
}

/* 關閉對話串時的返回行為 */
function threadBack() { if (typeof THREAD_RETURN === "function") THREAD_RETURN(); else closeModal(); }

/* 老師收回（永久移除）訊息；刪除後家長端與老師端皆不再顯示，且無任何收回提示 */
async function recallMsg(id) {
  if (!APP_STATE.isTeacher) return;
  if (!await confirmDialog("收回訊息", "收回後此訊息將永久移除，家長端也不會看到任何痕跡。確定收回？", { okText: "收回", danger: true })) return;
  try { await db.collection("messages").doc(id).delete(); toast("訊息已收回", "info"); }
  catch (e) { toast("收回失敗：" + e.message, "error"); }
}

/* 老師匯出某座號家長的完整私訊紀錄為 HTML（含發訊時間） */
function exportThreadHtml(seat) {
  const msgs = MSG_DATA.filter(m => String(m.seat) === String(seat)).slice().sort((a, b) => (a.createdAt?.seconds || 9e9) - (b.createdAt?.seconds || 9e9));
  if (!msgs.length) { toast("此座號沒有訊息可匯出", "warn"); return; }
  const stu = APP_STATE.students.find(s => String(s.seat) === String(seat));
  const nm = stu ? (stu.name || "") : "";
  const cls = APP_STATE.config?.className || "班級親師網";
  const rows = msgs.map(m => {
    const t = m.createdAt?.toDate ? m.createdAt.toDate().toLocaleString("zh-TW") : "";
    const who = m.from === "teacher" ? "老師" : `${escapeHtml(String(seat))}號家長`;
    const side = m.from === "teacher" ? "teacher" : "parent";
    return `<div class="row ${side}"><div class="bubble"><div class="meta">${who}　${escapeHtml(t)}</div><div class="text">${escapeHtml(m.text || "").replace(/\n/g, "<br>")}</div></div></div>`;
  }).join("\n");
  const html = `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(cls)}－${escapeHtml(String(seat))}號私訊紀錄</title>
<style>
  body{font-family:"Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif;background:#f1f5f9;color:#334155;margin:0;padding:24px}
  .wrap{max-width:680px;margin:0 auto}
  h1{font-size:18px;margin:0 0 4px}
  .sub{color:#64748b;font-size:13px;margin-bottom:20px}
  .row{display:flex;margin:12px 0}
  .row.teacher{justify-content:flex-end}
  .bubble{max-width:75%;padding:9px 13px;border-radius:16px;font-size:14px;line-height:1.55;box-shadow:0 1px 2px rgba(0,0,0,.08)}
  .parent .bubble{background:#fff;border:1px solid #e2e8f0}
  .teacher .bubble{background:#6366f1;color:#fff}
  .meta{font-size:11px;opacity:.75;margin-bottom:3px}
  .text{white-space:normal;word-break:break-word}
  footer{text-align:center;color:#94a3b8;font-size:11px;margin-top:24px}
</style></head><body><div class="wrap">
  <h1>📨 ${escapeHtml(cls)}　私訊紀錄</h1>
  <div class="sub">座號 ${escapeHtml(String(seat))}　${escapeHtml(nm)}　・　共 ${msgs.length} 則　・　匯出時間：${new Date().toLocaleString("zh-TW")}</div>
  ${rows}
  <footer>本紀錄由班級親師互動網匯出</footer>
</div></body></html>`;
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `私訊紀錄_${seat}號${nm ? "_" + nm : ""}.html`;
  a.click();
  toast("HTML 紀錄已下載", "success");
}

/* ── 老師端：浮動「家長私訊」收件匣 ── */
function openTeacherInbox() {
  if (!APP_STATE.isTeacher) { toast("請先以老師身分登入", "warn"); return; }
  THREAD_RETURN = openTeacherInbox; // 對話串關閉後回到此收件匣
  showModal(`
    <div class="flex flex-col max-h-[85vh]">
      <div class="px-5 py-4 border-b flex items-center justify-between shrink-0">
        <h3 class="font-bold">📨 家長私訊</h3>
        <button onclick="closeModal()" class="text-slate-400 hover:text-slate-600 text-xl">×</button>
      </div>
      <div class="px-4 py-4 overflow-y-auto" style="max-height:72vh">
        <p class="text-xs text-slate-500 mb-3">點選座號可查看完整對話並回覆。<span class="text-rose-500">紅＝未讀</span>，<span class="text-amber-600">琥珀＝等待您回覆</span>。</p>
        <div id="admMsgArea"></div>
      </div>
    </div>`, { size: "max-w-md" });
  renderAdminMsgArea();
}

/* ── 老師端：浮動按鈕未讀／未回覆數 ── */
function updateTeacherFloat() {
  const btn = document.getElementById("floatTeacher"); if (!btn) return;
  if (!APP_STATE.isTeacher) { btn.classList.add("hidden"); return; }
  btn.classList.remove("hidden");
  // 未讀家長私訊（家長傳來且老師尚未讀）
  const unread = MSG_DATA.filter(m => m.from === "parent" && !m.readByTeacher).length;
  // 未回覆：每個座號的最後一則訊息為家長者（仍等待老師回覆）
  const bySeat = {};
  MSG_DATA.forEach(m => { const k = String(m.seat); (bySeat[k] = bySeat[k] || []).push(m); });
  let unreplied = 0;
  Object.values(bySeat).forEach(arr => { arr.sort((a, b) => (a.createdAt?.seconds || 9e9) - (b.createdAt?.seconds || 9e9)); if (arr.length && arr[arr.length - 1].from === "parent") unreplied++; });
  const ub = document.getElementById("ftUnread"), rb = document.getElementById("ftUnreplied");
  if (unread > 0) { ub.textContent = unread; ub.classList.remove("hidden"); } else ub.classList.add("hidden");
  if (unreplied > 0) { rb.textContent = unreplied; rb.classList.remove("hidden"); } else rb.classList.add("hidden");
  btn.title = `家長私訊　未讀 ${unread}　未回覆 ${unreplied}`;
}
