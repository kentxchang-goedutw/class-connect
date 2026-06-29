/* ════════════════════════════════════════════════════════════════════
   80-tools.js  課堂小工具模組
   ────────────────────────────────────────────────────────────────────
   內含：
     ① 隨機抽人  — 可設定「不重複」模式，已抽過的學生標記排除
     ② 倒數計時器 — 可全螢幕、超大數字顯示；倒數 10 秒內有合成音效
   ════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  /* ── 1. 註冊模組 ── */
  function registerModule() {
    if (typeof DEFAULT_PERMS === "object" && !DEFAULT_PERMS.tools) DEFAULT_PERMS.tools = "login";
    if (typeof MODULE_NAMES === "object") MODULE_NAMES.tools = "課堂小工具";
    if (typeof ORDER_LABELS === "object") ORDER_LABELS.tools = "課堂小工具";
    if (typeof DEFAULT_ORDER !== "undefined" && Array.isArray(DEFAULT_ORDER) && DEFAULT_ORDER.indexOf("tools") < 0)
      DEFAULT_ORDER.push("tools");
  }

  /* ── 2. 抽人狀態 ── */
  var PICK_NO_REPEAT = true;   // 不重複模式
  var PICKED_IDS = [];         // 已抽過的學生 id
  var SPINNING = false;

  /* ── 3. 計時器狀態 ── */
  var TIMER_VAL = 0;           // 剩餘秒數
  var TIMER_TOTAL = 0;         // 設定秒數（用來算進度條）
  var TIMER_RAF = null;        // requestAnimationFrame handle
  var TIMER_LAST = null;       // 上次 tick 時間
  var TIMER_RUNNING = false;
  var TIMER_FS = false;        // 全螢幕模式
  var audioCtx = null;

  /* ── 4. 啟動 ── */
  function setupTools() {
    registerModule();
    renderTools();
    cdSubscribe();   // 訂閱活動倒數資料庫，便利貼即時同步
  }

  /* ── 5. 主畫面渲染 ── */
  function renderTools() {
    // 便利貼為全班顯示，不受課堂小工具權限影響；登入狀態改變時也重繪以更新拖曳權限
    try { renderCdNotes(); } catch (e) {}
    var section = document.querySelector('[data-module="tools"]');
    if (!section) return;

    var cfg = APP_STATE.config || {};
    var perm = (cfg.perms && cfg.perms.tools) || DEFAULT_PERMS.tools || "login";
    if (perm === "off") { section.style.display = "none"; return; }
    section.style.display = "";

    var locked = document.getElementById("toolsLocked");
    var content = document.getElementById("toolsContent");
    if (perm === "login" && !APP_STATE.session && !APP_STATE.isTeacher) {
      if (locked) locked.classList.remove("hidden");
      if (content) content.classList.add("hidden");
      return;
    }
    if (locked) locked.classList.add("hidden");
    if (content) content.classList.remove("hidden");
  }

  /* ══════════════════════════════════════════
     抽人工具
  ══════════════════════════════════════════ */

  /* 打開抽人視窗 */
  window.openPicker = function () {
    if (!checkTeacher()) return;
    var students = APP_STATE.students || [];
    if (!students.length) { toast("尚無學生資料，請先在後台建立學生。", "warn"); return; }

    showModal(buildPickerHtml(), { size: "max-w-lg", noBackdropClose: false });
    renderPickerBody();

    document.getElementById("pickNoRepeat").addEventListener("change", function () {
      PICK_NO_REPEAT = this.checked;
    });
    document.getElementById("pickNoRepeat").checked = PICK_NO_REPEAT;
  };

  function buildPickerHtml() {
    return '<div class="flex flex-col" style="max-height:90vh">' +
      '<div class="px-6 py-4 border-b flex items-center justify-between shrink-0">' +
        '<h3 class="text-lg font-bold flex items-center gap-2">🎰 隨機抽人</h3>' +
        '<button onclick="closeModal()" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">×</button>' +
      '</div>' +
      '<div class="px-6 py-3 border-b shrink-0 flex items-center justify-between gap-3">' +
        '<label class="flex items-center gap-2 text-sm font-medium cursor-pointer select-none">' +
          '<input type="checkbox" id="pickNoRepeat" class="w-4 h-4 rounded accent-violet-600">' +
          '<span>不重複模式</span>' +
          '<span class="text-xs text-slate-400">（已抽過的自動排除）</span>' +
        '</label>' +
        '<button onclick="resetPicked()" class="text-xs text-rose-500 hover:text-rose-700 underline">重設已抽名單</button>' +
      '</div>' +
      '<div id="pickerBody" class="flex-1 overflow-y-auto"></div>' +
    '</div>';
  }

  function renderPickerBody() {
    var body = document.getElementById("pickerBody");
    if (!body) return;
    var students = APP_STATE.students || [];
    var remaining = PICK_NO_REPEAT
      ? students.filter(function (s) { return PICKED_IDS.indexOf(s.id) < 0; })
      : students;

    body.innerHTML =
      '<div class="px-6 py-5 space-y-5">' +
        /* 大轉盤結果區 */
        '<div id="pickResult" class="tools-pick-result">' +
          '<div class="tools-pick-placeholder">按下「開始抽人」</div>' +
        '</div>' +
        /* 按鈕 */
        '<div class="flex gap-3 justify-center">' +
          '<button onclick="doPick()" class="tools-btn-spin" id="btnDoPick">' +
            (remaining.length === 0 ? '🔄 全部抽完！請重設' : '🎲 開始抽人') +
          '</button>' +
        '</div>' +
        /* 剩餘 / 已抽 統計 */
        '<div class="flex items-center justify-between text-xs text-slate-400 px-1">' +
          '<span>剩餘可抽：<b class="text-violet-600">' + remaining.length + '</b> 人</span>' +
          '<span>已抽：<b class="text-rose-500">' + PICKED_IDS.length + '</b> 人</span>' +
        '</div>' +
        /* 已抽名單 */
        (PICKED_IDS.length > 0
          ? '<div class="tools-picked-list">' +
              '<div class="text-xs font-bold text-slate-500 mb-2">已抽名單</div>' +
              '<div class="flex flex-wrap gap-2">' +
                PICKED_IDS.map(function (id) {
                  var st = students.find(function (s) { return s.id === id; });
                  return st
                    ? '<span class="tools-picked-chip">' + (st.seat || "") + '號 ' + escHtml(st.name) + '</span>'
                    : '';
                }).join("") +
              '</div>' +
            '</div>'
          : '') +
      '</div>';
  }

  /* 執行抽人動畫（全螢幕） */
  window.doPick = function () {
    if (SPINNING) return;
    var students = APP_STATE.students || [];
    var pool = PICK_NO_REPEAT
      ? students.filter(function (s) { return PICKED_IDS.indexOf(s.id) < 0; })
      : students;

    if (pool.length === 0) {
      toast("全部學生都已抽過，請按「重設已抽名單」", "warn");
      return;
    }

    SPINNING = true;

    // 建立全螢幕抽人動畫覆蓋層
    var overlay = document.createElement("div");
    overlay.id = "pickFsOverlay";
    overlay.className = "tools-pick-fs";
    overlay.innerHTML =
      '<div class="tools-pick-fs-inner">' +
        '<div class="tools-pick-fs-label">🎰 抽人中…</div>' +
        '<div id="pickFsResult" class="tools-pick-fs-result">' +
          '<span class="tools-pick-fs-seat">—</span>' +
          '<span class="tools-pick-fs-name">　</span>' +
        '</div>' +
        '<div id="pickFsActions" class="tools-pick-fs-actions" style="visibility:hidden">' +
          '<button id="pickFsAgain" class="tools-btn-fs-start">🎲 再抽一位</button>' +
          '<button id="pickFsClose" class="tools-btn-fs-close">✕ 關閉</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    var resultEl = document.getElementById("pickFsResult");
    var labelEl = overlay.querySelector(".tools-pick-fs-label");

    var ticks = 0;
    var shuffleInterval = setInterval(function () {
      var rand = pool[Math.floor(Math.random() * pool.length)];
      resultEl.className = "tools-pick-fs-result tools-pick-fs-spin";
      resultEl.innerHTML =
        '<span class="tools-pick-fs-seat">' + (rand.seat || "") + '號</span>' +
        '<span class="tools-pick-fs-name">' + escHtml(rand.name) + '</span>';
      ticks++;
      if (ticks > 16) { clearInterval(shuffleInterval); setTimeout(finalize, 70 * (ticks - 16)); }
    }, 70);

    function finalize() {
      var winner = pool[Math.floor(Math.random() * pool.length)];
      if (PICK_NO_REPEAT) PICKED_IDS.push(winner.id);
      playPickSound();
      if (labelEl) labelEl.textContent = "🎉 抽中了！";
      resultEl.className = "tools-pick-fs-result tools-pick-fs-win";
      resultEl.innerHTML =
        '<div class="tools-pick-fs-burst">🎉</div>' +
        '<span class="tools-pick-fs-seat">' + (winner.seat || "") + '號</span>' +
        '<span class="tools-pick-fs-name">' + escHtml(winner.name) + '</span>';

      var actions = document.getElementById("pickFsActions");
      if (actions) actions.style.visibility = "visible";
      SPINNING = false;

      var againBtn = document.getElementById("pickFsAgain");
      var closeBtn = document.getElementById("pickFsClose");
      // 全部抽完則停用「再抽」
      var left = PICK_NO_REPEAT ? students.filter(function (s) { return PICKED_IDS.indexOf(s.id) < 0; }).length : students.length;
      if (againBtn) {
        if (left === 0) { againBtn.disabled = true; againBtn.textContent = "已全部抽完"; }
        else againBtn.onclick = function () { closePickFs(); window.doPick(); };
      }
      if (closeBtn) closeBtn.onclick = closePickFs;

      // 同步更新底層 modal 的統計（若仍開著）
      if (document.getElementById("pickerBody")) renderPickerBody();
    }
  };

  function closePickFs() {
    var o = document.getElementById("pickFsOverlay");
    if (o) o.remove();
    SPINNING = false;
  }
  window.closePickFs = closePickFs;

  window.resetPicked = function () {
    PICKED_IDS = [];
    renderPickerBody();
    toast("已抽名單已清除", "success");
  };

  /* 抽人音效（Web Audio API 合成） */
  function playPickSound() {
    try {
      var ctx = getAudioCtx();
      var t = ctx.currentTime;
      [0, 0.12, 0.24].forEach(function (delay, i) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(440 + i * 220, t + delay);
        osc.frequency.exponentialRampToValueAtTime(880 + i * 220, t + delay + 0.1);
        gain.gain.setValueAtTime(0.3, t + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.25);
        osc.start(t + delay); osc.stop(t + delay + 0.3);
      });
    } catch (e) {}
  }

  /* ══════════════════════════════════════════
     倒數計時器
  ══════════════════════════════════════════ */

  window.openTimer = function () {
    if (!checkTeacher()) return;
    showModal(buildTimerHtml(), { size: "max-w-sm", noBackdropClose: false });
    bindTimerEvents();
    renderTimerDisplay();
  };

  function buildTimerHtml() {
    var presets = [1, 2, 3, 5, 10, 15, 20, 30];
    return '<div class="flex flex-col" style="max-height:90vh">' +
      '<div class="px-5 py-4 border-b flex items-center justify-between shrink-0">' +
        '<h3 class="text-lg font-bold flex items-center gap-2">⏱️ 倒數計時器</h3>' +
        '<div class="flex gap-2">' +
          '<button onclick="timerFullscreen()" class="text-slate-400 hover:text-slate-600 text-xl" title="全螢幕">⛶</button>' +
          '<button onclick="closeModal()" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">×</button>' +
        '</div>' +
      '</div>' +
      '<div class="px-5 py-5 space-y-5">' +
        /* 大數字顯示 */
        '<div id="timerDisplay" class="tools-timer-display">' +
          '<div id="timerDigits" class="tools-timer-digits">00:00</div>' +
          '<div id="timerProgress" class="tools-timer-bar"><div id="timerBarFill" class="tools-timer-bar-fill"></div></div>' +
        '</div>' +
        /* 快速預設 */
        '<div>' +
          '<div class="text-xs text-slate-500 font-medium mb-2">快速設定（分鐘）</div>' +
          '<div class="flex flex-wrap gap-2">' +
            presets.map(function (m) {
              return '<button onclick="timerSetMins(' + m + ')" class="tools-preset-btn">' + m + ' 分</button>';
            }).join("") +
          '</div>' +
        '</div>' +
        /* 自訂 */
        '<div class="flex items-center gap-2">' +
          '<div class="text-xs text-slate-500 font-medium shrink-0">自訂</div>' +
          '<input type="number" id="timerCustomMin" min="0" max="99" value="0" class="w-16 border rounded-xl px-2 py-1.5 text-sm text-center">' +
          '<span class="text-sm text-slate-500">分</span>' +
          '<input type="number" id="timerCustomSec" min="0" max="59" value="0" class="w-16 border rounded-xl px-2 py-1.5 text-sm text-center">' +
          '<span class="text-sm text-slate-500">秒</span>' +
          '<button onclick="timerSetCustom()" class="btn3d b-blue text-xs">設定</button>' +
        '</div>' +
        /* 控制按鈕 */
        '<div class="flex gap-3 justify-center">' +
          '<button id="btnTimerStart" onclick="timerToggle()" class="tools-btn-timer-start">▶ 開始</button>' +
          '<button onclick="timerReset()" class="tools-btn-timer-reset">↺ 重設</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function bindTimerEvents() {
    // 已在 HTML onclick 綁定，這裡可擴充
  }

  /* 設定時間 */
  window.timerSetMins = function (m) {
    timerStop();
    TIMER_VAL = m * 60;
    TIMER_TOTAL = TIMER_VAL;
    renderTimerDisplay();
  };

  window.timerSetCustom = function () {
    var m = parseInt(document.getElementById("timerCustomMin").value) || 0;
    var s = parseInt(document.getElementById("timerCustomSec").value) || 0;
    timerStop();
    TIMER_VAL = m * 60 + s;
    TIMER_TOTAL = TIMER_VAL;
    renderTimerDisplay();
  };

  /* 開始/暫停 */
  window.timerToggle = function () {
    if (TIMER_VAL <= 0) { toast("請先設定時間", "warn"); return; }
    if (TIMER_RUNNING) timerPause();
    else timerStart();
  };

  function timerStart() {
    if (TIMER_VAL <= 0) return;
    TIMER_RUNNING = true;
    TIMER_LAST = performance.now();
    if (TIMER_TOTAL === 0) TIMER_TOTAL = TIMER_VAL;
    updateStartBtn();
    TIMER_RAF = requestAnimationFrame(timerTick);
  }

  function timerPause() {
    TIMER_RUNNING = false;
    if (TIMER_RAF) cancelAnimationFrame(TIMER_RAF);
    updateStartBtn();
  }

  function timerStop() {
    TIMER_RUNNING = false;
    if (TIMER_RAF) cancelAnimationFrame(TIMER_RAF);
  }

  window.timerReset = function () {
    timerStop();
    TIMER_VAL = TIMER_TOTAL;
    renderTimerDisplay();
    updateStartBtn();
  };

  /* 每幀更新 */
  function timerTick(now) {
    if (!TIMER_RUNNING) return;
    var elapsed = (now - TIMER_LAST) / 1000;
    TIMER_LAST = now;
    TIMER_VAL = Math.max(0, TIMER_VAL - elapsed);

    renderTimerDisplay();

    // 倒數 10 秒內每秒 beep
    var secs = Math.ceil(TIMER_VAL);
    if (secs <= 10 && secs > 0) {
      var whole = Math.floor(TIMER_VAL);
      var prev = Math.floor(TIMER_VAL + elapsed);
      if (whole !== prev) beepCountdown(secs);
    }

    if (TIMER_VAL <= 0) {
      TIMER_RUNNING = false;
      renderTimerDisplay();
      updateStartBtn();
      playTimerEnd();
      flashTimerDone();
      return;
    }
    TIMER_RAF = requestAnimationFrame(timerTick);
  }

  /* 更新顯示 */
  function renderTimerDisplay() {
    var digits = document.getElementById("timerDigits");
    var fill = document.getElementById("timerBarFill");
    if (!digits) return;

    var total = Math.ceil(TIMER_VAL);
    var m = Math.floor(total / 60);
    var s = total % 60;
    var str = pad2(m) + ":" + pad2(s);
    digits.textContent = str;

    // 倒數最後 10 秒變紅色
    var display = document.getElementById("timerDisplay");
    if (display) {
      if (TIMER_VAL <= 10 && TIMER_VAL > 0) {
        display.classList.add("tools-timer-urgent");
      } else if (TIMER_VAL <= 0) {
        display.classList.add("tools-timer-done");
        display.classList.remove("tools-timer-urgent");
        digits.textContent = "時間到！";
      } else {
        display.classList.remove("tools-timer-urgent", "tools-timer-done");
      }
    }

    // 進度條
    if (fill) {
      var pct = TIMER_TOTAL > 0 ? (TIMER_VAL / TIMER_TOTAL * 100) : 100;
      fill.style.width = pct + "%";
      fill.style.background = TIMER_VAL <= 10
        ? "linear-gradient(90deg,#f43f5e,#fb7185)"
        : "linear-gradient(90deg,#34d399,#10b981)";
    }
  }

  function updateStartBtn() {
    var btn = document.getElementById("btnTimerStart");
    if (!btn) return;
    btn.textContent = TIMER_RUNNING ? "⏸ 暫停" : "▶ 開始";
    btn.className = TIMER_RUNNING ? "tools-btn-timer-pause" : "tools-btn-timer-start";
  }

  /* 全螢幕 */
  window.timerFullscreen = function () {
    TIMER_FS = true;
    var overlay = document.createElement("div");
    overlay.id = "timerFsOverlay";
    overlay.className = "tools-timer-fs";
    overlay.innerHTML =
      '<div id="timerFsDisplay" class="tools-timer-fs-display">' +
        '<div id="timerFsDigits" class="tools-timer-fs-digits">00:00</div>' +
        '<div id="timerFsBar"><div id="timerFsBarFill" class="tools-timer-fs-bar-fill"></div></div>' +
        '<div class="tools-timer-fs-btns">' +
          '<button onclick="timerFsToggle()" id="btnFsStart" class="tools-btn-fs-start">▶ 開始</button>' +
          '<button onclick="timerFsReset()" class="tools-btn-fs-reset">↺</button>' +
          '<button onclick="closeFsTimer()" class="tools-btn-fs-close">✕ 關閉</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    renderFsTimerDisplay();
    // 同步更新：覆蓋 renderTimerDisplay 讓全螢幕也即時更新
    window._origRenderTimer = renderTimerDisplay;
    renderTimerDisplay = function () {
      window._origRenderTimer();
      renderFsTimerDisplay();
    };
  };

  function renderFsTimerDisplay() {
    var digits = document.getElementById("timerFsDigits");
    var fill = document.getElementById("timerFsBarFill");
    if (!digits) return;
    var total = Math.ceil(TIMER_VAL);
    var m = Math.floor(total / 60);
    var s = total % 60;
    digits.textContent = TIMER_VAL <= 0 ? "時間到！" : pad2(m) + ":" + pad2(s);
    var disp = document.getElementById("timerFsDisplay");
    if (disp) {
      if (TIMER_VAL <= 0) { disp.classList.add("tools-timer-done"); disp.classList.remove("tools-timer-urgent"); }
      else if (TIMER_VAL <= 10) { disp.classList.add("tools-timer-urgent"); disp.classList.remove("tools-timer-done"); }
      else { disp.classList.remove("tools-timer-urgent","tools-timer-done"); }
    }
    if (fill) {
      var pct = TIMER_TOTAL > 0 ? (TIMER_VAL / TIMER_TOTAL * 100) : 100;
      fill.style.width = pct + "%";
      fill.style.background = TIMER_VAL <= 10
        ? "linear-gradient(90deg,#f43f5e,#fb7185)"
        : "linear-gradient(90deg,#818cf8,#6366f1)";
    }
    var fsbtn = document.getElementById("btnFsStart");
    if (fsbtn) fsbtn.textContent = TIMER_RUNNING ? "⏸ 暫停" : "▶ 開始";
  }

  window.timerFsToggle = function () {
    if (TIMER_VAL <= 0 && !TIMER_RUNNING) timerReset();
    timerToggle();
    renderFsTimerDisplay();
  };
  window.timerFsReset = function () { timerReset(); renderFsTimerDisplay(); };
  window.closeFsTimer = function () {
    TIMER_FS = false;
    var overlay = document.getElementById("timerFsOverlay");
    if (overlay) overlay.remove();
    if (window._origRenderTimer) { renderTimerDisplay = window._origRenderTimer; delete window._origRenderTimer; }
  };

  /* 閃爍動畫（時間到） */
  function flashTimerDone() {
    var display = document.getElementById("timerDisplay") || document.getElementById("timerFsDisplay");
    if (!display) return;
    var count = 0;
    var iv = setInterval(function () {
      display.classList.toggle("tools-timer-flash");
      if (++count >= 6) { clearInterval(iv); display.classList.remove("tools-timer-flash"); }
    }, 200);
  }

  /* ── 音效（Web Audio API 合成） ── */
  function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  /* 倒數 beep（10 秒內每秒一聲，最後一聲高亢） */
  function beepCountdown(secsLeft) {
    try {
      var ctx = getAudioCtx();
      var t = ctx.currentTime;
      var isLast = secsLeft === 1;
      var freq = isLast ? 1046 : 660;   // 最後一聲 C6，其他 E5
      var dur  = isLast ? 0.5  : 0.18;
      var osc  = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = isLast ? "triangle" : "sine";
      osc.frequency.setValueAtTime(freq, t);
      if (isLast) osc.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.2);
      gain.gain.setValueAtTime(isLast ? 0.5 : 0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.start(t); osc.stop(t + dur + 0.02);
    } catch (e) {}
  }

  /* 時間到的音效（歡快三連音） */
  function playTimerEnd() {
    try {
      var ctx = getAudioCtx();
      var t = ctx.currentTime;
      var notes = [523, 659, 784, 1046]; // C5 E5 G5 C6
      notes.forEach(function (freq, i) {
        var osc  = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, t + i * 0.13);
        gain.gain.setValueAtTime(0.4, t + i * 0.13);
        gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.13 + 0.35);
        osc.start(t + i * 0.13); osc.stop(t + i * 0.13 + 0.4);
      });
    } catch (e) {}
  }

  /* ── 工具函式 ── */
  function pad2(n) { return n < 10 ? "0" + n : "" + n; }
  function escHtml(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function checkTeacher() {
    if (!APP_STATE.isTeacher) { toast("此功能僅限老師使用，請先登入老師帳號", "warn"); return false; }
    return true;
  }

  /* ══════════════════════════════════════════
     活動倒數便利貼
  ══════════════════════════════════════════ */

  /* 活動資料與位置存於班級資料庫：classroom/countdown 文件。
     結構：{ activities: [{ id, name, date:"YYYY-MM-DD", size, enabled, x, y }] }
       x,y = 便利貼左上角座標(px)，由老師拖曳後寫入，家長跨裝置同步可見。
       未設定 x,y 時 → 預設右下角自動堆疊。
     最小化狀態屬「個人檢視偏好」，存在各自瀏覽器 localStorage，不寫入資料庫。 */

  var CD_ACTS = [];          // 由 onSnapshot 同步的活動陣列
  var CD_SUBSCRIBED = false; // 避免重複訂閱

  function cdLoad() { return CD_ACTS.slice(); }

  /* 寫回資料庫（限老師會呼叫；其餘人不應觸發） */
  function cdSave(list) {
    CD_ACTS = list;
    try {
      if (typeof db !== "undefined" && db.collection) {
        db.collection("classroom").doc("countdown").set({ activities: list }, { merge: true });
      }
    } catch (e) { console.warn("倒數活動儲存失敗", e); }
  }

  /* 訂閱資料庫變動，任何裝置都即時更新便利貼 */
  function cdSubscribe() {
    if (CD_SUBSCRIBED) return;
    if (typeof db === "undefined" || !db.collection) return;
    CD_SUBSCRIBED = true;
    db.collection("classroom").doc("countdown").onSnapshot(function (doc) {
      var data = doc && doc.exists ? doc.data() : null;
      CD_ACTS = (data && Array.isArray(data.activities)) ? data.activities : [];
      renderCdNotes();
      if (document.getElementById("cdSettingsBody")) renderCdSettingsBody();
    }, function (err) { console.warn("倒數活動監聽失敗", err); });
  }

  function cdGenId() { return "cd" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /* ── 最小化狀態（個人本機偏好） ── */
  function cdMinKey() {
    var cls = "";
    try { if (window.LocalDB && LocalDB.getActiveClassId) cls = LocalDB.getActiveClassId() || ""; } catch (e) {}
    return "TOOLS_cd_min_" + (cls || "default");
  }
  function cdGetMinned() {
    try { return JSON.parse(localStorage.getItem(cdMinKey()) || "[]"); } catch (e) { return []; }
  }
  function cdSetMinned(arr) {
    try { localStorage.setItem(cdMinKey(), JSON.stringify(arr)); } catch (e) {}
  }
  function cdIsMin(id) { return cdGetMinned().indexOf(id) >= 0; }
  window.cdToggleMin = function (id) {
    var arr = cdGetMinned();
    var i = arr.indexOf(id);
    if (i >= 0) arr.splice(i, 1); else arr.push(id);
    cdSetMinned(arr);
    renderCdNotes();
  };

  /* 計算倒數天數：以「日」為單位，忽略時分秒。
     今天 6/29、活動 7/1 → 2；當天 → 0；已過 → 負值 */
  function cdDaysLeft(dateStr) {
    if (!dateStr) return null;
    var parts = dateStr.split("-");
    if (parts.length !== 3) return null;
    var target = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    target.setHours(0, 0, 0, 0);
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var diffMs = target.getTime() - today.getTime();
    return Math.round(diffMs / 86400000);
  }

  function cdSizeClass(sz) {
    return sz === "sm" ? "cd-sm" : sz === "lg" ? "cd-lg" : "cd-md";
  }

  /* 打開設定視窗（限老師） */
  window.openCountdown = function () {
    if (!checkTeacher()) return;
    showModal(buildCountdownHtml(), { size: "max-w-lg", noBackdropClose: false });
    renderCdSettingsBody();
  };

  function buildCountdownHtml() {
    return '<div class="flex flex-col" style="max-height:90vh">' +
      '<div class="px-6 py-4 border-b flex items-center justify-between shrink-0">' +
        '<h3 class="text-lg font-bold flex items-center gap-2">📌 活動日程倒數</h3>' +
        '<button onclick="closeModal()" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">×</button>' +
      '</div>' +
      '<div class="px-6 py-4 border-b shrink-0 space-y-3">' +
        '<div class="text-xs font-bold text-slate-500">新增活動</div>' +
        '<div class="flex flex-wrap items-end gap-2">' +
          '<div class="flex flex-col gap-1">' +
            '<label class="text-[11px] text-slate-400">活動名稱</label>' +
            '<input id="cdNewName" type="text" maxlength="20" placeholder="例如：期末考" class="border rounded-xl px-3 py-1.5 text-sm w-40">' +
          '</div>' +
          '<div class="flex flex-col gap-1">' +
            '<label class="text-[11px] text-slate-400">活動日期</label>' +
            '<input id="cdNewDate" type="date" class="border rounded-xl px-3 py-1.5 text-sm">' +
          '</div>' +
          '<button onclick="cdAddActivity()" class="btn3d b-violet text-xs">＋ 新增</button>' +
        '</div>' +
      '</div>' +
      '<div id="cdSettingsBody" class="flex-1 overflow-y-auto px-6 py-4"></div>' +
    '</div>';
  }

  window.cdAddActivity = function () {
    var name = (document.getElementById("cdNewName").value || "").trim();
    var date = document.getElementById("cdNewDate").value;
    if (!name) { toast("請輸入活動名稱", "warn"); return; }
    if (!date) { toast("請選擇活動日期", "warn"); return; }
    var list = cdLoad();
    list.push({ id: cdGenId(), name: name, date: date, size: "md", enabled: true });
    cdSave(list);
    document.getElementById("cdNewName").value = "";
    document.getElementById("cdNewDate").value = "";
    renderCdSettingsBody();
    renderCdNotes();
    toast("已新增活動", "success");
  };

  function renderCdSettingsBody() {
    var body = document.getElementById("cdSettingsBody");
    if (!body) return;
    var list = cdLoad();
    if (!list.length) {
      body.innerHTML = '<div class="text-center text-slate-400 text-sm py-8">尚未設定任何活動<br>請於上方新增。</div>';
      return;
    }
    // 依日期排序
    list.sort(function (a, b) { return (a.date || "").localeCompare(b.date || ""); });
    var colors = ["#f59e0b", "#ec4899", "#22c55e", "#3b82f6", "#8b5cf6"];
    body.innerHTML = list.map(function (a, i) {
      var d = cdDaysLeft(a.date);
      var dTxt = d === null ? "—" : d > 0 ? "倒數 " + d + " 天" : d === 0 ? "就是今天！" : "已過 " + (-d) + " 天";
      return '<div class="cd-act-row">' +
        '<span class="cd-act-dot" style="background:' + colors[i % colors.length] + '"></span>' +
        '<div class="flex-1 min-w-0">' +
          '<div class="font-bold text-sm truncate">' + escHtml(a.name) + '</div>' +
          '<div class="text-[11px] text-slate-400">' + escHtml(a.date) + ' · ' + dTxt + '</div>' +
        '</div>' +
        '<div class="cd-size-seg" title="便利貼大小">' +
          ['sm', 'md', 'lg'].map(function (s) {
            return '<button class="' + (a.size === s ? 'on' : '') + '" onclick="cdSetSize(\'' + a.id + '\',\'' + s + '\')">' +
              (s === 'sm' ? '小' : s === 'md' ? '中' : '大') + '</button>';
          }).join('') +
        '</div>' +
        '<button onclick="cdToggle(\'' + a.id + '\')" class="text-xs px-2 py-1 rounded-lg ' +
          (a.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400') + '" title="顯示/隱藏便利貼">' +
          (a.enabled ? '✓ 顯示' : '隱藏') + '</button>' +
        '<button onclick="cdDelete(\'' + a.id + '\')" class="text-rose-400 hover:text-rose-600 text-lg leading-none px-1" title="刪除">×</button>' +
      '</div>';
    }).join('');
  }

  window.cdSetSize = function (id, sz) {
    var list = cdLoad();
    var a = list.find(function (x) { return x.id === id; });
    if (a) { a.size = sz; cdSave(list); renderCdSettingsBody(); renderCdNotes(); }
  };
  window.cdToggle = function (id) {
    var list = cdLoad();
    var a = list.find(function (x) { return x.id === id; });
    if (a) { a.enabled = !a.enabled; cdSave(list); renderCdSettingsBody(); renderCdNotes(); }
  };
  window.cdDelete = function (id) {
    var list = cdLoad().filter(function (x) { return x.id !== id; });
    cdSave(list);
    renderCdSettingsBody();
    renderCdNotes();
    toast("已刪除活動", "success");
  };

  /* 渲染浮動便利貼層 */
  function renderCdNotes() {
    var layer = document.getElementById("cdNotesLayer");
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "cdNotesLayer";
      document.body.appendChild(layer);
    }
    // 最小化膠囊列（固定底部，不擋模組）
    var bar = document.getElementById("cdMinBar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "cdMinBar";
      document.body.appendChild(bar);
    }

    var isTeacher = !!APP_STATE.isTeacher;
    var list = cdLoad().filter(function (a) { return a.enabled; });
    // 依日期排序，近的在上
    list.sort(function (a, b) { return (a.date || "").localeCompare(b.date || ""); });

    if (!list.length) { layer.innerHTML = ""; bar.innerHTML = ""; return; }

    var minHtml = "", noteHtml = "", autoIdx = 0;

    list.forEach(function (a, i) {
      var d = cdDaysLeft(a.date);
      var minned = cdIsMin(a.id);

      if (minned) {
        // 最小化 → 小膠囊
        var capNum = d === null ? "—" : d > 0 ? d : d === 0 ? "0" : "+" + (-d);
        var capCls = d === 0 ? "cd-cap-zero" : d < 0 ? "cd-cap-past" : "";
        minHtml += '<button class="cd-cap cd-c' + ((i % 5) + 1) + ' ' + capCls + '" ' +
          'title="' + escHtml(a.name) + '（點擊展開）" onclick="cdToggleMin(\'' + a.id + '\')">' +
          '<span class="cd-cap-name">' + escHtml(a.name) + '</span>' +
          '<span class="cd-cap-num">' + capNum + '</span>' +
        '</button>';
        return;
      }

      var numTxt, unitTxt, stateCls = "";
      if (d === null) { numTxt = "—"; unitTxt = ""; }
      else if (d > 0) { numTxt = d; unitTxt = "日"; }
      else if (d === 0) { numTxt = 0; unitTxt = "日"; stateCls = "cd-note-zero"; }
      else { numTxt = "+" + (-d); unitTxt = "日"; stateCls = "cd-note-past"; }
      var prefix = d === null ? "" : d > 0 ? "倒數" : d === 0 ? "就是今天" : "已過";

      // 位置：有存座標→絕對定位；否則自動堆疊在右側
      var posStyle, posCls;
      if (typeof a.x === "number" && typeof a.y === "number") {
        // 夾在可視範圍內，避免拖到畫面外看不到
        var maxX = Math.max(0, window.innerWidth - 60);
        var maxY = Math.max(0, window.innerHeight - 60);
        var px = Math.min(Math.max(0, a.x), maxX);
        var py = Math.min(Math.max(0, a.y), maxY);
        posStyle = 'left:' + px + 'px;top:' + py + 'px;';
        posCls = "cd-note-fixed";
      } else {
        posStyle = 'right:18px;bottom:' + (18 + autoIdx * 12) + 'px;';
        posCls = "cd-note-auto";
        autoIdx++;
      }

      noteHtml += '<div class="cd-note ' + cdSizeClass(a.size) + ' cd-c' + ((i % 5) + 1) + ' ' +
          stateCls + ' ' + posCls + (isTeacher ? ' cd-draggable' : '') + '" ' +
          'data-cdid="' + a.id + '" style="' + posStyle + '">' +
        '<div class="cd-note-tools">' +
          '<button class="cd-note-btn" title="放大全螢幕" onclick="cdFullscreen(\'' + a.id + '\')">⛶</button>' +
          '<button class="cd-note-btn" title="最小化" onclick="cdToggleMin(\'' + a.id + '\')">－</button>' +
        '</div>' +
        '<div class="cd-note-name">' + escHtml(a.name) + '</div>' +
        '<div class="cd-note-count">' +
          (prefix && d !== 0 && d > 0 ? '<span class="cd-note-unit">' + prefix + '</span>' : '') +
          '<span class="cd-note-num">' + numTxt + '</span>' +
          '<span class="cd-note-unit">' + unitTxt + '</span>' +
        '</div>' +
        (d === 0 ? '<div class="cd-note-unit" style="font-weight:800">🎉 ' + prefix + '</div>' : '') +
        '<div class="cd-note-date">📅 ' + escHtml(a.date) + '</div>' +
        (isTeacher ? '<div class="cd-note-drag" title="拖曳移動">⠿</div>' : '') +
      '</div>';
    });

    layer.innerHTML = noteHtml;
    bar.innerHTML = minHtml;

    // 老師：綁定拖曳
    if (isTeacher) cdBindDrag(layer);
  }
  window.renderCdNotes = renderCdNotes;

  /* ── 拖曳（僅老師）：滑鼠 + 觸控，放開時把座標寫入資料庫 ── */
  function cdBindDrag(layer) {
    var notes = layer.querySelectorAll(".cd-note.cd-draggable");
    for (var i = 0; i < notes.length; i++) bindOne(notes[i]);

    function bindOne(note) {
      var handle = note.querySelector(".cd-note-drag") || note;
      handle.addEventListener("mousedown", function (e) { start(e, e.clientX, e.clientY); });
      handle.addEventListener("touchstart", function (e) {
        if (!e.touches[0]) return;
        start(e, e.touches[0].clientX, e.touches[0].clientY);
      }, { passive: false });

      function start(e, cx, cy) {
        // 不要在按到工具鈕時觸發拖曳
        if (e.target.closest && e.target.closest(".cd-note-btn")) return;
        e.preventDefault();
        var rect = note.getBoundingClientRect();
        var offX = cx - rect.left, offY = cy - rect.top;
        note.classList.add("cd-dragging");
        // 拖曳時改為絕對座標模式
        note.style.left = rect.left + "px";
        note.style.top = rect.top + "px";
        note.style.right = "auto";
        note.style.bottom = "auto";

        function move(mx, my) {
          var nx = Math.min(Math.max(0, mx - offX), window.innerWidth - 40);
          var ny = Math.min(Math.max(0, my - offY), window.innerHeight - 40);
          note.style.left = nx + "px";
          note.style.top = ny + "px";
        }
        function onMouseMove(ev) { move(ev.clientX, ev.clientY); }
        function onTouchMove(ev) { if (ev.touches[0]) { ev.preventDefault(); move(ev.touches[0].clientX, ev.touches[0].clientY); } }
        function end() {
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", end);
          document.removeEventListener("touchmove", onTouchMove);
          document.removeEventListener("touchend", end);
          note.classList.remove("cd-dragging");
          var fx = parseInt(note.style.left, 10) || 0;
          var fy = parseInt(note.style.top, 10) || 0;
          cdPersistPos(note.getAttribute("data-cdid"), fx, fy);
        }
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", end);
        document.addEventListener("touchmove", onTouchMove, { passive: false });
        document.addEventListener("touchend", end);
      }
    }
  }

  function cdPersistPos(id, x, y) {
    var list = cdLoad();
    var a = list.find(function (x2) { return x2.id === id; });
    if (!a) return;
    a.x = x; a.y = y;
    cdSave(list);   // 寫入資料庫 → 家長端 onSnapshot 會同步看到新位置
  }

  /* 全螢幕顯示單一活動倒數 */
  window.cdFullscreen = function (id) {
    var a = cdLoad().find(function (x) { return x.id === id; });
    if (!a) return;
    var d = cdDaysLeft(a.date);
    var numTxt, unitTxt, cls = "", caption;
    if (d === null) { numTxt = "—"; unitTxt = ""; caption = ""; }
    else if (d > 0) { numTxt = d; unitTxt = "天"; caption = "倒數"; }
    else if (d === 0) { numTxt = 0; unitTxt = "天"; cls = "cd-zero"; caption = "🎉 就是今天！"; }
    else { numTxt = -d; unitTxt = "天"; cls = "cd-past"; caption = "已經過了"; }

    var overlay = document.createElement("div");
    overlay.id = "cdFsOverlay";
    overlay.className = "cd-fs";
    overlay.innerHTML =
      '<button class="cd-fs-close" onclick="cdCloseFs()" title="關閉">✕</button>' +
      '<div class="cd-fs-inner">' +
        '<div class="cd-fs-name">' + escHtml(a.name) + '</div>' +
        (caption ? '<div class="cd-fs-unit">' + caption + '</div>' : '') +
        '<div class="cd-fs-num ' + cls + '">' + numTxt + '</div>' +
        '<div class="cd-fs-unit">' + unitTxt + '</div>' +
        '<div class="cd-fs-date">📅 活動日期：' + escHtml(a.date) + '</div>' +
      '</div>';
    overlay.addEventListener("click", function (e) { if (e.target === overlay) cdCloseFs(); });
    document.body.appendChild(overlay);
  };
  window.cdCloseFs = function () {
    var o = document.getElementById("cdFsOverlay");
    if (o) o.remove();
  };

  /* 跨日自動更新：每分鐘檢查日期是否改變，變了就重繪 */
  var cdLastDay = new Date().toDateString();
  function cdStartAutoRefresh() {
    setInterval(function () {
      var now = new Date().toDateString();
      if (now !== cdLastDay) {
        cdLastDay = now;
        renderCdNotes();
      }
    }, 60000);
  }

  /* ── 曝光 ── */
  window.setupTools   = setupTools;
  window.renderTools  = renderTools;

  /* 進場後渲染便利貼（無論老師或登入皆顯示已啟用的活動） */
  (function cdBoot() {
    function go() {
      try {
        renderCdNotes();
        cdStartAutoRefresh();
        // 視窗大小改變時重繪，讓便利貼保持在可視範圍內
        var rt;
        window.addEventListener("resize", function () {
          clearTimeout(rt);
          rt = setTimeout(function () { try { renderCdNotes(); } catch (e) {} }, 200);
        });
      } catch (e) {}
    }
    if (document.readyState === "loading")
      document.addEventListener("DOMContentLoaded", function () { setTimeout(go, 300); });
    else setTimeout(go, 300);
  })();

})();
