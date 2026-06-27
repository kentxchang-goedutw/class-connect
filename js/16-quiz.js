/* ══════════════════════════════════════════════════════════════════
   16-quiz.js  今日小考成績（前台查看、後台批次/單筆、AI 提示詞）
══════════════════════════════════════════════════════════════════ */

/* ════════════════════ 模組：今日小考成績 ════════════════════ */
function setupQuiz() {
  db.collection("quizIndex").doc("dates").onSnapshot(doc => {
    QUIZ_DATES = (doc.exists ? (doc.data().list || []) : []).slice().sort().reverse();
    populateQuizDates();
  }, err => console.warn("小考日期監聽失敗", err));
}
function populateQuizDates() {
  const sel = document.getElementById("quizDate"); if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = QUIZ_DATES.length ? QUIZ_DATES.map(d => `<option value="${d}">${d}</option>`).join("") : '<option value="">（尚無紀錄）</option>';
  if (QUIZ_DATES.includes(prev)) sel.value = prev; else if (QUIZ_DATES.length) sel.value = QUIZ_DATES[0];
  sel.onchange = loadQuiz;
  loadQuiz();
}
function loadQuiz() {
  if (quizCurUnsub) quizCurUnsub();
  const sel = document.getElementById("quizDate"); const d = sel ? sel.value : "";
  if (!d) { QUIZ_CUR = null; renderQuiz(); return; }
  quizCurUnsub = db.collection("quiz").doc(d).onSnapshot(doc => { QUIZ_CUR = doc.exists ? doc.data() : null; renderQuiz(); });
}
function renderQuiz() {
  const locked = document.getElementById("quizLocked"), box = document.getElementById("quizBox");
  if (!box) return;
  if (!canView("quiz")) { locked.classList.remove("hidden"); box.classList.add("hidden"); return; }
  locked.classList.add("hidden"); box.classList.remove("hidden");
  if (!QUIZ_CUR || !(QUIZ_CUR.subjects || []).length) { box.innerHTML = '<p class="text-slate-400 text-sm py-4 text-center">此日期尚無小考成績。</p>'; return; }
  const subjects = QUIZ_CUR.subjects, scores = QUIZ_CUR.scores || {};
  if (APP_STATE.session && !APP_STATE.isTeacher) {
    // 家長：嚴格隱私，只顯示自己孩子
    const seat = String(APP_STATE.session.seat), my = scores[seat];
    if (!my) { box.innerHTML = '<p class="text-slate-400 text-sm py-4 text-center">本日查無您孩子的小考成績。</p>'; return; }
    const cards = subjects.map(s => `<div class="quiz-score"><div class="qs-sub">${escapeHtml(s)}</div><div class="qs-val">${escapeHtml(my[s] ?? "—")}</div></div>`).join("");
    const comment = my.comment ? `<div class="mt-3 text-sm bg-white/70 border border-white/70 rounded-xl p-3"><b class="text-amber-700">老師評語：</b>${escapeHtml(my.comment)}</div>` : "";
    box.innerHTML = `<div class="text-xs text-slate-500 mb-2">${escapeHtml(seat)}號 ${escapeHtml(APP_STATE.session.name || "")} ・ ${escapeHtml(QUIZ_CUR.date || "")}</div><div class="grid grid-cols-2 sm:grid-cols-3 gap-2">${cards}</div>${comment}`;
  } else {
    // 老師：全班表格檢視
    box.innerHTML = `<div class="overflow-x-auto"><table class="hw-table text-sm"><thead><tr><th class="hw-th-seat">座號</th>${subjects.map(s => `<th class="hw-th">${escapeHtml(s)}</th>`).join("")}<th class="hw-th">評語</th></tr></thead><tbody>${APP_STATE.students.map(st => {
      const r = scores[String(st.seat)] || {};
      return `<tr><td class="hw-td-seat">${escapeHtml(st.seat)} ${escapeHtml(st.hideName ? "" : (st.name || ""))}</td>${subjects.map(s => `<td class="text-center px-2">${escapeHtml(r[s] ?? "—")}</td>`).join("")}<td class="px-2 text-xs">${escapeHtml(r.comment || "")}</td></tr>`;
    }).join("")}</tbody></table></div>`;
  }
}

