/* ══════════════════════════════════════════════════════════════════
   30-admin.js  老師後台：分頁框架、班級設定/權限、學生帳號、各模組後台管理
══════════════════════════════════════════════════════════════════ */

/* ════════════════════ ★★ 老師後台 ★★ ════════════════════ */
function openAdmin() {
  if (!APP_STATE.isTeacher) { toast("請先以老師身分登入", "warn"); return; }
  // 每次開啟後台時執行自動刪除檢查
  if (typeof runAllAutoDel === "function") runAllAutoDel().catch(e => console.warn("自動刪除失敗", e));
  showModal(`
    <div class="flex flex-col max-h-[90vh]">
      <div class="px-6 py-4 border-b flex items-center justify-between shrink-0"><h3 class="text-lg font-bold">🛠️ 老師後台</h3><button onclick="closeModal()" class="text-slate-400 hover:text-slate-600 text-xl">×</button></div>
      <div class="px-4 pt-3 shrink-0">
        <div class="flex gap-1 text-xs overflow-x-auto pb-2" id="adminTabs">
          ${["設定","學生帳號","聯絡簿","作業檢核","公告","日曆","回條","私訊","資源連結","小考成績","加扣分","座位表","小工具"].map((t,i)=>`<button data-tab="${i}" class="admin-tab px-3 py-1.5 rounded-xl whitespace-nowrap ${i===0?'bg-slate-800 text-white':'bg-slate-100 text-slate-600'}">${t}</button>`).join("")}
        </div>
      </div>
      <div id="adminBody" class="px-6 py-4 overflow-y-auto"></div>
    </div>`, { size: "max-w-2xl", noBackdropClose: true });
  document.querySelectorAll(".admin-tab").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".admin-tab").forEach(b => b.className = "admin-tab px-3 py-1.5 rounded-xl whitespace-nowrap bg-slate-100 text-slate-600");
      btn.className = "admin-tab px-3 py-1.5 rounded-xl whitespace-nowrap bg-slate-800 text-white";
      renderAdminTab(+btn.dataset.tab);
    };
  });
  renderAdminTab(0);
}
function adminGoTab(i) { const b = document.querySelector(`[data-tab="${i}"]`); if (b) b.click(); }
function renderAdminTab(i) {
  const body = document.getElementById("adminBody");
  if (i === 0) adminSettings(body);
  if (i === 1) adminStudents(body);
  if (i === 2) adminContactbook(body);
  if (i === 3) adminHomework(body);
  if (i === 4) adminAnnouncements(body);
  if (i === 5) adminCalendar(body);
  if (i === 6) adminSlips(body);
  if (i === 7) adminMessages(body);
  if (i === 8) adminResources(body);
  if (i === 9) adminQuiz(body);
  if (i === 10 && typeof adminPoints === "function") adminPoints(body);
  if (i === 11 && typeof adminSeating === "function") adminSeating(body);
  if (i === 12) adminTools(body);
}

function adminTools(body) {
  body.innerHTML = `
    <div class="space-y-4">
      <p class="text-sm text-slate-500">課堂小工具（隨機抽人、倒數計時器）的存取權限設定。</p>
      <div class="flex items-center justify-between border rounded-xl px-3 py-2">
        <span class="text-sm">課堂小工具</span>
        <select id="adminToolsPerm" class="text-sm border rounded-lg px-2 py-1">
          <option value="off">🚫 關閉</option>
          <option value="public">🌐 公開瀏覽</option>
          <option value="login" selected>🔒 登入瀏覽</option>
        </select>
      </div>
      <button onclick="saveToolsPerm()" class="btn3d b-indigo text-sm">💾 儲存設定</button>
      <div class="bg-violet-50 border border-violet-100 rounded-xl p-3 text-xs text-violet-700 space-y-1">
        <p>🎰 <b>隨機抽人</b>：從班級學生清單隨機抽出一位，支援「不重複」模式，已抽過的學生排除在外。</p>
        <p>⏱️ <b>倒數計時器</b>：可設定 1–30 分鐘或自訂時間，支援全螢幕大字顯示；倒數 10 秒內會有音效提示。</p>
      </div>
    </div>`;

  // 讀取現有設定
  var perm = ((APP_STATE.config || {}).perms || {}).tools || "login";
  var sel = document.getElementById("adminToolsPerm");
  if (sel) sel.value = perm;
}

window.saveToolsPerm = function() {
  var sel = document.getElementById("adminToolsPerm");
  if (!sel) return;
  var perm = sel.value;
  db.collection("classroom").doc("config").set(
    { perms: { tools: perm } }, { merge: true }
  ).then(function() { toast("已儲存小工具權限設定", "success"); })
   .catch(function(err) { toast("儲存失敗：" + err.message, "error"); });
};

