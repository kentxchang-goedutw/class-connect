/* ══════════════════════════════════════════════════════════════════
   03-auth.js  登入 / 登出（家長端、老師端）
══════════════════════════════════════════════════════════════════ */

/* ════════ 登入 / 登出 ════════ */
document.getElementById("btnLogin").onclick = openLogin;
document.getElementById("btnLogout").onclick = doLogout;

function renderLoginUI() {
  const badge = document.getElementById("loginBadge");
  const bIn = document.getElementById("btnLogin"), bOut = document.getElementById("btnLogout"), bAdmin = document.getElementById("btnAdmin");
  if (APP_STATE.isTeacher) {
    badge.textContent = "👩‍🏫 老師"; badge.classList.remove("hidden");
    bIn.classList.add("hidden"); bOut.classList.remove("hidden"); bAdmin.classList.remove("hidden");
  } else if (APP_STATE.session) {
    badge.textContent = `${APP_STATE.session.seat}號 ${APP_STATE.session.name || ""}`.trim();
    badge.classList.remove("hidden"); bIn.classList.add("hidden"); bOut.classList.remove("hidden"); bAdmin.classList.add("hidden");
  } else {
    badge.classList.add("hidden"); bIn.classList.remove("hidden"); bOut.classList.add("hidden"); bAdmin.classList.add("hidden");
  }
  // 浮動「聯絡老師」按鈕：僅家長登入時顯示
  const floatBtn = document.getElementById("floatContact");
  if (floatBtn) floatBtn.classList.toggle("hidden", !APP_STATE.session);
  updateFloatBadge();
  // 浮動「家長私訊」按鈕：僅老師登入時顯示
  updateTeacherFloat();
}

function restoreSession() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_SESSION) || "null");
    if (s && s.expire > Date.now()) APP_STATE.session = { seat: s.seat, name: s.name };
    else localStorage.removeItem(LS_SESSION);
  } catch (e) {}
}

function openLogin() {
  const seatOptions = APP_STATE.students
    .map(s => `<option value="${s.seat}">${s.seat}號${s.hideName ? "" : (s.name ? " " + s.name : "")}</option>`).join("");
  // 本地版（LOCAL_MODE）只保留老師登入，隱藏家長／學生分頁與表單
  const localOnly = (typeof LOCAL_MODE !== "undefined") && LOCAL_MODE;
  showModal(`
    <div class="p-6 space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-bold">登入</h3>
        <button onclick="closeModal()" class="text-slate-400 hover:text-slate-600 text-xl">×</button>
      </div>
      ${localOnly ? "" : `
      <div class="flex gap-2 text-sm">
        <button id="tabParent" class="flex-1 py-2 rounded-xl bg-blue-600 text-white font-medium">家長／學生</button>
        <button id="tabTeacher" class="flex-1 py-2 rounded-xl bg-slate-100 text-slate-600 font-medium">老師</button>
      </div>`}
      ${localOnly ? "" : `
      <div id="paneParent" class="space-y-3">
        <div>
          <label class="text-sm font-medium">選擇座號</label>
          <select id="loginSeat" class="w-full mt-1 border rounded-xl px-3 py-2 text-sm">${seatOptions || '<option value="">（老師尚未建立名單）</option>'}</select>
        </div>
        <div>
          <label class="text-sm font-medium">專屬密碼</label>
          <input id="loginPwd" type="password" class="w-full mt-1 border rounded-xl px-3 py-2 text-sm" placeholder="老師設定的密碼" />
        </div>
        <label class="flex items-center gap-2 text-sm text-slate-600">
          <input id="loginRemember" type="checkbox" class="rounded" checked /> 記住登入狀態（14 天內免重複登入）
        </label>
        <button id="doParentLogin" class="btn3d b-blue w-full">登入</button>
      </div>`}
      <div id="paneTeacher" class="space-y-3 ${localOnly ? "" : "hidden"}">
        <div>
          <label class="text-sm font-medium">老師後台密碼</label>
          <input id="teacherPwd" type="password" class="w-full mt-1 border rounded-xl px-3 py-2 text-sm" placeholder="管理密碼" />
        </div>
        <p class="text-xs text-slate-400">首次使用：若尚未設定老師密碼，輸入任意密碼即會自動建立後台帳號。</p>
        <button id="doTeacherLogin" class="btn3d b-slate w-full">進入後台</button>
      </div>
    </div>`, { size: "max-w-sm" });

  if (!localOnly) {
    const tP = document.getElementById("tabParent"), tT = document.getElementById("tabTeacher");
    tP.onclick = () => { tP.className = "flex-1 py-2 rounded-xl bg-blue-600 text-white font-medium"; tT.className = "flex-1 py-2 rounded-xl bg-slate-100 text-slate-600 font-medium"; document.getElementById("paneParent").classList.remove("hidden"); document.getElementById("paneTeacher").classList.add("hidden"); };
    tT.onclick = () => { tT.className = "flex-1 py-2 rounded-xl bg-slate-800 text-white font-medium"; tP.className = "flex-1 py-2 rounded-xl bg-slate-100 text-slate-600 font-medium"; document.getElementById("paneTeacher").classList.remove("hidden"); document.getElementById("paneParent").classList.add("hidden"); };
    document.getElementById("doParentLogin").onclick = parentLogin;
    document.getElementById("loginPwd").addEventListener("keydown", e => { if (e.key === "Enter") parentLogin(); });
  }
  document.getElementById("doTeacherLogin").onclick = teacherLogin;
  document.getElementById("teacherPwd").addEventListener("keydown", e => { if (e.key === "Enter") teacherLogin(); });
}

