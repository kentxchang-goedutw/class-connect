/* ══════════════════════════════════════════════════════════════════
   40-quick.js  主畫面教師快速新增（免進後台）：聯絡簿/作業/活動/公告/資源/小考/回條
══════════════════════════════════════════════════════════════════ */

/* ════════════════════ ★★ 主畫面教師快速新增（免進後台） ★★ ════════════════════ */

/* 聯絡簿：編輯/發布 */
function quickContactbook() {
  const date = document.getElementById("cbDate")?.value || todayStr();
  showModal(`
    <div class="p-6 space-y-3">
      <div class="flex items-center justify-between"><h3 class="font-bold text-lg">✏️ 編輯聯絡簿</h3><button onclick="closeModal()" class="text-slate-400 hover:text-slate-600 text-xl">×</button></div>
      <div class="flex items-center gap-2"><label class="text-sm">日期</label><input type="date" id="qcbDate" value="${date}" class="border rounded-xl px-2 py-1 text-sm"></div>
      <p class="text-xs text-slate-400">支援 **粗體**、行首 - 清單、網址自動連結。行首「- 」的每行作業會成為作業檢核欄位。</p>
      <textarea id="qcbContent" class="w-full border rounded-xl p-3 text-sm" style="min-height:160px" placeholder="今日作業：&#10;- 國語習作 P.10&#10;- 數學訂正"></textarea>
      <button id="qcbSave" class="btn3d b-blue w-full">發布／更新</button>
    </div>`, { size: "max-w-md" });
  const dateEl = document.getElementById("qcbDate"), ta = document.getElementById("qcbContent");
  const load = () => db.collection("contactbook").doc(dateEl.value).get().then(d => { ta.value = d.exists ? (d.data().content || "") : ""; });
  dateEl.onchange = load; load();
  document.getElementById("qcbSave").onclick = async () => {
    try { await db.collection("contactbook").doc(dateEl.value).set({ content: ta.value, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }); toast("聯絡簿已發布", "success"); closeModal(); }
    catch (e) { toast("發布失敗：" + e.message, "error"); }
  };
}

/* 作業檢核：建立今日檢核表 —— 可自選要抓取哪一天的聯絡簿
   （預設帶入「前一上課日」，假日補課／連假時可手動改成正確的來源日期） */
async function quickHomework() {
  const d = todayStr();
  // 先嘗試自動找前一上課日當預設值（找不到也沒關係，讓老師自己選）
  let defaultSrc = "";
  try {
    const prev = await findPrevContactbook(d);
    if (prev) defaultSrc = prev.date;
  } catch (err) {
    if (err.message === "__INDEX__") return;   // 需建立索引時已彈出說明
    // 其他錯誤就略過自動偵測，仍開啟手選視窗
  }

  showModal(`
    <div class="p-6 space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="font-bold text-lg">🔄 建立今日作業檢核</h3>
        <button onclick="closeModal()" class="text-slate-400 hover:text-slate-600 text-xl">×</button>
      </div>
      <p class="text-xs text-slate-500 leading-relaxed">
        系統會抓取「指定日期」聯絡簿中行首為「- 」的項目，作為今日 (<b>${escapeHtml(d)}</b>) 的作業檢核欄位。<br>
        預設帶入前一上課日；遇到<b>假日補課、連假</b>等情形，可手動改成正確的來源日期。
      </p>
      <div class="flex items-center gap-2 flex-wrap">
        <label class="text-sm font-medium shrink-0">抓取哪一天的聯絡簿</label>
        <input id="hwSrcDate" type="date" value="${defaultSrc}" max="${d}" class="border rounded-xl px-2 py-1 text-sm">
        ${defaultSrc ? `<button id="hwSrcToday" class="text-xs text-indigo-600 underline">改用今天</button>` : ""}
      </div>
      <div id="hwSrcPreview" class="text-xs bg-slate-50 border rounded-xl p-3 max-h-40 overflow-auto text-slate-600">請選擇日期以預覽作業項目。</div>
      <button id="hwSrcBuild" class="btn3d b-amber w-full">建立今日檢核</button>
    </div>`, { size: "max-w-md" });

  const dateEl = document.getElementById("hwSrcDate");
  const preview = document.getElementById("hwSrcPreview");
  const todayBtn = document.getElementById("hwSrcToday");
  if (todayBtn) todayBtn.onclick = () => { dateEl.value = d; refreshPreview(); };

  async function refreshPreview() {
    const src = dateEl.value;
    if (!src) { preview.innerHTML = '請選擇日期以預覽作業項目。'; return; }
    preview.innerHTML = '讀取中…';
    try {
      const doc = await db.collection("contactbook").doc(src).get();
      const content = doc.exists ? (doc.data().content || "") : "";
      if (!content.trim()) { preview.innerHTML = `<span class="text-rose-500">該日 (${escapeHtml(src)}) 聯絡簿沒有內容。</span>`; return; }
      const items = extractHomework(content);
      if (!items.length) { preview.innerHTML = `<span class="text-rose-500">該日聯絡簿沒有可檢核的作業項目（請用「- 」逐項列出）。</span>`; return; }
      preview.innerHTML = `<div class="font-medium text-slate-700 mb-1">將建立 ${items.length} 項作業：</div><ul class="list-disc pl-5 space-y-0.5">` +
        items.map(it => `<li>${escapeHtml(it)}</li>`).join("") + `</ul>`;
    } catch (e) {
      preview.innerHTML = `<span class="text-rose-500">讀取失敗：${escapeHtml(e.message)}</span>`;
    }
  }
  dateEl.onchange = refreshPreview;
  refreshPreview();

  document.getElementById("hwSrcBuild").onclick = async () => {
    const src = dateEl.value;
    if (!src) { toast("請選擇要抓取的聯絡簿日期", "warn"); return; }
    try {
      const cbDoc = await db.collection("contactbook").doc(src).get();
      const content = cbDoc.exists ? (cbDoc.data().content || "") : "";
      if (!content.trim()) { toast("該日聯絡簿沒有內容", "warn"); return; }
      const items = extractHomework(content);
      if (!items.length) { toast("該日聯絡簿沒有可檢核的作業項目（請用「- 」逐項列出）", "warn"); return; }
      const doc = await db.collection("homework").doc(d).get();
      const status = doc.exists ? (doc.data().status || {}) : {};
      await db.collection("homework").doc(d).set({ sourceDate: src, items, status }, { merge: true });
      toast(`已建立今日檢核（${items.length} 項，來源：${src}）`, "success");
      closeModal();
    } catch (e) { toast("建立失敗：" + e.message, "error"); }
  };
}