/* 小考成績 AI 轉換提示詞 */
const QUIZ_AI_PROMPT = `你現在是一位細心的國中小班級成績登錄助手。我會提供你某次小考的雜亂成績資料（可能來自手寫成績單的文字、語音輸入、或 LINE 群組訊息，例如：「1號95、2號80再加油、3號未到、5號100」）。請幫我整理成可批次匯入的【固定格式】。

【固定格式要求】
1. 第一行為「標題列」，第一欄固定是「座號」，接著是各個考試科目名稱，最後一欄固定是「評語」。
   範例標題：座號,國語,數學,評語
2. 第二行起，每一位學生一行，欄位順序與標題列一致。
3. 各欄位之間請使用英文半形逗號（,）分隔（你也可以改用 Tab 鍵分隔）。
4. 只輸出分數數字；若該生缺考/未到，分數欄請填「缺考」。
5. 評語欄若沒有就留空（但前面的逗號仍要保留）。原始文字中若有鼓勵語（如「再加油」），請放到該生的評語欄。
6. 科目名稱請依我提供的資料判斷；若我沒明講科目，就用「成績」當唯一科目。
7. 除了符合格式的行數外，不要輸出任何多餘的解釋、前言、後記或 Markdown 標籤（如 \`\`\`）。

【輸出格式範例】
座號,國語,數學,評語
1,95,80,
2,80,75,再加油
3,缺考,缺考,
5,100,100,表現優異

【我的原始小考成績資料如下】：
----------
（請在此處貼上你的手寫成績單文字、語音輸入內容，或 LINE 群組複製過來的雜亂分數）
----------`;