function parentLogin() {
  const seat = document.getElementById("loginSeat").value;
  const pwd = document.getElementById("loginPwd").value;
  const remember = document.getElementById("loginRemember").checked;
  const stu = APP_STATE.students.find(s => String(s.seat) === String(seat));
  if (!stu) { toast("找不到該座號", "error"); return; }
  if (String(stu.password || "") !== pwd) { toast("密碼錯誤，請重新輸入", "error"); return; }
  APP_STATE.session = { seat: stu.seat, name: stu.name || "" };
  if (remember) localStorage.setItem(LS_SESSION, JSON.stringify({ seat: stu.seat, name: stu.name || "", expire: Date.now() + 14 * 864e5 }));
  closeModal(); renderLoginUI(); refreshActivePanels();
  toast(`歡迎，${stu.seat}號 ${stu.hideName ? "" : (stu.name || "")}！`, "success");
}

async function teacherLogin() {
  const pwd = document.getElementById("teacherPwd").value;
  if (!pwd) { toast("請輸入密碼", "warn"); return; }

  if (LOCAL_MODE) {
    // 純本地模式：密碼存在 localStorage（以班級 prefix 隔離）
    const activeId = LocalDB.getActiveClassId();
    const lsKey = "LOCAL_ldb_" + activeId + "_teacherPwd";
    const stored = localStorage.getItem(lsKey) || "";
    if (!stored) {
      localStorage.setItem(lsKey, pwd);
      toast("已建立老師後台密碼", "success");
    } else if (stored !== pwd) {
      toast("後台密碼錯誤", "error"); return;
    }
    // 同步更新 config 讓 APP_STATE 也有 teacherPassword
    const cfg = APP_STATE.config || {};
    cfg.teacherPassword = pwd;
    APP_STATE.config = cfg;
  } else {
    const stored = APP_STATE.config?.teacherPassword || "";
    if (!stored) { await db.collection("classroom").doc("config").set({ teacherPassword: pwd }, { merge: true }); toast("已建立老師後台密碼", "success"); }
    else if (stored !== pwd) { toast("後台密碼錯誤", "error"); return; }
  }

  APP_STATE.isTeacher = true; closeModal(); renderLoginUI(); refreshActivePanels();
  toast("老師後台已解鎖", "success");
}

function doLogout() {
  APP_STATE.session = null; APP_STATE.isTeacher = false; localStorage.removeItem(LS_SESSION);
  renderLoginUI(); refreshActivePanels(); toast("已登出", "info");
}