/* ── 後台：班級設定 + 權限矩陣 ── */
function adminSettings(body) {
  const cfg = APP_STATE.config || {}, perms = cfg.perms || DEFAULT_PERMS;
  body.innerHTML = `
    <div class="space-y-5">
      <div><label class="text-sm font-medium">班級名稱</label><input id="setName" class="w-full mt-1 border rounded-xl px-3 py-2 text-sm" value="${escapeHtml(cfg.className||"")}" placeholder="例：陽光國小三年一班" /></div>
      <div>
        <label class="text-sm font-medium">功能模組啟用與權限</label>
        <p class="text-xs text-slate-400 mb-2">關閉＝主畫面完全不顯示；登入瀏覽＝未登入者看不到此模組，登入後才出現。</p>
        <div class="mt-2 space-y-2">
          ${Object.keys(MODULE_NAMES).map(mod => { const cur = perms[mod] || DEFAULT_PERMS[mod] || "public"; return `
            <div class="flex items-center justify-between border rounded-xl px-3 py-2">
              <span class="text-sm">${MODULE_NAMES[mod]}${mod==="slips"?' <span class="text-xs text-rose-500">(建議登入)</span>':''}</span>
              <select data-perm="${mod}" class="text-sm border rounded-lg px-2 py-1"><option value="off" ${cur==="off"?"selected":""}>🚫 關閉</option><option value="public" ${cur==="public"?"selected":""}>🌐 公開瀏覽</option><option value="login" ${cur==="login"?"selected":""}>🔒 登入瀏覽</option></select>
            </div>`; }).join("")}
        </div>
      </div>
      <div>
        <label class="text-sm font-medium">主畫面模組顯示順序</label>
        <p class="text-xs text-slate-400 mb-2">用 ▲▼ 調整各模組在主畫面由上到下的排列順序。</p>
        <div id="orderList" class="space-y-2"></div>
      </div>
      <div><label class="text-sm font-medium">變更老師後台密碼</label><input id="setTpwd" type="text" class="w-full mt-1 border rounded-xl px-3 py-2 text-sm" placeholder="留空表示不變更" /></div>
      <div class="border-t pt-4 space-y-2">
        <label class="text-sm font-medium">📧 家長私訊 Email 通知（Web3Forms）</label>
        <div class="flex gap-2">
          <input id="setMailKey" type="text" class="flex-1 border rounded-xl px-3 py-2 text-sm font-mono" value="${escapeHtml(cfg.mailKey||"")}" placeholder="貼上 Web3Forms Access Key" />
          <button type="button" onclick="testTeacherEmail()" class="btn3d b-emerald text-xs whitespace-nowrap">✉️ 測試</button>
        </div>
        <input id="setEmail" type="email" class="w-full border rounded-xl px-3 py-2 text-sm" value="${escapeHtml(cfg.teacherEmail||"")}" placeholder="您申請 Key 時用的 Email（顯示用，選填）" />
        <label class="flex items-center gap-2 text-sm text-slate-600"><input id="setAutoEmail" type="checkbox" class="rounded" ${cfg.autoEmail?"checked":""}/> 家長傳送私訊時，自動寄一封通知信</label>
        <div class="text-xs px-2.5 py-2 rounded-lg ${cfg.mailKey ? (cfg.autoEmail ? "bg-emerald-50 text-emerald-700" : "bg-amber-100 text-amber-700") : "bg-rose-50 text-rose-600"}">
          目前<b>已儲存</b>狀態：${cfg.mailKey ? (cfg.autoEmail ? "🟢 已啟用自動通知" : "🟡 已存 Key，但「自動寄通知信」未勾選") : "🔴 尚未儲存 Access Key（測試成功後請務必按下方「儲存設定」）"}
          ${cfg.mailKey ? ' ・ <button type="button" onclick="testSavedNotify()" class="underline font-medium">用已儲存設定測試</button>' : ""}
        </div>
        <div class="text-[11px] text-slate-500 leading-relaxed bg-amber-50 border border-amber-100 rounded-lg p-2 space-y-1">
          <p>改用送達率更高、<b>免點啟用信</b>的免費服務 <b>Web3Forms</b>：</p>
          <p>1. 前往 <a href="https://web3forms.com" target="_blank" rel="noopener" class="underline text-amber-700 font-medium">web3forms.com</a>，輸入您的 Email，取得免費 <b>Access Key</b>（畫面會直接顯示）。</p>
          <p>2. 把 Access Key 貼到上方欄位，按 <b>「✉️ 測試」</b> 確認能收到信（首次仍請順手檢查垃圾郵件匣）。</p>
          <p>3. 勾選自動通知並「儲存設定」。<b>通知信會寄到您申請 Key 時所用的 Email。</b></p>
        </div>
      </div>
      <button id="saveSettings" class="btn3d b-blue w-full">儲存設定</button>
    </div>`;
  // 初始化排序暫存並渲染排序清單
  editOrder = (() => {
    const saved = APP_STATE.config?.moduleOrder;
    const o = (Array.isArray(saved) && saved.length) ? saved.slice() : DEFAULT_ORDER.slice();
    DEFAULT_ORDER.forEach(k => { if (!o.includes(k)) o.push(k); });
    return o.filter(k => DEFAULT_ORDER.includes(k));
  })();
  renderOrderList();
  document.getElementById("saveSettings").onclick = async () => {
    const newPerms = {}; document.querySelectorAll("[data-perm]").forEach(s => newPerms[s.dataset.perm] = s.value);
    const payload = { className: document.getElementById("setName").value.trim() || "班級親師互動網", perms: newPerms, moduleOrder: editOrder.slice(), teacherEmail: document.getElementById("setEmail").value.trim(), mailKey: document.getElementById("setMailKey").value.trim(), autoEmail: document.getElementById("setAutoEmail").checked };
    const tp = document.getElementById("setTpwd").value; if (tp) payload.teacherPassword = tp;
    try { await db.collection("classroom").doc("config").set(payload, { merge: true }); toast("設定已儲存", "success"); }
    catch (e) { toast("儲存失敗：" + e.message, "error"); }
  };
}

/* 排序清單渲染與上下移動 */
function renderOrderList() {
  const box = document.getElementById("orderList"); if (!box || !editOrder) return;
  box.innerHTML = editOrder.map((k, i) => `
    <div class="flex items-center justify-between border rounded-xl px-3 py-2">
      <span class="text-sm">${i + 1}. ${ORDER_LABELS[k] || k}</span>
      <div class="flex gap-1">
        <button onclick="moveOrder(${i},-1)" class="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 ${i === 0 ? "opacity-30 pointer-events-none" : ""}">▲</button>
        <button onclick="moveOrder(${i},1)" class="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 ${i === editOrder.length - 1 ? "opacity-30 pointer-events-none" : ""}">▼</button>
      </div>
    </div>`).join("");
}
function moveOrder(idx, dir) {
  const j = idx + dir; if (j < 0 || j >= editOrder.length) return;
  [editOrder[idx], editOrder[j]] = [editOrder[j], editOrder[idx]];
  renderOrderList();
}