/* 日曆：新增活動 */
function quickEvent() {
  showModal(`
    <div class="p-6 space-y-3">
      <div class="flex items-center justify-between"><h3 class="font-bold text-lg">➕ 新增活動</h3><button onclick="closeModal()" class="text-slate-400 hover:text-slate-600 text-xl">×</button></div>
      <div class="grid grid-cols-2 gap-2"><input id="qevDate" type="date" class="border rounded-xl px-2 py-2 text-sm"><input id="qevTitle" class="border rounded-xl px-3 py-2 text-sm" placeholder="活動名稱"></div>
      <textarea id="qevDesc" class="w-full border rounded-xl p-2 text-sm" placeholder="詳細描述（選填）"></textarea>
      <input id="qevUrl" class="w-full border rounded-xl px-3 py-2 text-sm" placeholder="超連結 URL（選填）">
      <button id="qevSave" class="btn3d b-indigo w-full">新增活動</button>
    </div>`, { size: "max-w-md" });
  document.getElementById("qevSave").onclick = async () => {
    const d = document.getElementById("qevDate").value, t = document.getElementById("qevTitle").value.trim();
    if (!d || !t) { toast("請填日期與名稱", "warn"); return; }
    try { await db.collection("calendar").add({ date: normDate(d), title: t, desc: document.getElementById("qevDesc").value, url: document.getElementById("qevUrl").value.trim() }); toast("已新增活動", "success"); closeModal(); }
    catch (e) { toast("失敗：" + e.message, "error"); }
  };
}

/* 公告：新增（含圖片） */
function quickAnnouncement() {
  let imgs = [];
  showModal(`
    <div class="p-6 space-y-3">
      <div class="flex items-center justify-between"><h3 class="font-bold text-lg">➕ 新增公告</h3><button onclick="closeModal()" class="text-slate-400 hover:text-slate-600 text-xl">×</button></div>
      <input id="qannTitle" class="w-full border rounded-xl px-3 py-2 text-sm" placeholder="公告標題">
      <textarea id="qannContent" class="w-full border rounded-xl p-3 text-sm" style="min-height:100px" placeholder="內文（可貼網址自動連結、**粗體**）"></textarea>
      <div><label class="text-sm font-medium block mb-1">附加圖片（自動壓縮）</label><input id="qannImgs" type="file" accept="image/*" multiple class="text-sm"><div id="qannPrev" class="flex flex-wrap gap-2 mt-2"></div></div>
      <button id="qannSave" class="btn3d b-rose w-full">發布公告</button>
    </div>`, { size: "max-w-md" });
  document.getElementById("qannImgs").onchange = async (e) => {
    imgs = []; const p = document.getElementById("qannPrev"); p.innerHTML = '<span class="text-xs text-slate-400">壓縮中…</span>';
    for (const f of e.target.files) imgs.push(await compressImage(f));
    p.innerHTML = imgs.map(s => `<img src="${s}" class="w-16 h-16 object-cover rounded">`).join("");
  };
  document.getElementById("qannSave").onclick = async () => {
    const title = document.getElementById("qannTitle").value.trim();
    if (!title) { toast("請輸入標題", "warn"); return; }
    try { await db.collection("announcements").add({ title, content: document.getElementById("qannContent").value, images: imgs, hidden: false, createdAt: firebase.firestore.FieldValue.serverTimestamp() }); toast("公告已發布", "success"); closeModal(); }
    catch (e) { toast("發布失敗：" + e.message, "error"); }
  };
}

