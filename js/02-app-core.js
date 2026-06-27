/* ══════════════════════════════════════════════════════════════════
   02-app-core.js
   啟動流程（init / DOMContentLoaded）、Firebase 連線與匿名登入、
   主程式 startApp、權限判斷、模組顯示與排序、整體刷新。
══════════════════════════════════════════════════════════════════ */

/* ════════ 啟動流程 ════════ */
window.addEventListener("DOMContentLoaded", init);

function init() {
  const mode = localStorage.getItem(LS_MODE);

  /* ── 純本地模式 ── */
  if (mode === "local") {
    LOCAL_MODE = true;
    const classId = LocalDB.getActiveClassId();
    if (!classId) {
      showLocalClassPicker();
      return;
    }
    LocalDB.init(classId);
    db = LocalDB.getShimDb();
    if (typeof firebase === "undefined" || !firebase.firestore) {
      window.firebase = window.firebase || {};
      firebase.firestore = firebase.firestore || function(){};
      firebase.firestore.FieldValue = LocalDB.getShimDb()._fieldValue;
      firebase.firestore.FieldPath = LocalDB.getShimDb().FieldPath;
    }
    document.getElementById("connBar").classList.remove("hidden");
    setConn("local");
    window._localActiveId = classId;
    const btnLC = document.getElementById("btnLocalClass");
    const btnLE = document.getElementById("btnLocalExport");
    if (btnLC) btnLC.classList.remove("hidden");
    if (btnLE) btnLE.classList.remove("hidden");
    restoreSession();
    startApp();
    return;
  }

  /* ── Firebase 模式（原有流程） ── */
  ACTIVE_CONFIG = resolveConfig();
  if (!ACTIVE_CONFIG) {
    showModeSelector();
    return;
  }

  try {
    firebase.initializeApp(ACTIVE_CONFIG);
    db = firebase.firestore();
    auth = firebase.auth();
    document.getElementById("connBar").classList.remove("hidden");
  } catch (e) {
    console.error(e);
    showFatal("Firebase 初始化失敗，請檢查設定是否正確。", e.message);
    return;
  }

  auth.signInAnonymously()
    .then(() => { setConn("ok"); restoreSession(); startApp(); })
    .catch(err => { console.error(err); setConn("err"); showFatal("匿名登入失敗", err.message + "\n\n請確認 Firebase 主控台已啟用「匿名」登入方式。"); });
}

/* ── 顯示「首次使用：選擇模式」引導 ── */
function showModeSelector() {
  const guide = document.getElementById("setupGuide");
  if (guide) guide.classList.remove("hidden");
  showModal(`
    <div class="p-6 space-y-5">
      <div class="text-center space-y-2">
        <div class="text-5xl">👋</div>
        <h2 class="text-xl font-black text-slate-700">歡迎使用班級親師互動網</h2>
        <p class="text-sm text-slate-500">請選擇您要使用的資料儲存方式</p>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button onclick="chooseModeLocal()" class="mode-card group text-left p-5 rounded-2xl border-2 border-violet-200 bg-gradient-to-br from-violet-50 to-purple-50 hover:border-violet-400 hover:shadow-lg transition-all">
          <div class="text-3xl mb-3">💻</div>
          <h3 class="font-black text-violet-700 text-base mb-1">純本地使用</h3>
          <p class="text-xs text-slate-500 leading-relaxed">資料儲存在本機瀏覽器，<b>不需要網路</b>，完全免費。支援多個班級，可匯出備份。</p>
          <div class="mt-3 text-xs text-violet-600 font-bold">✓ 無需設定　✓ 多班級　✓ 可備份匯出</div>
        </button>
        <button onclick="chooseModeFirebase()" class="mode-card group text-left p-5 rounded-2xl border-2 border-sky-200 bg-gradient-to-br from-sky-50 to-blue-50 hover:border-sky-400 hover:shadow-lg transition-all">
          <div class="text-3xl mb-3">☁️</div>
          <h3 class="font-black text-sky-700 text-base mb-1">Firebase 雲端</h3>
          <p class="text-xs text-slate-500 leading-relaxed">資料同步到 Google Firebase 雲端，家長可即時查看，支援多裝置同步。</p>
          <div class="mt-3 text-xs text-sky-600 font-bold">✓ 即時同步　✓ 家長端　✓ 多裝置</div>
        </button>
      </div>
      <p class="text-[11px] text-slate-400 text-center">選擇後可在「系統設定」中切換</p>
    </div>`, { size: "max-w-lg", noBackdropClose: true });
}