/* ── 後台：學生帳號 ── */
function adminStudents(body) {
  const rows = APP_STATE.students.map(s => `
    <tr class="border-b">
      <td class="py-1.5 px-2">${escapeHtml(s.seat)}</td>
      <td class="py-1.5 px-2">${escapeHtml(s.name||"")} ${s.hideName?'<span class="text-xs text-slate-400">(隱藏)</span>':''}</td>
      <td class="py-1.5 px-2 font-mono text-xs">${escapeHtml(s.password||"")}</td>
      <td class="py-1.5 px-2 text-right whitespace-nowrap"><button onclick="editStudent('${s.id}')" class="text-blue-600 text-xs underline">編輯</button><button onclick="delStudent('${s.id}','${escapeHtml(s.seat)}')" class="text-rose-600 text-xs underline ml-2">刪除</button></td>
    </tr>`).join("");
  body.innerHTML = `
    <div class="space-y-5">
      <div class="flex items-center justify-between"><h4 class="font-bold text-sm">學生名單（${APP_STATE.students.length} 人）</h4><button onclick="editStudent()" class="btn3d b-blue text-xs">＋ 新增單筆</button></div>
      <div class="overflow-x-auto border rounded-xl"><table class="w-full text-sm"><thead class="bg-slate-50 text-slate-500 text-xs"><tr><th class="py-2 px-2 text-left">座號</th><th class="py-2 px-2 text-left">姓名</th><th class="py-2 px-2 text-left">密碼</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="text-center py-4 text-slate-400">尚無學生</td></tr>'}</tbody></table></div>
      <div class="border-t pt-4 space-y-2">
        <h4 class="font-bold text-sm">📋 批次匯入學生帳號</h4>
        <p class="text-xs text-slate-500">每行一位，格式：<code>座號,姓名,密碼</code>（逗號或 Tab 分隔）。例：<br/><code>01,王小明,123456</code></p>
        <textarea id="bulkStu" class="w-full border rounded-xl p-3 text-xs font-mono" style="min-height:120px" placeholder="01,王小明,123456&#10;02,李小美,654321"></textarea>
        <button id="doBulkStu" class="btn3d b-emerald w-full text-sm">執行批次匯入</button>
      </div>
    </div>`;
  document.getElementById("doBulkStu").onclick = bulkImportStudents;
}
function editStudent(id) {
  const s = id ? APP_STATE.students.find(x => x.id === id) : {};
  showModal(`
    <div class="p-6 space-y-3">
      <h3 class="font-bold text-lg">${id?"編輯":"新增"}學生</h3>
      <div><label class="text-sm">座號</label><input id="esSeat" class="w-full mt-1 border rounded-xl px-3 py-2 text-sm" value="${escapeHtml(s?.seat||"")}" ${id?"readonly":""} /></div>
      <div><label class="text-sm">姓名</label><input id="esName" class="w-full mt-1 border rounded-xl px-3 py-2 text-sm" value="${escapeHtml(s?.name||"")}" /></div>
      <div><label class="text-sm">密碼</label><input id="esPwd" class="w-full mt-1 border rounded-xl px-3 py-2 text-sm" value="${escapeHtml(s?.password||"")}" /></div>
      <label class="flex items-center gap-2 text-sm"><input id="esHide" type="checkbox" ${s?.hideName?"checked":""}/> 前台隱藏姓名</label>
      <div class="flex gap-2 justify-end pt-2"><button onclick="openAdmin()" class="px-4 py-2 rounded-xl bg-slate-100 text-sm">返回</button><button id="esSave" class="btn3d b-blue text-sm">儲存</button></div>
    </div>`, { size: "max-w-sm", noBackdropClose: true });
  document.getElementById("esSave").onclick = async () => {
    const seat = document.getElementById("esSeat").value.trim();
    if (!seat) { toast("請輸入座號", "warn"); return; }
    const data = { seat, name: document.getElementById("esName").value.trim(), password: document.getElementById("esPwd").value, hideName: document.getElementById("esHide").checked };
    try { await db.collection("students").doc(seat).set(data, { merge: true }); toast("已儲存", "success"); openAdmin(); adminGoTab(1); }
    catch (e) { toast("儲存失敗：" + e.message, "error"); }
  };
}
async function delStudent(id, seat) {
  if (!await confirmDialog("刪除學生", `確定刪除座號 ${seat} 嗎？`, { okText: "刪除", danger: true })) return;
  try { await db.collection("students").doc(id).delete(); toast("已刪除", "info"); openAdmin(); adminGoTab(1); }
  catch (e) { toast("刪除失敗：" + e.message, "error"); }
}
async function bulkImportStudents() {
  const text = document.getElementById("bulkStu").value.trim();
  if (!text) { toast("請先貼上名單", "warn"); return; }
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean), parsed = [], errors = [];
  lines.forEach((ln, i) => {
    const parts = ln.includes("\t") ? ln.split("\t") : ln.split(",");
    const seat = (parts[0]||"").trim();
    if (!seat) { errors.push(i+1); return; }
    parsed.push({ seat, name: (parts[1]||"").trim(), password: (parts[2]||"").trim(), hideName: false });
  });
  if (errors.length) { toast(`第 ${errors.join("、")} 行格式有誤（缺座號）`, "error"); return; }
  if (!await confirmDialog("批次匯入", `將匯入／更新 ${parsed.length} 位學生，確定？`, { okText: "匯入" })) return;
  try { const batch = db.batch(); parsed.forEach(s => batch.set(db.collection("students").doc(s.seat), s, { merge: true })); await batch.commit(); toast(`成功匯入 ${parsed.length} 位學生`, "success"); openAdmin(); adminGoTab(1); }
  catch (e) { toast("匯入失敗：" + e.message, "error"); }
}

/* ── 後台：聯絡簿 ── */
function adminContactbook(body) {
  const date = document.getElementById("cbDate")?.value || todayStr();
  body.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center gap-2"><label class="text-sm font-medium">日期</label><input type="date" id="acbDate" value="${date}" class="border rounded-xl px-2 py-1 text-sm" /></div>
      <div>
        <label class="text-sm font-medium">聯絡簿內容</label>
        <p class="text-xs text-slate-400 mb-1">支援 **粗體**、行首 - 清單、自動連結化網址。<b>每一行作業（行首 -）會成為「作業檢核」的欄位。</b></p>
        <textarea id="acbContent" class="w-full border rounded-xl p-3 text-sm" style="min-height:160px" placeholder="今日作業：&#10;- 國語習作 P.10&#10;- 數學訂正"></textarea>
      </div>
      <button id="acbSave" class="btn3d b-blue w-full">發布／更新聯絡簿</button>
      <div class="border-t pt-4"><h4 class="font-bold text-sm mb-2">📊 已讀報表（<span id="acbReportDate">${date}</span>）</h4><div id="acbReport" class="text-sm text-slate-500">載入中…</div></div>
    </div>`;
  const dateEl = document.getElementById("acbDate");
  const load = () => { const d = dateEl.value; document.getElementById("acbReportDate").textContent = d; db.collection("contactbook").doc(d).get().then(doc => { document.getElementById("acbContent").value = doc.exists ? (doc.data().content || "") : ""; renderReadReport(doc.exists ? (doc.data().reads || {}) : {}); }); };
  dateEl.onchange = load; load();
  document.getElementById("acbSave").onclick = async () => {
    const d = dateEl.value;
    try { await db.collection("contactbook").doc(d).set({ content: document.getElementById("acbContent").value, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }); toast("聯絡簿已發布", "success"); }
    catch (e) { toast("發布失敗：" + e.message, "error"); }
  };
}
function renderReadReport(reads) {
  const box = document.getElementById("acbReport"); if (!box) return;
  box.innerHTML = readReportHtml(reads);
}

/* ── 後台：作業檢核 ── */
let hwAdminUnsub = null;
function adminHomework(body) {
  body.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center gap-2 flex-wrap">
        <label class="text-sm font-medium">檢核日期</label>
        <input type="date" id="hwDate" value="${todayStr()}" class="border rounded-xl px-2 py-1 text-sm" />
        <button id="hwReload" class="btn3d b-amber text-xs">↻ 依前一上課日聯絡簿載入作業</button>
      </div>
      <div id="hwSource" class="text-xs text-slate-500"></div>
      <div class="hw-legend text-xs text-slate-500"><span><i class="hw-dot hw-0"></i>未繳交</span><span><i class="hw-dot hw-1"></i>已繳交</span><span><i class="hw-dot hw-2"></i>待訂正</span><span><i class="hw-dot hw-3"></i>已訂正</span></div>
      <div id="hwTableBox" class="overflow-x-auto">載入中…</div>
      <p class="text-xs text-slate-400">點擊欄位循環切換：未繳交 → 已繳交 → 待訂正 → 已訂正。家長登入後可即時看到此表。</p>
    </div>`;
  const dateEl = document.getElementById("hwDate");
  const load = async (forceReload) => {
    if (hwAdminUnsub) hwAdminUnsub();
    const d = dateEl.value;
    const doc = await db.collection("homework").doc(d).get();
    let data = doc.exists ? doc.data() : null;
    if (forceReload || !data || !(data.items || []).length) {
      let prev;
      try { prev = await findPrevContactbook(d); }
      catch (err) { if (err.message === "__INDEX__") return; toast("讀取失敗：" + err.message, "error"); return; }
      const items = prev ? extractHomework(prev.content) : [];
      const payload = { sourceDate: prev ? prev.date : null, items, status: (data && data.status) || {} };
      await db.collection("homework").doc(d).set({ sourceDate: payload.sourceDate, items: payload.items }, { merge: true });
      if (!prev) toast("查無前一上課日的聯絡簿內容，請先在「聯絡簿」分頁發布內容。", "warn");
    }
    hwAdminUnsub = db.collection("homework").doc(d).onSnapshot(s => renderHwAdminTable(d, s.exists ? s.data() : { items: [], status: {} }));
  };
  dateEl.onchange = () => load(false);
  document.getElementById("hwReload").onclick = () => load(true);
  load(false);
}
function renderHwAdminTable(date, data) {
  const box = document.getElementById("hwTableBox"); if (!box) return;
  const items = data.items || [], status = data.status || {}, src = document.getElementById("hwSource");
  if (src) src.innerHTML = data.sourceDate ? `作業來源：<b>${escapeHtml(data.sourceDate)}</b> 聯絡簿（共 ${items.length} 項作業）` : '<span class="text-rose-500">查無前一上課日的聯絡簿，請點上方「↻ 載入」或先發布聯絡簿。</span>';
  if (!items.length) { box.innerHTML = '<p class="text-slate-400 text-sm py-4">沒有可檢核的作業項目（聯絡簿請以「- 」開頭逐項列出作業）。</p>'; return; }
  if (!APP_STATE.students.length) { box.innerHTML = '<p class="text-slate-400 text-sm py-4">尚無學生名單。</p>'; return; }
  let html = '<table class="hw-table text-sm"><thead><tr><th class="hw-th-seat">座號</th>' + items.map(it => `<th class="hw-th">${escapeHtml(it)}</th>`).join("") + "</tr></thead><tbody>";
  APP_STATE.students.forEach(st => {
    html += `<tr><td class="hw-td-seat">${escapeHtml(st.seat)} ${escapeHtml(st.hideName?"":(st.name||""))}</td>`;
    items.forEach((it, idx) => { const key = st.seat + "_" + idx, cur = status[key] || 0; html += `<td><button class="hw-cell hw-clickable hw-${cur}" onclick="cycleHw('${date}','${escapeHtml(String(st.seat))}',${idx},${cur})">${HW_STATES[cur].label}</button></td>`; });
    html += "</tr>";
  });
  html += "</tbody></table>";
  box.innerHTML = html;
}
async function cycleHw(date, seat, idx, cur) {
  const next = (Number(cur) + 1) % 4;
  try { await db.collection("homework").doc(date).set({ status: { [seat + "_" + idx]: next } }, { merge: true }); }
  catch (e) { toast("更新失敗：" + e.message, "error"); }
}