/* 資源充電站：新增連結 */
function quickResource() { editResource(null, true); }

/* 小考成績：發布（批次匯入 + 單筆輸入 + AI 提示詞） */
function quickQuiz() {
  showModal(`
    <div class="p-6 space-y-3 overflow-y-auto">
      <div class="flex items-center justify-between"><h3 class="font-bold text-lg">➕ 發布小考成績</h3><button onclick="closeModal()" class="text-slate-400 hover:text-slate-600 text-xl">×</button></div>

      <h4 class="font-bold text-sm">📋 批次匯入</h4>
      <div class="flex items-center gap-2"><label class="text-sm">考試日期</label><input type="date" id="qzDate" value="${todayStr()}" class="border rounded-xl px-2 py-1 text-sm"></div>
      <p class="text-xs text-slate-400">第一行為標題（首欄座號、末欄可放評語），其餘每行一位。例：<code>座號,國語,數學,評語</code></p>
      <textarea id="qzImport" class="w-full border rounded-xl p-3 text-xs font-mono" style="min-height:120px" placeholder="座號,國語,數學,評語&#10;1,95,80,繼續加油&#10;2,80,75,多練習"></textarea>
      <div class="flex gap-2">
        <button onclick="copyText(QUIZ_AI_PROMPT,'已複製 AI 提示詞，快貼給 Gemini！')" class="btn3d b-indigo text-xs flex-1">🤖 複製 AI 提示詞</button>
        <button id="qzPublish2" class="btn3d b-amber text-xs flex-1">發布成績</button>
      </div>

      <div class="border-t pt-3 space-y-2">
        <h4 class="font-bold text-sm">✏️ 單筆輸入／修改</h4>
        <div class="flex items-center gap-2"><label class="text-sm">日期</label><input type="date" id="qsDate" value="${todayStr()}" class="border rounded-xl px-2 py-1 text-sm"></div>
        <div>
          <label class="text-sm">科目（逗號分隔，可改）</label>
          <div class="flex gap-2 mt-1">
            <input id="qsSubjects" class="flex-1 border rounded-xl px-3 py-2 text-sm" placeholder="例：國語,數學">
            <button id="qsApply" class="btn3d b-amber text-xs whitespace-nowrap">套用科目</button>
          </div>
        </div>
        <div id="qsForm" class="hidden space-y-2"></div>
      </div>
    </div>`, { size: "max-w-md" });
  document.getElementById("qzPublish2").onclick = () => publishQuiz(true);
  document.getElementById("qsDate").onchange = loadQsDate;
  document.getElementById("qsApply").onclick = applyQsSubjects;
  loadQsDate();
}

/* 回條：建立項目 */
function quickSlip() {
  showModal(`
    <div class="p-6 space-y-3">
      <div class="flex items-center justify-between"><h3 class="font-bold text-lg">➕ 建立回條</h3><button onclick="closeModal()" class="text-slate-400 hover:text-slate-600 text-xl">×</button></div>
      <input id="qslipName" class="w-full border rounded-xl px-3 py-2 text-sm" placeholder="回條名稱（如：防震演練家長簽章）">
      <div class="flex items-center gap-2"><label class="text-sm">截止日</label><input id="qslipDl" type="date" class="border rounded-xl px-2 py-1 text-sm"></div>
      <button id="qslipSave" class="btn3d b-emerald w-full">建立回條</button>
    </div>`, { size: "max-w-md" });
  document.getElementById("qslipSave").onclick = async () => {
    const name = document.getElementById("qslipName").value.trim();
    if (!name) { toast("請輸入回條名稱", "warn"); return; }
    try { await db.collection("slips").add({ name, deadline: document.getElementById("qslipDl").value, hidden: false, createdAt: firebase.firestore.FieldValue.serverTimestamp() }); toast("回條已建立", "success"); closeModal(); }
    catch (e) { toast("建立失敗：" + e.message, "error"); }
  };
}