window.chooseModeLocal = function() {
  closeModal();
  showLocalClassSetup(true);
};
window.chooseModeFirebase = function() {
  closeModal();
  openSettings();
};

/* ── 本地模式：首次建立班級 ── */
function showLocalClassSetup(isFirst) {
  var classes = LocalDB.getClasses();
  showModal(`
    <div class="p-6 space-y-4">
      <h3 class="text-lg font-bold">💻 純本地模式${isFirst ? "設定" : "管理班級"}</h3>
      ${isFirst ? '<p class="text-sm text-slate-500">請先建立一個班級來開始使用。</p>' : ''}
      <div class="flex gap-2">
        <input id="newClassName" class="flex-1 border rounded-xl px-3 py-2 text-sm" placeholder="輸入班級名稱，例：三年一班" maxlength="30">
        <button onclick="localCreateClass()" class="btn3d b-violet text-sm whitespace-nowrap">＋ 新增班級</button>
      </div>
      <div class="flex items-center gap-2">
        <div class="flex-1 border-t border-slate-200"></div>
        <span class="text-xs text-slate-400">或</span>
        <div class="flex-1 border-t border-slate-200"></div>
      </div>
      <label class="btn3d b-indigo text-sm w-full text-center cursor-pointer block">
        📥 從備份檔匯入班級
        <input type="file" accept=".json,application/json" class="hidden" onchange="localImportFile(this)">
      </label>
      <p class="text-xs text-slate-400 -mt-1">可匯入先前「匯出備份」產生的 .json 檔（單一或多個班級）。</p>
      ${classes.length > 0 ? `
      <div class="space-y-2 max-h-52 overflow-y-auto">
        <div class="text-xs font-bold text-slate-500 mb-1">現有班級</div>
        ${classes.map(c => `
          <div class="flex items-center justify-between bg-violet-50 rounded-xl px-3 py-2 border border-violet-100">
            <span class="font-medium text-sm text-violet-800">${escapeHtml(c.name)}</span>
            <div class="flex gap-2">
              <button onclick="localSwitchClass('${c.id}')" class="text-xs btn3d b-indigo">切換</button>
              <button onclick="localDeleteClass('${c.id}','${escapeHtml(c.name)}')" class="text-xs text-rose-500 hover:text-rose-700 underline">刪除</button>
            </div>
          </div>`).join("")}
      </div>` : ''}
      ${isFirst && classes.length === 0 ? '' : `<button onclick="closeModal()" class="w-full text-sm text-slate-400 underline">取消</button>`}
    </div>`, { size: "max-w-sm", noBackdropClose: isFirst && classes.length === 0 });
}

window.localCreateClass = function() {
  var name = (document.getElementById("newClassName") || {}).value || "";
  name = name.trim();
  if (!name) { toast("請輸入班級名稱", "warn"); return; }
  var id = LocalDB.createClass(name);
  localStorage.setItem(LS_MODE, "local");
  LocalDB.setActiveClass(id);
  closeModal();
  location.reload();
};
window.localSwitchClass = function(id) {
  LocalDB.setActiveClass(id);
  localStorage.setItem(LS_MODE, "local");
  closeModal();
  location.reload();
};
window.localDeleteClass = function(id, name) {
  confirmDialog("刪除班級", `確定要刪除「${name}」及其所有資料？此動作無法復原。`, { okText:"刪除", danger:true }).then(ok => {
    if (!ok) return;
    LocalDB.deleteClass(id);
    const active = LocalDB.getActiveClassId();
    if (active === id) {
      const remaining = LocalDB.getClasses();
      if (remaining.length > 0) { LocalDB.setActiveClass(remaining[0].id); location.reload(); }
      else { localStorage.removeItem("LOCAL_activeClass"); showLocalClassSetup(true); }
    } else { showLocalClassSetup(false); }
  });
};