/* 解析小考批次匯入文字 → { subjects, scores } 或 { error } */
function parseQuizImport(text) {
  const lines = text.split("\n").map(l => l.replace(/\s+$/, "")).filter(l => l.trim());
  if (lines.length < 2) return { error: "至少需要一行標題列與一行成績資料" };
  const sep0 = lines[0].includes("\t") ? "\t" : ",";
  const header = lines[0].split(sep0).map(h => h.trim());
  if (!/座號|座号|號/.test(header[0])) return { error: "第 1 行需為標題列，且第一欄為「座號」" };
  let commentIdx = -1;
  header.forEach((h, i) => { if (/評語|評論|comment|備註/i.test(h)) commentIdx = i; });
  const subjects = [];
  header.forEach((h, i) => { if (i === 0 || i === commentIdx) return; if (h) subjects.push(h); });
  const scores = {}, errors = [];
  for (let i = 1; i < lines.length; i++) {
    const sep = lines[i].includes("\t") ? "\t" : ",";
    const cols = lines[i].split(sep).map(c => c.trim());
    const seat = cols[0];
    if (!seat) { errors.push(i + 1); continue; }
    const rec = {};
    header.forEach((h, ci) => { if (ci === 0) return; const val = cols[ci] || ""; if (ci === commentIdx) rec.comment = val; else if (h) rec[h] = val; });
    scores[seat] = rec;
  }
  if (errors.length) return { error: `第 ${errors.join("、")} 行缺座號` };
  return { subjects, scores };
}
/* 後台：小考成績管理 */
function adminQuiz(body) {
  const dates = QUIZ_DATES.slice();
  body.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center gap-2"><label class="text-sm font-medium">考試日期</label><input type="date" id="qzDate" value="${todayStr()}" class="border rounded-xl px-2 py-1 text-sm"></div>
      <div>
        <label class="text-sm font-medium">批次匯入成績</label>
        <p class="text-xs text-slate-400 mb-1">第一行為<b>標題列</b>（第一欄需為「座號」，最後一欄可放「評語」），其餘每行一位學生，逗號或 Tab 分隔。例：<br><code>座號,國語,數學,評語</code><br><code>1,95,80,繼續加油</code></p>
        <textarea id="qzImport" class="w-full border rounded-xl p-3 text-xs font-mono" style="min-height:140px" placeholder="座號,國語,數學,評語&#10;1,95,80,繼續加油&#10;2,80,75,多練習&#10;3,缺考,缺考,"></textarea>
      </div>
      <button id="qzPublish" class="btn3d b-amber w-full">發布此日期成績</button>

      <div class="border-t pt-4 space-y-2">
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

      <div class="border-t pt-4 bg-indigo-50 -mx-2 px-3 py-3 rounded-xl">
        <div class="flex items-center justify-between"><h4 class="font-bold text-sm">🤖 AI 成績轉換助手</h4><button id="qzCopyPrompt" class="btn3d b-indigo text-xs">一鍵複製 Prompt</button></div>
        <p class="text-xs text-slate-500 mt-1">複製後貼給 Gemini，再附上手寫成績單照片／語音輸入／LINE 雜亂文字，AI 會轉成上方格式，貼回匯入框即可一次發布。</p>
      </div>
      <div class="border-t pt-4 space-y-1"><h4 class="font-bold text-sm">已發布日期（${dates.length}）</h4>${dates.length ? dates.map(d => `<div class="flex items-center justify-between border rounded-lg p-2 text-sm"><span>${escapeHtml(d)}</span><div class="flex gap-2"><button onclick="loadQuizToImport('${d}')" class="text-blue-600 text-xs underline">載入編輯</button><button onclick="delQuiz('${d}')" class="text-rose-600 text-xs underline">刪除</button></div></div>`).join("") : '<p class="text-slate-400 text-sm">尚無紀錄</p>'}</div>
    </div>`;
  document.getElementById("qzPublish").onclick = () => publishQuiz(false);
  document.getElementById("qzCopyPrompt").onclick = () => copyText(QUIZ_AI_PROMPT, "已複製 AI 提示詞，快貼給 Gemini！");
  document.getElementById("qsDate").onchange = loadQsDate;
  document.getElementById("qsApply").onclick = applyQsSubjects;
  loadQsDate();
}
/* 單筆輸入：載入該日期已存在的科目與成績 */
async function loadQsDate() {
  const d = document.getElementById("qsDate")?.value;
  const subjInput = document.getElementById("qsSubjects"), form = document.getElementById("qsForm");
  if (!d) return;
  try {
    const doc = await db.collection("quiz").doc(d).get();
    QS_CACHE = doc.exists ? { subjects: doc.data().subjects || [], scores: doc.data().scores || {} } : { subjects: [], scores: {} };
  } catch (e) { QS_CACHE = { subjects: [], scores: {} }; }
  if (subjInput) subjInput.value = QS_CACHE.subjects.join(",");
  if (QS_CACHE.subjects.length) renderQuizSingleForm(QS_CACHE.subjects);
  else if (form) { form.classList.add("hidden"); form.innerHTML = ""; }
}
/* 套用科目欄位 */
function applyQsSubjects() {
  const raw = document.getElementById("qsSubjects")?.value || "";
  const subjects = raw.split(/[,，、\t]/).map(s => s.trim()).filter(Boolean);
  if (!subjects.length) { toast("請至少輸入一個科目", "warn"); return; }
  QS_CACHE.subjects = subjects;
  renderQuizSingleForm(subjects);
}
/* 渲染單筆輸入表單 */
function renderQuizSingleForm(subjects) {
  const box = document.getElementById("qsForm"); if (!box) return;
  if (!APP_STATE.students.length) { box.classList.remove("hidden"); box.innerHTML = '<p class="text-slate-400 text-sm">尚無學生名單，請先建立學生帳號。</p>'; return; }
  box.classList.remove("hidden");
  const seatOpts = APP_STATE.students.map(s => `<option value="${s.seat}">${s.seat}號${s.hideName ? "" : (s.name ? " " + s.name : "")}</option>`).join("");
  box.innerHTML = `
    <div><label class="text-xs">座號</label><select id="qsSeat" class="w-full border rounded-xl px-2 py-2 text-sm">${seatOpts}</select></div>
    <div class="grid grid-cols-2 gap-2">${subjects.map(s => `<div><label class="text-xs">${escapeHtml(s)}</label><input data-subj="${escapeHtml(s)}" class="w-full border rounded-xl px-2 py-1.5 text-sm" placeholder="分數"></div>`).join("")}</div>
    <div><label class="text-xs">評語</label><input id="qsComment" class="w-full border rounded-xl px-2 py-1.5 text-sm" placeholder="選填"></div>
    <button id="qsSave" class="btn3d b-amber w-full text-sm">儲存此生成績</button>`;
  document.getElementById("qsSeat").onchange = fillQsSeat;
  fillQsSeat();
  document.getElementById("qsSave").onclick = saveQuizSingle;
}
/* 切換座號時，帶入該生已輸入的成績 */
function fillQsSeat() {
  const seat = document.getElementById("qsSeat")?.value; if (!seat) return;
  const rec = QS_CACHE.scores[seat] || {};
  document.querySelectorAll("#qsForm [data-subj]").forEach(inp => { inp.value = rec[inp.dataset.subj] ?? ""; });
  const c = document.getElementById("qsComment"); if (c) c.value = rec.comment || "";
}
/* 儲存單筆成績（merge 寫入，不影響其他學生與日期） */
async function saveQuizSingle() {
  const date = document.getElementById("qsDate")?.value;
  const seat = document.getElementById("qsSeat")?.value;
  if (!date || !seat) { toast("請選擇日期與座號", "warn"); return; }
  const rec = {};
  document.querySelectorAll("#qsForm [data-subj]").forEach(inp => { rec[inp.dataset.subj] = inp.value.trim(); });
  rec.comment = (document.getElementById("qsComment")?.value || "").trim();
  try {
    await db.collection("quiz").doc(date).set({ date, subjects: QS_CACHE.subjects, scores: { [seat]: rec } }, { merge: true });
    await db.collection("quizIndex").doc("dates").set({ list: firebase.firestore.FieldValue.arrayUnion(date) }, { merge: true });
    QS_CACHE.scores[seat] = rec; // 更新快取，方便連續輸入下一位
    toast(`已儲存 ${seat}號 成績`, "success");
  } catch (e) { toast("儲存失敗：" + e.message, "error"); }
}
async function loadQuizToImport(d) {
  try {
    const doc = await db.collection("quiz").doc(d).get();
    if (!doc.exists) { toast("查無資料", "warn"); return; }
    const data = doc.data(), subjects = data.subjects || [], scores = data.scores || {};
    const header = ["座號", ...subjects, "評語"].join(",");
    const rows = Object.keys(scores).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(seat => {
      const r = scores[seat]; return [seat, ...subjects.map(s => r[s] ?? ""), r.comment || ""].join(",");
    });
    document.getElementById("qzDate").value = d;
    document.getElementById("qzImport").value = [header, ...rows].join("\n");
    toast("已載入該日期成績，可修改後重新發布", "info");
  } catch (e) { toast("載入失敗：" + e.message, "error"); }
}
async function publishQuiz(fromQuick) {
  const date = document.getElementById("qzDate").value;
  if (!date) { toast("請選擇考試日期", "warn"); return; }
  const parsed = parseQuizImport(document.getElementById("qzImport").value);
  if (parsed.error) { toast(parsed.error, "error"); return; }
  if (!parsed.subjects.length) { toast("未偵測到任何科目欄位（標題列除了座號/評語外需至少一個科目）", "warn"); return; }
  const cnt = Object.keys(parsed.scores).length;
  if (!await confirmDialog("發布成績", `將發布 <b>${escapeHtml(date)}</b> 的小考成績（科目：${escapeHtml(parsed.subjects.join("、"))}，共 ${cnt} 位），確定？`, { okText: "發布" })) return;
  try {
    await db.collection("quiz").doc(date).set({ date, subjects: parsed.subjects, scores: parsed.scores, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    await db.collection("quizIndex").doc("dates").set({ list: firebase.firestore.FieldValue.arrayUnion(date) }, { merge: true });
    toast("成績已發布", "success");
    if (fromQuick) closeModal(); else { openAdmin(); adminGoTab(9); }
  } catch (e) { toast("發布失敗：" + e.message, "error"); }
}
async function delQuiz(d) {
  if (!await confirmDialog("刪除成績", `確定刪除 ${d} 的小考成績？`, { okText: "刪除", danger: true })) return;
  try {
    await db.collection("quiz").doc(d).delete();
    await db.collection("quizIndex").doc("dates").set({ list: firebase.firestore.FieldValue.arrayRemove(d) }, { merge: true });
    toast("已刪除", "info"); openAdmin(); adminGoTab(9);
  } catch (e) { toast("刪除失敗：" + e.message, "error"); }
}

