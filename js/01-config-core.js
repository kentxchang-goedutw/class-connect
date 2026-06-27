/* ══════════════════════════════════════════════════════════════════
   01-config-core.js
   Firebase 設定區、LocalStorage 鍵名、Toast、通用模態視窗、
   設定來源解析、全域狀態與各模組共用變數。
   （此檔需最先載入；其餘各檔的函式皆共用此處宣告的全域變數）
══════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════
   【★ Firebase 設定區 ★】
   ────────────────────────────────────────────────────────────────
   使用者請直接修改下方六行引號內的數值，填入您真實的 Firebase 設定即可
   （無需更動變數名稱或大括號）。
   若維持 "demo"，程式會改從網址參數或本機設定（LocalStorage）讀取，
   皆無有效設定時，會進入「主畫面引導」狀態，請點畫面上的「設定」按鈕。
══════════════════════════════════════════════════════════════════ */
const firebaseConfig = {
    apiKey: "demo",
    authDomain: "demo",
    projectId: "demo",
    storageBucket: "demo",
    messagingSenderId: "demo",
    appId: "demo"
};

/* ── LocalStorage 鍵名 ── */
const LS_CONFIG  = "firebaseConfig";   // 動態設定
const LS_DEVICE  = "ptHubDeviceId";    // 不重複訪客用裝置 ID
const LS_SESSION = "ptHubSession";     // 家長登入狀態（記住我）
const LS_MODE    = "ptHubMode";        // "firebase" | "local"
const LS_LOCAL_TEACHER_PWD = "LOCAL_teacherPwd"; // 本地模式老師密碼（班級獨立存）
const LS_TEACHER_VIEW = "ptHubTeacherView"; // 教師介面呈現："scroll"(捲動) | "tab"(分頁)

/* ── 本地模式全域旗標 ── */
let LOCAL_MODE = false;   // true = 純本地模式，false = Firebase 模式

/* ════════ Toast 通知（取代 alert） ════════ */
function toast(msg, type = "info") {
  const colors = { info: "bg-slate-800", success: "bg-emerald-600", error: "bg-rose-600", warn: "bg-amber-600" };
  const el = document.createElement("div");
  el.className = `toast-item pointer-events-auto ${colors[type] || colors.info} text-white text-sm px-4 py-3 rounded-2xl shadow-xl`;
  el.textContent = msg;
  document.getElementById("toastRoot").appendChild(el);
  setTimeout(() => el.remove(), 3100);
}

/* ════════ 通用模態視窗（取代 alert / confirm / prompt） ════════ */
function showModal(html, opts = {}) {
  closeModal();
  const root = document.getElementById("modalRoot");
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto";
  wrap.innerHTML = `<div class="modal-card bg-white rounded-3xl shadow-2xl w-full ${opts.size || 'max-w-lg'} my-8 max-h-[90vh] overflow-hidden flex flex-col">${html}</div>`;
  if (!opts.noBackdropClose) wrap.addEventListener("click", e => { if (e.target === wrap) closeModal(); });
  root.appendChild(wrap);
  return wrap;
}
function closeModal() { document.getElementById("modalRoot").innerHTML = ""; }

/* 自訂確認對話框，回傳 Promise<boolean> */
function confirmDialog(title, message, { okText = "確定", danger = false } = {}) {
  return new Promise(resolve => {
    showModal(`
      <div class="p-6 space-y-4">
        <h3 class="text-lg font-bold">${title}</h3>
        <p class="text-sm text-slate-600 leading-relaxed">${message}</p>
        <div class="flex gap-3 justify-end pt-2">
          <button id="cdNo" class="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-medium hover:bg-slate-200">取消</button>
          <button id="cdYes" class="btn3d ${danger ? 'b-rose' : 'b-blue'} text-sm">${okText}</button>
        </div>
      </div>`, { size: "max-w-sm" });
    document.getElementById("cdNo").onclick  = () => { closeModal(); resolve(false); };
    document.getElementById("cdYes").onclick = () => { closeModal(); resolve(true);  };
  });
}

/* ════════ 設定來源解析（優先級：網址參數 > 寫死 > LocalStorage） ════════ */
function isValidConfig(c) {
  return c && typeof c === "object" && c.apiKey && c.apiKey !== "demo" && c.projectId && c.projectId !== "demo";
}
function resolveConfig() {
  // 優先級 1：網址參數 ?config=BASE64
  try {
    const params = new URLSearchParams(location.search);
    const enc = params.get("config");
    if (enc) {
      const decoded = JSON.parse(decodeURIComponent(escape(atob(enc))));
      if (isValidConfig(decoded)) {
        localStorage.setItem(LS_CONFIG, JSON.stringify(decoded));        // 覆蓋舊設定
        window.history.replaceState({}, document.title, location.pathname); // 清除網址參數
        return decoded;
      }
    }
  } catch (e) { console.warn("網址參數解析失敗", e); }

  // 優先級 2：程式碼寫死
  if (isValidConfig(firebaseConfig)) return firebaseConfig;

  // 優先級 3：LocalStorage 動態設定
  try {
    const saved = JSON.parse(localStorage.getItem(LS_CONFIG) || "null");
    if (isValidConfig(saved)) return saved;
  } catch (e) {}

  return null; // 未設定
}

/* ════════ 全域狀態 ════════ */
let db = null, auth = null, ACTIVE_CONFIG = null;
let APP_STATE = {
  config: null, students: [], session: null, isTeacher: false,
  calMonth: null, calEvents: [],
};
const DEFAULT_PERMS = { contactbook: "login", calendar: "public", announcements: "public", slips: "login", resources: "public", quiz: "login" };
const MODULE_NAMES = { contactbook: "每日聯絡簿", calendar: "班級日曆", announcements: "公告與榮譽榜", slips: "回條拍照回傳", resources: "資源充電站", quiz: "今日小考成績" };

/* 主畫面模組顯示順序（含作業檢核區） */
const DEFAULT_ORDER = ["contactbook", "homework", "calendar", "announcements", "slips", "resources", "quiz"];
const ORDER_LABELS = { contactbook: "每日聯絡簿", homework: "作業檢核", calendar: "班級日曆", announcements: "公告與榮譽榜", slips: "回條拍照回傳", resources: "資源充電站", quiz: "今日小考成績" };
let editOrder = null; // 後台設定面板暫存的排序

/* 作業檢核四狀態 */
const HW_STATES = [
  { label: "未繳交" }, { label: "已繳交" }, { label: "待訂正" }, { label: "已訂正" },
];
let HW_TODAY = null;

/* 私訊資料（家長 ↔ 老師） */
let MSG_DATA = [];
let THREAD_SEAT = null;
let THREAD_RETURN = null; // 關閉對話串時的返回行為（後台分頁 or 浮動收件匣）

/* 資源充電站 / 小考成績 */
let RES_DATA = [];
let QUIZ_DATES = [];      // 已發布的考試日期清單
let QUIZ_CUR = null;      // 目前選取日期的成績資料
let quizCurUnsub = null;
let QS_CACHE = { subjects: [], scores: {} }; // 後台單筆輸入用：目前日期的科目與成績快取