/* ── 本地模式：班級選擇器（無 active class 時） ── */
function showLocalClassPicker() {
  document.getElementById("setupGuide").classList.remove("hidden");
  showLocalClassSetup(true);
}

function setConn(state) {
  const el = document.getElementById("connStatus"); if (!el) return;
  if (state === "ok")    el.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-500"></span> 已連線';
  if (state === "err")   el.innerHTML = '<span class="w-2 h-2 rounded-full bg-rose-500"></span> 連線失敗';
  if (state === "local") {
    const cls = LocalDB.getClasses().find(c => c.id === LocalDB.getActiveClassId());
    const name = cls ? cls.name : "本地班級";
    el.innerHTML = '<span class="w-2 h-2 rounded-full bg-violet-500"></span> 💻 本地模式・' + escapeHtml(name);
  }
}
function showFatal(title, detail) {
  document.getElementById("setupGuide").classList.remove("hidden");
  showModal(`
    <div class="p-6 space-y-3">
      <h3 class="text-lg font-bold text-rose-600">⚠️ ${title}</h3>
      <pre class="text-xs bg-slate-100 p-3 rounded-xl whitespace-pre-wrap text-slate-600">${detail || ""}</pre>
      <div class="flex justify-end gap-2 pt-1"><button onclick="closeModal();openSettings()" class="btn3d b-blue text-sm">前往設定</button></div>
    </div>`, { size: "max-w-md" });
}

/* ════════ 主程式 ════════ */
function startApp() {
  document.getElementById("moduleArea").classList.remove("hidden");
  document.getElementById("modTabBar").classList.remove("hidden");

  db.collection("classroom").doc("config").onSnapshot(doc => {
    APP_STATE.config = doc.exists ? doc.data() : { className: "班級親師互動網", perms: { ...DEFAULT_PERMS }, teacherPassword: "" };
    applyConfigUI(); renderModuleLocks();
  }, err => console.warn("設定監聽失敗", err));

  db.collection("students").orderBy("seat").onSnapshot(snap => {
    APP_STATE.students = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    refreshActivePanels();
  }, err => console.warn("學生監聽失敗", err));

  db.collection("messages").orderBy("createdAt").onSnapshot(snap => {
    MSG_DATA = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    onMessagesUpdate();
  }, err => console.warn("私訊監聽失敗", err));

  setupContactbook();
  setupHomeworkView();
  setupCalendar();
  setupAnnouncements();
  setupSlips();
  setupResources();
  setupQuiz();
  if (typeof setupPoints === "function") setupPoints();
  if (typeof setupTools === "function") setupTools();
  if (typeof setupSeating === "function") setupSeating();
  countVisitor();
  renderLoginUI();
}

function applyConfigUI() {
  const name = APP_STATE.config?.className || "班級親師互動網";
  document.getElementById("className").textContent = name;
  document.title = name;
}

function permOf(mod) { return (APP_STATE.config?.perms?.[mod]) || DEFAULT_PERMS[mod] || "public"; }
function canView(mod) { if (APP_STATE.isTeacher) return true; const p = permOf(mod); if (p === "off") return false; return p === "public" || isLoggedIn(); }
function isLoggedIn() { return !!APP_STATE.session || APP_STATE.isTeacher; }