/* ══════════════════════════════════════════════════════════════════
   通用：刪除文件並先清空圖片欄位（釋出 Firestore 空間）
══════════════════════════════════════════════════════════════════ */
async function _deleteDocWithImages(collection, docId, imgFields) {
  // 先把圖片欄位清空（減少佔用的文件大小後再刪）
  const clearData = {};
  (imgFields || []).forEach(f => { clearData[f] = []; });
  try {
    if (Object.keys(clearData).length) {
      await db.collection(collection).doc(docId).update(clearData);
    }
  } catch(e) { /* 文件可能已不存在，忽略 */ }
  await db.collection(collection).doc(docId).delete();
}

/* ── 後台：公告 ── */
function adminAnnouncements(body) {
  const autoDays = (APP_STATE.config || {}).annAutoDel || 0; // 0 = 不自動刪
  const list = ANN_DATA.map(a => {
    const dateStr = a.createdAt ? new Date(a.createdAt.seconds * 1000).toLocaleDateString("zh-TW") : "—";
    const expStr = a.expireAt
      ? `<span class="text-rose-500">⏱️ ${escapeHtml(a.expireAt)} 刪除</span>`
      : (autoDays ? `<span class="text-slate-400">⏱️ 全域 ${autoDays} 天</span>` : `<span class="text-slate-300">不自動刪除</span>`);
    return `
    <div class="border rounded-xl p-3 flex items-center gap-2">
      <input type="checkbox" class="ann-chk w-4 h-4 shrink-0" data-id="${a.id}" />
      <div class="min-w-0 flex-1">
        <div class="font-medium text-sm truncate text-left">${escapeHtml(a.title||"公告")} ${a.hidden?'<span class="text-xs text-slate-400">(隱藏)</span>':''}</div>
        <div class="text-xs text-slate-400">${dateStr}　${expStr}　${escapeHtml((a.content||"").slice(0,20))}</div>
      </div>
      <div class="flex gap-2 shrink-0">
        <button onclick="editAnnExpire('${a.id}')" class="text-xs text-indigo-600 underline">⏱️</button>
        <button onclick="toggleAnn('${a.id}',${!a.hidden})" class="text-xs text-amber-600 underline">${a.hidden?"顯示":"隱藏"}</button>
        <button onclick="delAnn('${a.id}')" class="text-xs text-rose-600 underline">刪除</button>
      </div>
    </div>`;
  }).join("");

  body.innerHTML = `
    <div class="space-y-4">
      <h4 class="font-bold text-sm">新增公告</h4>
      <input id="annTitle" class="w-full border rounded-xl px-3 py-2 text-sm" placeholder="公告標題" />
      <textarea id="annContent" class="w-full border rounded-xl p-3 text-sm" style="min-height:100px" placeholder="內文（可貼網址自動連結、**粗體**）"></textarea>
      <div><label class="text-sm font-medium block mb-1">附加圖片（自動壓縮）</label><input id="annImgs" type="file" accept="image/*" multiple class="text-sm" /><div id="annPreview" class="flex flex-wrap gap-2 mt-2"></div></div>
      <div class="flex items-center gap-2 flex-wrap">
        <label class="text-sm shrink-0">⏱️ 此則自動刪除日期</label>
        <input id="annExpire" type="date" class="border rounded-xl px-2 py-1 text-sm" />
        <span class="text-xs text-slate-400">留空＝${autoDays ? '套用全域 '+autoDays+' 天' : '不自動刪除'}</span>
      </div>
      <button id="annSave" class="btn3d b-rose w-full">發布公告</button>

      <div class="border-t pt-4 space-y-3">
        <div class="flex items-center justify-between flex-wrap gap-2">
          <h4 class="font-bold text-sm">現有公告（${ANN_DATA.length} 則）</h4>
          <div class="flex gap-2 flex-wrap">
            <button onclick="annSelectAll()" class="text-xs text-slate-500 underline">全選</button>
            <button onclick="annBatchDel()" class="text-xs text-rose-600 underline">🗑️ 刪除勾選</button>
            <button onclick="openAutoDelDialog('ann')" class="text-xs text-indigo-600 underline">⏱️ 自動刪除設定</button>
          </div>
        </div>
        ${autoDays ? `<div class="text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 text-amber-700">⏱️ 自動刪除：發布後 <b>${autoDays}</b> 天自動刪除</div>` : ""}
        <div class="space-y-2">${list || '<p class="text-slate-400 text-sm">尚無公告</p>'}</div>
      </div>
    </div>`;

  let pendingImgs = [];
  document.getElementById("annImgs").onchange = async (e) => {
    pendingImgs = [];
    const prev = document.getElementById("annPreview");
    prev.innerHTML = '<span class="text-xs text-slate-400">壓縮中…</span>';
    for (const f of e.target.files) pendingImgs.push(await compressImage(f));
    prev.innerHTML = pendingImgs.map(s => `<img src="${s}" class="w-16 h-16 object-cover rounded" />`).join("");
  };
  document.getElementById("annSave").onclick = async () => {
    const title = document.getElementById("annTitle").value.trim();
    if (!title) { toast("請輸入標題", "warn"); return; }
    try {
      const expVal = document.getElementById("annExpire").value;
      await db.collection("announcements").add({
        title,
        content: document.getElementById("annContent").value,
        images: pendingImgs,
        hidden: false,
        expireAt: expVal || "",   // 每則獨立到期日（YYYY-MM-DD），留空＝套用全域設定
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      toast("公告已發布", "success"); openAdmin(); adminGoTab(4);
    }
    catch (e) { toast("發布失敗：" + e.message, "error"); }
  };
}

window.annSelectAll = function() {
  const chks = document.querySelectorAll(".ann-chk");
  const allChecked = Array.from(chks).every(c => c.checked);
  chks.forEach(c => c.checked = !allChecked);
};

window.annBatchDel = async function() {
  const ids = Array.from(document.querySelectorAll(".ann-chk:checked")).map(c => c.dataset.id);
  if (!ids.length) { toast("請先勾選要刪除的公告", "warn"); return; }
  if (!await confirmDialog("批次刪除公告", `確定刪除已勾選的 ${ids.length} 則公告？圖片資料也會一併清除。`, { okText: "刪除", danger: true })) return;
  toast("刪除中…", "info");
  for (const id of ids) await _deleteDocWithImages("announcements", id, ["images", "imageUrls"]);
  toast(`已刪除 ${ids.length} 則公告`, "success");
  openAdmin(); adminGoTab(4);
};

async function toggleAnn(id, hidden) { await db.collection("announcements").doc(id).update({ hidden }); toast(hidden?"已隱藏":"已顯示","info"); openAdmin(); adminGoTab(4); }
async function delAnn(id) {
  if (!await confirmDialog("刪除公告","確定刪除此公告？圖片資料也會一併清除。",{okText:"刪除",danger:true})) return;
  await _deleteDocWithImages("announcements", id, ["images", "imageUrls"]);
  toast("已刪除","info"); openAdmin(); adminGoTab(4);
}

/* ── 單則自動刪除日期設定（公告 / 回條各自獨立） ── */
function _editItemExpire(col, id, curExpire, type) {
  showModal(`
    <div class="p-5 space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="font-bold">⏱️ 設定此則自動刪除日期</h3>
        <button onclick="closeModal()" class="text-slate-400 text-xl">×</button>
      </div>
      <p class="text-xs text-slate-500">設定後，到達該日期將在老師開啟後台時自動刪除（含圖片）。留空＝套用全域設定。</p>
      <div class="flex items-center gap-2 flex-wrap">
        <input id="itemExpInput" type="date" value="${curExpire || ''}" class="border rounded-xl px-3 py-2 text-sm" />
        <button id="itemExpClear" class="text-xs text-slate-500 underline">清除（不指定）</button>
      </div>
      <div class="flex justify-end gap-2">
        <button onclick="closeModal()" class="px-4 py-2 rounded-xl bg-slate-100 text-sm">取消</button>
        <button id="itemExpSave" class="btn3d b-indigo text-sm">儲存</button>
      </div>
    </div>`, { size: "max-w-sm" });
  document.getElementById("itemExpClear").onclick = () => { document.getElementById("itemExpInput").value = ""; };
  document.getElementById("itemExpSave").onclick = async () => {
    try {
      const val = document.getElementById("itemExpInput").value || "";
      await db.collection(col).doc(id).update({ expireAt: val });
      toast(val ? `已設定 ${val} 自動刪除` : "已清除此則的自動刪除日期", "success");
      closeModal();
      openAdmin(); adminGoTab(type === "ann" ? 4 : 6);
    } catch(e) { toast("儲存失敗：" + e.message, "error"); }
  };
}
window.editAnnExpire = function(id) {
  const a = ANN_DATA.find(x => x.id === id);
  _editItemExpire("announcements", id, a ? a.expireAt : "", "ann");
};
window.editSlipExpire = function(id) {
  const s = SLIP_DATA.find(x => x.id === id);
  _editItemExpire("slips", id, s ? s.expireAt : "", "slip");
};

/* ── 全域預設自動刪除設定（公告 / 回條共用，作為未指定單則日期時的預設） ── */
window.openAutoDelDialog = function(type) {
  const isAnn = type === "ann";
  const cfgKey = isAnn ? "annAutoDel" : "slipAutoDel";
  const label = isAnn ? "公告" : "回條";
  const cur = (APP_STATE.config || {})[cfgKey] || 0;
  showModal(`
    <div class="p-5 space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="font-bold">⏱️ ${label}自動刪除設定</h3>
        <button onclick="closeModal()" class="text-slate-400 text-xl">×</button>
      </div>
      <p class="text-xs text-slate-500">發布後超過設定天數的${label}，將在老師開啟後台時自動刪除（含圖片）。設為 0 表示不自動刪除。</p>
      <div class="grid grid-cols-2 gap-2">
        <button onclick="setAutoDelDays('${cfgKey}',10,'${type}')" class="border rounded-xl p-3 text-sm hover:bg-slate-50 ${cur===10?'border-indigo-400 bg-indigo-50 font-bold':''}">10 天後</button>
        <button onclick="setAutoDelDays('${cfgKey}',30,'${type}')" class="border rounded-xl p-3 text-sm hover:bg-slate-50 ${cur===30?'border-indigo-400 bg-indigo-50 font-bold':''}">1 個月後</button>
        <button onclick="setAutoDelDays('${cfgKey}',90,'${type}')" class="border rounded-xl p-3 text-sm hover:bg-slate-50 ${cur===90?'border-indigo-400 bg-indigo-50 font-bold':''}">3 個月後</button>
        <button onclick="setAutoDelDays('${cfgKey}',0,'${type}')" class="border rounded-xl p-3 text-sm hover:bg-slate-50 ${cur===0?'border-slate-400 bg-slate-50 font-bold':''}">不自動刪除</button>
      </div>
      <div class="flex items-center gap-2">
        <label class="text-sm shrink-0">自訂天數：</label>
        <input id="autoDelCustom" type="number" min="1" max="3650" value="${cur||''}" placeholder="例：14" class="border rounded-xl px-3 py-2 text-sm w-24" />
        <button onclick="setAutoDelDays('${cfgKey}',parseInt(document.getElementById('autoDelCustom').value)||0,'${type}')" class="btn3d b-indigo text-sm">套用</button>
      </div>
      ${cur ? `<p class="text-xs text-emerald-600">目前設定：${cur} 天後自動刪除</p>` : '<p class="text-xs text-slate-400">目前：不自動刪除</p>'}
    </div>`, { size: "max-w-sm" });
};

window.setAutoDelDays = async function(cfgKey, days, type) {
  try {
    await db.collection("classroom").doc("config").set({ [cfgKey]: days }, { merge: true });
    if (APP_STATE.config) APP_STATE.config[cfgKey] = days;
    toast(days ? `設定完成：${days} 天後自動刪除` : "已關閉自動刪除", "success");
    closeModal();
    // 立即執行一次清理
    await _runAutoDel(cfgKey, type);
    openAdmin(); adminGoTab(type === "ann" ? 4 : 6);
  } catch(e) { toast("儲存失敗：" + e.message, "error"); }
};

/* ── 自動刪除執行（公告 or 回條） ── */
async function _runAutoDel(cfgKey, type) {
  const days = (APP_STATE.config || {})[cfgKey] || 0;   // 全域預設（天數），0＝無
  const isAnn = type === "ann";
  const col = isAnn ? "announcements" : "slips";
  const imgFields = isAnn ? ["images", "imageUrls"] : [];
  const data = isAnn ? ANN_DATA : SLIP_DATA;
  const now = Date.now();
  const globalCutoff = days ? now - days * 86400000 : null;
  // 判斷單筆是否到期：優先看該則 expireAt（指定到期日），否則套用全域天數
  const isExpired = d => {
    if (d.expireAt) {
      // expireAt 為 YYYY-MM-DD，視為當日 23:59:59 之後才算到期
      const t = new Date(d.expireAt + "T23:59:59").getTime();
      return !isNaN(t) && now > t;
    }
    if (globalCutoff !== null) {
      return d.createdAt && d.createdAt.seconds * 1000 < globalCutoff;
    }
    return false;
  };
  const expired = data.filter(isExpired);
  if (!expired.length) return;
  for (const d of expired) {
    await _deleteDocWithImages(col, d.id, imgFields);
    // 回條：同步刪除 slipSubmissions（含圖片）
    if (!isAnn) {
      const subs = SUB_DATA.filter(s => s.slipId === d.id);
      for (const s of subs) await _deleteDocWithImages("slipSubmissions", s.id, ["image"]);
    }
  }
  if (expired.length) toast(`已自動刪除 ${expired.length} 筆過期${isAnn?"公告":"回條"}`, "info");
}

/* 開啟後台時執行自動刪除檢查 */
async function runAllAutoDel() {
  await _runAutoDel("annAutoDel", "ann");
  await _runAutoDel("slipAutoDel", "slip");
}

/* ── 後台：日曆 ── */
const AI_PROMPT = `你現在是一位細心的國中小班級行政助手。我會提供你一段混雜、零散的班級行事曆或課務通知文字，請幫我抽取出裡面的「重要活動、日期、描述與相關網址」，並嚴格依照下方的【固定格式】輸出。

【固定格式要求】
1. 每一個活動單獨佔據一行。
2. 欄位順序必須為：年/月/日,活動名稱,詳細描述與提醒文字,網址
3. 各欄位之間請使用英文半形逗號（,）進行區隔（你也可以使用 Tab 鍵分隔）。
4. 若該活動「沒有提供網址」，則第四個欄位請保持留空（但其前方的逗號仍要保留）。
5. 輸出的年份請一律使用西元年（若原始文字只有寫幾月幾號，請預設為 2026 年）。
6. 除了符合格式的行數外，不要輸出任何多餘的解釋、前言、後記或 Markdown 標籤（如 \`\`\`）。

【輸出格式範例】
2026/10/05,電腦課作業繳交,請記得上傳Scratch專案,[https://scratch.mit.edu](https://scratch.mit.edu)
2026/10/10,雙十國慶放假,全國放假一天，請注意秋季出遊安全。,

【我的原始行事曆文字如下】：
----------
（請在此處貼上你從 LINE 群組、校網公告或聯絡簿草稿複製過來的雜亂活動文字）
----------`;
function adminCalendar(body) {
  const list = APP_STATE.calEvents.slice().sort((a,b)=> normDate(a.date)<normDate(b.date)?-1:1).map(e => `
    <div class="border rounded-xl p-2 flex items-center justify-between gap-2 text-sm"><div class="min-w-0"><span class="text-violet-600 text-xs">${escapeHtml(normDate(e.date))}</span> <span class="font-medium">${escapeHtml(e.title||"")}</span></div><button onclick="delEvent('${e.id}')" class="text-rose-600 text-xs underline shrink-0">刪除</button></div>`).join("");
  body.innerHTML = `
    <div class="space-y-4">
      <h4 class="font-bold text-sm">新增單筆活動</h4>
      <div class="grid grid-cols-2 gap-2"><input id="evDate" type="date" class="border rounded-xl px-2 py-2 text-sm" /><input id="evTitle" class="border rounded-xl px-3 py-2 text-sm" placeholder="活動名稱" /></div>
      <textarea id="evDesc" class="w-full border rounded-xl p-2 text-sm" placeholder="詳細描述（選填）"></textarea>
      <input id="evUrl" class="w-full border rounded-xl px-3 py-2 text-sm" placeholder="超連結 URL（選填）" />
      <button id="evSave" class="btn3d b-blue w-full text-sm">新增活動</button>
      <div class="border-t pt-4 space-y-2">
        <h4 class="font-bold text-sm">📋 批次文字匯入活動</h4>
        <p class="text-xs text-slate-500">每行一活動：<code>年/月/日,活動名稱,詳細描述,超連結(選填)</code>，逗號或 Tab 分隔。</p>
        <textarea id="bulkEv" class="w-full border rounded-xl p-2 text-xs font-mono" style="min-height:110px" placeholder="2026/09/15,第一次定期評量,請準備國數複習,https://school.edu.tw/exam&#10;2026/09/28	教師節活動	請穿運動服8:10操場集合	"></textarea>
        <button id="doBulkEv" class="btn3d b-emerald w-full text-sm">執行匯入</button>
      </div>
      <div class="border-t pt-4 bg-indigo-50 -mx-2 px-3 py-3 rounded-xl">
        <div class="flex items-center justify-between"><h4 class="font-bold text-sm">🤖 AI 助手提示詞</h4><button id="copyPrompt" class="btn3d b-indigo text-xs">一鍵複製 Prompt</button></div>
        <p class="text-xs text-slate-500 mt-1">複製後貼給 Gemini 等 AI 整理雜亂行事曆，再把結果貼回上方批次匯入框。</p>
      </div>
      <div class="border-t pt-4 space-y-1"><h4 class="font-bold text-sm">現有活動（${APP_STATE.calEvents.length}）</h4>${list || '<p class="text-slate-400 text-sm">尚無活動</p>'}</div>
    </div>`;
  document.getElementById("evSave").onclick = async () => {
    const d = document.getElementById("evDate").value, t = document.getElementById("evTitle").value.trim();
    if (!d || !t) { toast("請填日期與名稱", "warn"); return; }
    try { await db.collection("calendar").add({ date: normDate(d), title: t, desc: document.getElementById("evDesc").value, url: document.getElementById("evUrl").value.trim() }); toast("已新增活動","success"); openAdmin(); adminGoTab(5); }
    catch (e) { toast("失敗：" + e.message, "error"); }
  };
  document.getElementById("doBulkEv").onclick = bulkImportEvents;
  document.getElementById("copyPrompt").onclick = () => copyText(AI_PROMPT, "已複製 AI 提示詞，快貼給 Gemini 試試！");
}
async function bulkImportEvents() {
  const text = document.getElementById("bulkEv").value.trim();
  if (!text) { toast("請先貼上活動資料", "warn"); return; }
  const lines = text.split("\n").map(l=>l.replace(/\s+$/,"")).filter(l=>l.trim()), parsed = [], errors = [];
  lines.forEach((ln, i) => {
    const parts = ln.includes("\t") ? ln.split("\t") : ln.split(",");
    const dateRaw = (parts[0]||"").trim();
    if (!/^\d{4}\D+\d{1,2}\D+\d{1,2}$/.test(dateRaw)) { errors.push(i+1); return; }
    let url = (parts[3]||"").trim(); const mdMatch = url.match(/\((https?:\/\/[^)]+)\)/); if (mdMatch) url = mdMatch[1];
    parsed.push({ date: normDate(dateRaw), title: (parts[1]||"").trim(), desc: (parts[2]||"").trim(), url });
  });
  if (errors.length) { toast(`第 ${errors.join("、")} 行格式有誤，請修正日期格式`, "error"); return; }
  if (!parsed.length) { toast("沒有有效活動", "warn"); return; }
  if (!await confirmDialog("匯入活動", `將新增 ${parsed.length} 筆活動，確定？`, { okText: "匯入" })) return;
  try { const batch = db.batch(); parsed.forEach(e => batch.set(db.collection("calendar").doc(), e)); await batch.commit(); toast(`成功匯入 ${parsed.length} 筆活動`, "success"); openAdmin(); adminGoTab(5); }
  catch (e) { toast("匯入失敗：" + e.message, "error"); }
}
async function delEvent(id) { if (!await confirmDialog("刪除活動","確定刪除？",{okText:"刪除",danger:true})) return; await db.collection("calendar").doc(id).delete(); toast("已刪除","info"); openAdmin(); adminGoTab(5); }

/* ── 後台：回條 ──（hideCreate=true 時隱藏「建立回條項目」表單，供前台嵌入用） ── */
function adminSlips(body, hideCreate) {
  const autoDays = (APP_STATE.config || {}).slipAutoDel || 0;
  const list = SLIP_DATA.map(s => {
    const subs = SUB_DATA.filter(x => x.slipId === s.id);
    const submitted = subs.length, total = APP_STATE.students.length;
    const approved = subs.filter(x => x.status === "approved").length;
    const pending  = subs.filter(x => x.status === "pending" || !x.status).length;
    const rejected = subs.filter(x => x.status === "rejected").length;
    const dateStr = s.createdAt ? new Date(s.createdAt.seconds * 1000).toLocaleDateString("zh-TW") : "—";

    const thumbs = APP_STATE.students.map(st => {
      const sub = subs.find(x => String(x.seat) === String(st.seat));
      if (!sub) {
        return `<div class="slip-thumb slip-thumb-none" title="${escapeHtml(st.seat+'號 '+(st.name||''))}"><span class="slip-thumb-seat">${escapeHtml(String(st.seat))}</span></div>`;
      }
      const imgSrc = sub.imageUrl || sub.image || "";
      const statusCls = sub.status === "approved" ? "slip-thumb-ok" : sub.status === "rejected" ? "slip-thumb-rej" : "slip-thumb-pending";
      const badge = sub.status === "approved" ? "✅" : sub.status === "rejected" ? "❌" : "⏳";
      return `<div class="slip-thumb ${statusCls}" onclick="reviewSub('${s.id}','${escapeHtml(String(st.seat))}')" title="${escapeHtml(st.seat+'號 '+(st.name||''))} — 點擊審核">
        ${imgSrc ? `<img src="${imgSrc}" class="slip-thumb-img" />` : ""}
        <span class="slip-thumb-seat">${escapeHtml(String(st.seat))}</span>
        <span class="slip-thumb-badge">${badge}</span>
      </div>`;
    }).join("");

    return `<div class="border rounded-xl p-3 space-y-2">
      <div class="flex items-center gap-2 flex-wrap">
        <input type="checkbox" class="slip-chk w-4 h-4 shrink-0" data-id="${s.id}" />
        <div class="flex-1 min-w-0">
          <span class="font-medium text-sm">${escapeHtml(s.name||"回條")}</span>
          <span class="text-xs text-slate-400 ml-1">截止 ${escapeHtml(s.deadline||"—")}　建立 ${dateStr}</span>
          <span class="text-xs ml-1">${s.expireAt ? '<span class="text-rose-500">⏱️ '+escapeHtml(s.expireAt)+' 刪除</span>' : (autoDays ? '<span class="text-slate-400">⏱️ 全域 '+autoDays+' 天</span>' : '<span class="text-slate-300">不自動刪除</span>')}</span>
        </div>
        <div class="flex gap-2 flex-wrap">
          ${pending > 0 ? `<button onclick="slipApproveAll('${s.id}')" class="text-xs text-emerald-700 underline font-medium">✅ 一鍵全通過(${pending})</button>` : ''}
          <button onclick="downloadSlipImagesPdf('${s.id}')" class="text-xs text-rose-600 underline">📄 下載PDF</button>
          <button onclick="downloadSlipImagesZip('${s.id}')" class="text-xs text-indigo-600 underline">⬇️ 下載全部(zip)</button>
          <button onclick="exportSlip('${s.id}')" class="text-xs text-emerald-600 underline">📋 匯出清單</button>
          <button onclick="editSlipExpire('${s.id}')" class="text-xs text-indigo-600 underline">⏱️</button>
          <button onclick="delSlip('${s.id}')" class="text-xs text-rose-600 underline">刪除</button>
        </div>
      </div>
      <div class="flex gap-3 text-xs text-slate-500">
        <span>已繳 <b class="text-emerald-700">${submitted}</b>/${total}</span>
        <span>通過 <b class="text-emerald-600">${approved}</b></span>
        <span>待審 <b class="text-amber-600">${pending}</b></span>
        <span>退回 <b class="text-rose-600">${rejected}</b></span>
      </div>
      <div class="slip-thumbs-wrap">${thumbs}</div>
      <p class="text-[11px] text-slate-400">點縮圖可預覽並審核　灰=未繳　黃=待審　綠=通過　紅=退回</p>
    </div>`;
  }).join("");

  const createForm = hideCreate ? "" : `
      <h4 class="font-bold text-sm">建立回條項目</h4>
      <input id="slipName" class="w-full border rounded-xl px-3 py-2 text-sm" placeholder="回條名稱（如：防震演練家長簽章）" />
      <div class="flex items-center gap-2"><label class="text-sm">截止日</label><input id="slipDl" type="date" class="border rounded-xl px-2 py-1 text-sm" /></div>
      <div class="flex items-center gap-2 flex-wrap">
        <label class="text-sm shrink-0">⏱️ 此筆自動刪除日期</label>
        <input id="slipExpire" type="date" class="border rounded-xl px-2 py-1 text-sm" />
        <span class="text-xs text-slate-400">留空＝${autoDays ? '套用全域 '+autoDays+' 天' : '不自動刪除'}</span>
      </div>
      <button id="slipSave" class="btn3d b-blue w-full">建立回條</button>`;

  body.innerHTML = `
    <div class="space-y-4">
      ${createForm}
      <div class="${hideCreate ? '' : 'border-t pt-4 '}space-y-3">
        <div class="flex items-center justify-between flex-wrap gap-2">
          <h4 class="font-bold text-sm">回條進度（${SLIP_DATA.length} 筆）</h4>
          <div class="flex gap-2 flex-wrap">
            <button onclick="slipSelectAll()" class="text-xs text-slate-500 underline">全選</button>
            <button onclick="slipBatchDel()" class="text-xs text-rose-600 underline">🗑️ 刪除勾選</button>
            <button onclick="openAutoDelDialog('slip')" class="text-xs text-indigo-600 underline">⏱️ 自動刪除設定</button>
          </div>
        </div>
        ${autoDays ? `<div class="text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 text-amber-700">⏱️ 自動刪除：建立後 <b>${autoDays}</b> 天自動刪除（含所有繳交圖片）</div>` : ""}
        <div class="space-y-3">${list || '<p class="text-slate-400 text-sm">尚無回條</p>'}</div>
      </div>
    </div>`;
  const slipSaveBtn = document.getElementById("slipSave");
  if (slipSaveBtn) slipSaveBtn.onclick = async () => {
    const name = document.getElementById("slipName").value.trim();
    if (!name) { toast("請輸入回條名稱", "warn"); return; }
    try { await db.collection("slips").add({ name, deadline: document.getElementById("slipDl").value, expireAt: document.getElementById("slipExpire").value || "", hidden:false, createdAt: firebase.firestore.FieldValue.serverTimestamp() }); toast("回條已建立","success"); openAdmin(); adminGoTab(6); }
    catch (e) { toast("建立失敗："+e.message,"error"); }
  };
}

function reviewSub(slipId, seat) {
  const sub = SUB_DATA.find(x => x.slipId === slipId && String(x.seat) === String(seat));
  if (!sub) { toast(`座號 ${seat} 尚未繳交`, "info"); return; }
  const imgSrc = sub.imageUrl || sub.image || "";
  showModal(`
    <div class="p-5 space-y-3">
      <div class="flex items-center justify-between"><h3 class="font-bold">審核：${escapeHtml(seat)}號 ${escapeHtml(sub.name||"")}</h3><button onclick="closeModal()" class="text-slate-400 text-xl">×</button></div>
      ${imgSrc ? `<img src="${imgSrc}" class="w-full rounded-xl border max-h-80 object-contain bg-slate-50" />` : '<p class="text-slate-400 text-sm">（無圖片）</p>'}
      ${sub.imageUrl ? `<a href="${sub.imageUrl}" target="_blank" rel="noopener" class="text-xs text-indigo-500 underline">🔗 在圖床開啟原圖</a>` : ""}
      <div class="flex gap-2"><button id="appr" class="btn3d b-emerald flex-1">✅ 審核通過</button><button id="rej" class="btn3d b-rose flex-1">❌ 退回</button></div>
    </div>`, { size: "max-w-md" });
  document.getElementById("appr").onclick = async () => { await db.collection("slipSubmissions").doc(sub.id).update({ status:"approved", reason:"" }); toast("已通過","success"); closeModal(); };
  document.getElementById("rej").onclick = () => {
    showModal(`<div class="p-5 space-y-3"><h3 class="font-bold">退回原因</h3><input id="rejReason" class="w-full border rounded-xl px-3 py-2 text-sm" placeholder="如：照片模糊，請重拍" /><div class="flex justify-end gap-2"><button onclick="closeModal()" class="px-4 py-2 rounded-xl bg-slate-100 text-sm">取消</button><button id="rejOk" class="btn3d b-rose text-sm">確定退回</button></div></div>`, { size:"max-w-sm" });
    document.getElementById("rejOk").onclick = async () => { await db.collection("slipSubmissions").doc(sub.id).update({ status:"rejected", reason: document.getElementById("rejReason").value.trim() }); toast("已退回","info"); closeModal(); };
  };
}

async function _deleteSlipAndSubs(slipId) {
  const subs = SUB_DATA.filter(s => s.slipId === slipId);
  for (const s of subs) {
    await _deleteDocWithImages("slipSubmissions", s.id, ["image"]);
  }
  await db.collection("slips").doc(slipId).delete();
}

async function delSlip(id) {
  if (!await confirmDialog("刪除回條","確定刪除此回條及所有繳交圖片？此操作無法復原。",{okText:"刪除",danger:true})) return;
  toast("刪除中…", "info");
  await _deleteSlipAndSubs(id);
  toast("已刪除","success"); openAdmin(); adminGoTab(6);
}

window.slipSelectAll = function() {
  const chks = document.querySelectorAll(".slip-chk");
  const allChecked = Array.from(chks).every(c => c.checked);
  chks.forEach(c => c.checked = !allChecked);
};

window.slipBatchDel = async function() {
  const ids = Array.from(document.querySelectorAll(".slip-chk:checked")).map(c => c.dataset.id);
  if (!ids.length) { toast("請先勾選要刪除的回條", "warn"); return; }
  const totalSubs = ids.reduce((acc, id) => acc + SUB_DATA.filter(s => s.slipId === id).length, 0);
  if (!await confirmDialog("批次刪除回條",
    `確定刪除已勾選的 ${ids.length} 筆回條？連同 ${totalSubs} 筆繳交紀錄及所有圖片都會一併清除。`,
    { okText: "刪除", danger: true })) return;
  toast("刪除中…", "info");
  for (const id of ids) await _deleteSlipAndSubs(id);
  toast(`已刪除 ${ids.length} 筆回條及相關圖片`, "success");
  openAdmin(); adminGoTab(6);
};

function exportSlip(slipId) {
  const slip = SLIP_DATA.find(s => s.id === slipId), subs = SUB_DATA.filter(x => x.slipId === slipId);
  const rows = [["座號","姓名","狀態","退回原因","圖片來源"]];
  APP_STATE.students.forEach(st => {
    const sub = subs.find(x => String(x.seat) === String(st.seat));
    const status = !sub ? "未繳交" : sub.status === "approved" ? "已通過" : sub.status === "rejected" ? "已退回" : "待審核";
    const imgSrc = !sub ? "" : (sub.imageUrl || (sub.image ? "資料庫(base64)" : ""));
    rows.push([st.seat, st.name||"", status, sub?.reason||"", imgSrc]);
  });
  const csv = "﻿" + rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${slip?.name||"回條"}_繳交清單.csv`; a.click();
  toast("清單已下載", "success");
}

/* ── 下載所有回條圖片（ZIP）── 實作在 14-slips.js，此處為別名 */
function downloadSlipImages(slipId) {
  if (typeof downloadSlipImagesZip === "function") return downloadSlipImagesZip(slipId);
  toast("ZIP 下載功能未載入", "error");
}