/* ════════ 分頁標籤（僅教師端使用） ════════ */
const TAB_META = {
  contactbook:   { label: "聯絡簿", icon: "📒", from: "#38bdf8", to: "#0284c7", shadow: "rgba(2,132,199,.45)" },
  homework:      { label: "作業",   icon: "📝", from: "#fbbf24", to: "#f59e0b", shadow: "rgba(245,158,11,.45)" },
  calendar:      { label: "日曆",   icon: "📅", from: "#a78bfa", to: "#7c3aed", shadow: "rgba(124,58,237,.45)" },
  announcements: { label: "公告",   icon: "📣", from: "#fb7185", to: "#f43f5e", shadow: "rgba(244,63,94,.45)" },
  slips:         { label: "回條",   icon: "📷", from: "#34d399", to: "#10b981", shadow: "rgba(16,185,129,.45)" },
  resources:     { label: "資源",   icon: "📚", from: "#34d399", to: "#059669", shadow: "rgba(5,150,105,.45)" },
  quiz:          { label: "小考",   icon: "✏️",  from: "#fbbf24", to: "#d97706", shadow: "rgba(217,119,6,.45)" },
  points:        { label: "加扣分", icon: "⭐",  from: "#a78bfa", to: "#6d28d9", shadow: "rgba(109,40,217,.45)" },
  tools:         { label: "小工具", icon: "🎰",  from: "#818cf8", to: "#4f46e5", shadow: "rgba(79,70,229,.45)" },
  seating:       { label: "座位表", icon: "💺",  from: "#34d399", to: "#047857", shadow: "rgba(4,120,87,.45)" },
};
let ACTIVE_TAB = null;

/* 取得教師的介面呈現偏好（scroll=捲動 / tab=分頁），預設 scroll */
function teacherViewMode() {
  return localStorage.getItem(LS_TEACHER_VIEW) || "scroll";
}

/* 切換教師介面呈現模式 */
window.toggleTeacherViewMode = function() {
  const next = teacherViewMode() === "tab" ? "scroll" : "tab";
  localStorage.setItem(LS_TEACHER_VIEW, next);
  if (next === "scroll") ACTIVE_TAB = null; // 切回捲動時清除分頁狀態
  applyTabVisibility();
  buildTabBar();
};

function buildTabBar() {
  const bar = document.getElementById("modTabList"); if (!bar) return;
  const tabBarEl = document.getElementById("modTabBar");

  // 非教師 → 隱藏整個分頁列
  if (!APP_STATE.isTeacher) { tabBarEl.classList.add("hidden"); return; }

  // 教師但設定為捲動模式 → 只顯示切換按鈕，不顯示分頁標籤
  const isTabMode = teacherViewMode() === "tab";

  const saved = APP_STATE.config?.moduleOrder;
  const order = (Array.isArray(saved) && saved.length) ? saved.slice() : DEFAULT_ORDER.slice();
  DEFAULT_ORDER.forEach(k => { if (!order.includes(k)) order.push(k); });
  ["points","tools","seating"].forEach(k => { if (!order.includes(k)) order.push(k); });

  const visibleMods = order.filter(k => {
    if (k === "homework") return true; // 教師一定顯示作業
    return moduleVisible(k);
  });

  if (ACTIVE_TAB && !visibleMods.includes(ACTIVE_TAB)) ACTIVE_TAB = null;

  // 切換按鈕（永遠顯示）
  const toggleBtn = `<button onclick="toggleTeacherViewMode()" class="mod-tab-toggle" title="${isTabMode ? "切換為捲動模式" : "切換為分頁模式"}">${isTabMode ? "☰ 捲動" : "⊞ 分頁"}</button>`;

  // 分頁標籤（僅分頁模式顯示）
  const tabs = isTabMode ? visibleMods.map(mod => {
    const m = TAB_META[mod] || { label: mod, icon: "📌", from: "#94a3b8", to: "#64748b", shadow: "rgba(100,116,139,.4)" };
    const active = ACTIVE_TAB === mod;
    const style = active ? `--tab-from:${m.from};--tab-to:${m.to};--tab-shadow:${m.shadow}` : "";
    return `<button class="mod-tab${active ? " active" : ""}" style="${style}" onclick="switchTab('${mod}')">${m.icon} ${m.label}</button>`;
  }).join("") : "";

  bar.innerHTML = toggleBtn + tabs;
  tabBarEl.classList.remove("hidden");
}

window.switchTab = function(mod) {
  if (teacherViewMode() !== "tab") return;
  ACTIVE_TAB = (ACTIVE_TAB === mod) ? null : mod;
  applyTabVisibility();
  buildTabBar();
};

function applyTabVisibility() {
  const useTab = APP_STATE.isTeacher && teacherViewMode() === "tab" && ACTIVE_TAB !== null;

  document.querySelectorAll("[data-module]").forEach(sec => {
    const m = sec.dataset.module;
    if (!moduleVisible(m)) { sec.classList.add("hidden"); return; }
    sec.classList.toggle("hidden", useTab && m !== ACTIVE_TAB);
  });
  const hw = document.getElementById("hwSection");
  if (hw) {
    if (!isLoggedIn()) { hw.classList.add("hidden"); return; }
    hw.classList.toggle("hidden", useTab && ACTIVE_TAB !== "homework");
  }
  const area = document.getElementById("moduleArea");
  if (area) area.classList.toggle("space-y-6", !useTab);
}

/* 模組是否要在主畫面呈現 */
function moduleVisible(mod) {
  const p = permOf(mod);
  if (p === "off") return false;
  if (p === "login") return isLoggedIn();
  return true;
}

function applyModuleVisibility() {
  applyTabVisibility();
  buildTabBar();
}

/* 取得可排序的模組區塊 */
function getOrderableSections() {
  const area = document.getElementById("moduleArea"), map = {};
  if (!area) return map;
  area.querySelectorAll("[data-module]").forEach(s => map[s.dataset.module] = s);
  const hw = document.getElementById("hwSection"); if (hw) map["homework"] = hw;
  return map;
}

/* 依後台設定的順序重排主畫面模組 */
function applyModuleOrder() {
  const area = document.getElementById("moduleArea"); if (!area) return;
  const anchor = document.getElementById("moduleTail"); if (!anchor) return;
  const map = getOrderableSections();
  const saved = APP_STATE.config?.moduleOrder;
  const order = (Array.isArray(saved) && saved.length) ? saved.slice() : DEFAULT_ORDER.slice();
  DEFAULT_ORDER.forEach(k => { if (!order.includes(k)) order.push(k); });
  order.forEach(k => { if (map[k]) area.insertBefore(map[k], anchor); });
}

function renderModuleLocks() {
  document.querySelectorAll("[data-module]").forEach(sec => {
    const mod = sec.dataset.module;
    const lockSpan = sec.querySelector(".modlock");
    if (lockSpan) {
      lockSpan.textContent = permOf(mod) === "login" ? "🔒需登入" : "";
      lockSpan.className = "modlock text-xs align-middle px-1.5 py-0.5 rounded " + (permOf(mod) === "login" ? "bg-amber-100 text-amber-700" : "");
    }
  });
  refreshActivePanels();
}

function refreshActivePanels() {
  applyModuleVisibility();
  applyModuleOrder();
  applyTeacherTools();
  // 逐一呼叫並各自 try/catch，避免任一模組渲染出錯就中斷後面所有模組（例如回條區無法顯示）
  const _safe = (name, fn) => { try { if (typeof fn === "function") fn(); } catch (e) { console.error("[" + name + "] 渲染失敗：", e); } };
  _safe("contactbook", renderContactbook);
  _safe("homework", renderHomeworkView);
  _safe("calendar", renderCalendar);
  _safe("announcements", renderAnnouncements);
  _safe("slips", renderSlips);
  _safe("resources", renderResources);
  _safe("quiz", renderQuiz);
  _safe("points", typeof renderPoints === "function" ? renderPoints : null);
  _safe("tools", typeof renderTools === "function" ? renderTools : null);
  _safe("seating", typeof renderSeating === "function" ? renderSeating : null);
}

function applyTeacherTools() {
  document.querySelectorAll(".teacher-only").forEach(el => el.classList.toggle("hidden", !APP_STATE.isTeacher));
}
