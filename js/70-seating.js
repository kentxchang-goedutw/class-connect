/* ════════════════════════════════════════════════════════════════════
   70-seating.js  座位表模組
   ────────────────────────────────────────────────────────────────────
   功能：
     • 教師端兩種模式：
       ① 按列排座位 — 黑板在上，固定格子陣列，拖曳互換學生位置
       ② 自由排列   — 黑板在上，可自由拖曳學生姓名卡到教室任意位置
     • 下載座位表 PDF（使用 html2canvas + jsPDF，動態載入）
     • 家長端：唯讀顯示目前座位表
   資料：
     classroom/seating  ← 座位表設定與資料
       { mode: "rows"|"free", rows: 6, cols: 8,
         rowLayout: [ [studentId,...], ... ],   // rows×cols 二維陣列（按列模式）
         freeLayout: [ {id, x, y}, ... ]        // 自由模式卡片位置（百分比）
       }
   ════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  /* ── 1. 註冊進主系統 ── */
  function registerModule() {
    if (typeof DEFAULT_PERMS === "object" && DEFAULT_PERMS && !DEFAULT_PERMS.seating) DEFAULT_PERMS.seating = "public";
    if (typeof MODULE_NAMES === "object" && MODULE_NAMES) MODULE_NAMES.seating = "班級座位表";
    if (typeof ORDER_LABELS === "object" && ORDER_LABELS) ORDER_LABELS.seating = "班級座位表";
    if (typeof DEFAULT_ORDER !== "undefined" && Array.isArray(DEFAULT_ORDER) && DEFAULT_ORDER.indexOf("seating") < 0) DEFAULT_ORDER.push("seating");
  }

  /* ── 2. 狀態 ── */
  var SEATING = null;       // Firestore 資料
  var seatUnsub = null;
  var dragSrc = null;       // 按列模式：拖曳來源索引 [row, col]
  var freeDragId = null;    // 自由模式：拖曳中的學生 id
  var freeDragOffX = 0, freeDragOffY = 0;
  var FREE_SCALE = 1.0;     // 自由模式圖卡縮放比例（暫存，不存 DB）
  var _teacherView = false; // 教師視角：左右鏡像呈現（只影響顯示，不改資料）

  /* 預設設定 */
  var DEFAULT_SEATING = { mode: "rows", rows: 6, cols: 8, rowLayout: [], freeLayout: [], freeScale: 1.0 };

  /* ── 3. 啟動 ── */
  function setupSeating() {
    registerModule();
    if (typeof db === "undefined" || !db) return;
    seatUnsub = db.collection("classroom").doc("seating").onSnapshot(function(doc) {
      SEATING = doc.exists ? doc.data() : { ...DEFAULT_SEATING };
      // rowLayout 在 Firestore 以 JSON 字串儲存（避免 nested array 限制），讀取時還原
      if (typeof SEATING.rowLayout === "string") {
        try { SEATING.rowLayout = JSON.parse(SEATING.rowLayout); } catch(e) { SEATING.rowLayout = []; }
      }
      renderSeating();
    }, function(err) { console.warn("座位表監聽失敗", err); });
  }

  /* ── 4. 主畫面渲染 ── */
  function renderSeating() {
    var section = document.querySelector('[data-module="seating"]');
    if (!section) return;
    var locked = document.getElementById("seatLocked");
    var content = document.getElementById("seatContent");
    var cfg = APP_STATE.config || {};
    var perms = cfg.perms || {};
    var perm = perms.seating || DEFAULT_PERMS.seating || "public";

    if (perm === "off") { section.style.display = "none"; return; }
    section.style.display = "";

    if (perm === "login" && !APP_STATE.session && !APP_STATE.isTeacher) {
      if (locked) locked.classList.remove("hidden");
      if (content) content.classList.add("hidden");
      return;
    }
    if (locked) locked.classList.add("hidden");
    if (content) content.classList.remove("hidden");

    var s = SEATING || DEFAULT_SEATING;
    // 教師視角切換鈕：僅「按列模式」有意義（自由模式為座標排列）
    var viewBtn = document.getElementById("seatViewToggle");
    if (viewBtn) viewBtn.classList.toggle("hidden", s.mode !== "rows");
    if (s.mode === "rows") renderRowsView(s, false);
    else renderFreeView(s, false);
  }

  /* ── 5A. 按列模式：唯讀（主畫面） ── */
  function renderRowsView(s, isEdit) {
    var container = document.getElementById("seatContent");
    var rows = s.rows || 6, cols = s.cols || 8;
    var layout = ensureRowLayout(s.rowLayout || [], rows, cols);
    var students = (typeof APP_STATE !== "undefined" ? APP_STATE.students : []) || [];
    var stuMap = {};
    students.forEach(function(st) { stuMap[st.id] = st; });

    // 教師視角：左右鏡像（只在唯讀主畫面；編輯模式維持原始座標以利拖曳）
    var mirror = (!isEdit && _teacherView);

    var html = '<div class="seat-classroom' + (mirror ? ' seat-teacher-view' : '') + '">';
    // 黑板：教師視角時站在黑板前看向全班
    html += '<div class="seat-board">' + (mirror ? '🧑‍🏫 講台（教師視角）' : '📋 黑板（前方）') + '</div>';
    // 座位格
    html += '<div class="seat-grid" style="grid-template-columns:repeat(' + cols + ',1fr);">';
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var srcCol = mirror ? (cols - 1 - c) : c;   // 教師視角：欄反向
        var sid = (layout[r] || [])[srcCol] || "";
        var st = stuMap[sid];
        var name = st ? st.name : "";
        var seat = st ? st.seat : "";
        if (isEdit) {
          html += '<div class="seat-cell' + (name ? " seat-filled" : " seat-empty") + '" draggable="true" data-row="' + r + '" data-col="' + c + '">';
          if (name) {
            html += '<span class="seat-num">' + seat + '</span><span class="seat-name">' + escapeHtml(name) + '</span>';
          }
          html += '</div>';
        } else {
          html += '<div class="seat-cell' + (name ? " seat-filled" : " seat-empty") + '">';
          if (name) {
            html += '<span class="seat-num">' + seat + '</span><span class="seat-name">' + escapeHtml(name) + '</span>';
          }
          html += '</div>';
        }
      }
    }
    html += '</div></div>';
    container.innerHTML = html;

    if (isEdit) bindRowDrag(layout, rows, cols, students);
  }

  function ensureRowLayout(layout, rows, cols) {
    var result = [];
    for (var r = 0; r < rows; r++) {
      var row = (layout[r] || []).slice(0, cols);
      while (row.length < cols) row.push("");
      result.push(row);
    }
    return result;
  }

  function bindRowDrag(layout, rows, cols, students) {
    var cells = document.querySelectorAll("#seatContent .seat-cell");
    cells.forEach(function(cell) {
      cell.addEventListener("dragstart", function(e) {
        dragSrc = [+cell.dataset.row, +cell.dataset.col];
        cell.classList.add("seat-dragging");
        e.dataTransfer.effectAllowed = "move";
      });
      cell.addEventListener("dragend", function() {
        cell.classList.remove("seat-dragging");
        document.querySelectorAll(".seat-over").forEach(function(el) { el.classList.remove("seat-over"); });
      });
      cell.addEventListener("dragover", function(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        cell.classList.add("seat-over");
      });
      cell.addEventListener("dragleave", function() { cell.classList.remove("seat-over"); });
      cell.addEventListener("drop", function(e) {
        e.preventDefault();
        cell.classList.remove("seat-over");
        if (!dragSrc) return;
        var destRow = +cell.dataset.row, destCol = +cell.dataset.col;
        if (dragSrc[0] === destRow && dragSrc[1] === destCol) { dragSrc = null; return; }
        // 邊界檢查，避免拖放到範圍外造成多餘列/欄
        if (dragSrc[0] < 0 || dragSrc[0] >= rows || dragSrc[1] < 0 || dragSrc[1] >= cols ||
            destRow < 0 || destRow >= rows || destCol < 0 || destCol >= cols) { dragSrc = null; return; }
        // 以固定 rows×cols 正規化後互換
        var fixed = ensureRowLayout(layout, rows, cols);
        var srcVal = (fixed[dragSrc[0]] || [])[dragSrc[1]] || "";
        var dstVal = (fixed[destRow] || [])[destCol] || "";
        fixed[dragSrc[0]][dragSrc[1]] = dstVal;
        fixed[destRow][destCol] = srcVal;
        dragSrc = null;
        saveRowLayout(fixed);
      });
    });
  }

  function saveRowLayout(layout) {
    if (typeof db === "undefined" || !db) return;
    // rowLayout 是二維陣列，Firebase 不支援 nested array，序列化成 JSON 字串儲存
    db.collection("classroom").doc("seating").set({ rowLayout: JSON.stringify(layout) }, { merge: true })
      .catch(function(err) { console.warn("儲存座位失敗", err); });
  }

  /* ── 5B. 自由模式（主畫面唯讀） ── */
  function renderFreeView(s, isEdit) {
    var container = document.getElementById("seatContent");
    var freeLayout = s.freeLayout || [];
    var scale = parseFloat(s.freeScale) || 1.0;
    var scaleStyle = 'transform:scale(' + scale + ');transform-origin:top left;';
    var students = (typeof APP_STATE !== "undefined" ? APP_STATE.students : []) || [];
    var stuMap = {};
    students.forEach(function(st) { stuMap[st.id] = st; });

    var html = '<div class="seat-classroom seat-classroom-free">';
    html += '<div class="seat-board">📋 黑板（前方）</div>';
    html += '<div class="seat-free-area" id="seatFreeArea">';

    freeLayout.forEach(function(item) {
      var st = stuMap[item.id];
      if (!st) return;
      html += '<div class="seat-free-card" data-id="' + item.id + '" style="left:' + item.x + '%;top:' + item.y + '%;' + scaleStyle + '">';
      html += '<span class="seat-num">' + (st.seat || "") + '</span><span class="seat-name">' + escapeHtml(st.name || "") + '</span>';
      html += '</div>';
    });

    var placed = freeLayout.map(function(i) { return i.id; });
    students.filter(function(st) { return placed.indexOf(st.id) < 0; }).forEach(function(st, idx) {
      var x = 1 + (idx % 5) * 12, y = 5;
      html += '<div class="seat-free-card seat-free-unplaced" data-id="' + st.id + '" style="left:' + x + '%;top:' + y + '%;' + scaleStyle + '">';
      html += '<span class="seat-num">' + (st.seat || "") + '</span><span class="seat-name">' + escapeHtml(st.name || "") + '</span>';
      html += '</div>';
    });

    html += '</div></div>';
    container.innerHTML = html;
  }

  function bindFreeDrag(s) {
    var area = document.getElementById("seatFreeArea");
    if (!area) return;
    var cards = area.querySelectorAll(".seat-free-draggable");

    cards.forEach(function(card) {
      card.addEventListener("mousedown", function(e) {
        if (e.button !== 0) return;
        freeDragId = card.dataset.id;
        var rect = card.getBoundingClientRect();
        freeDragOffX = e.clientX - rect.left;
        freeDragOffY = e.clientY - rect.top;
        card.classList.add("seat-free-dragging");
        e.preventDefault();
      });
    });

    document.addEventListener("mousemove", onFreeMouseMove);
    document.addEventListener("mouseup", onFreeMouseUp);

    // Touch 支援
    cards.forEach(function(card) {
      card.addEventListener("touchstart", function(e) {
        var t = e.touches[0];
        freeDragId = card.dataset.id;
        var rect = card.getBoundingClientRect();
        freeDragOffX = t.clientX - rect.left;
        freeDragOffY = t.clientY - rect.top;
        card.classList.add("seat-free-dragging");
        e.preventDefault();
      }, { passive: false });
    });
    document.addEventListener("touchmove", onFreeTouchMove, { passive: false });
    document.addEventListener("touchend", onFreeTouchEnd);
  }

  function onFreeMouseMove(e) {
    if (!freeDragId) return;
    moveFreeDrag(e.clientX, e.clientY);
  }
  function onFreeMouseUp() {
    if (!freeDragId) return;
    endFreeDrag();
  }
  function onFreeTouchMove(e) {
    if (!freeDragId) return;
    e.preventDefault();
    var t = e.touches[0];
    moveFreeDrag(t.clientX, t.clientY);
  }
  function onFreeTouchEnd() {
    if (!freeDragId) return;
    endFreeDrag();
  }

  function moveFreeDrag(clientX, clientY) {
    var area = document.getElementById("seatFreeArea");
    if (!area) return;
    var card = area.querySelector('[data-id="' + freeDragId + '"]');
    if (!card) return;
    var areaRect = area.getBoundingClientRect();
    var cardW = card.offsetWidth, cardH = card.offsetHeight;
    var x = clientX - areaRect.left - freeDragOffX;
    var y = clientY - areaRect.top - freeDragOffY;
    // 邊界限制
    x = Math.max(0, Math.min(areaRect.width - cardW, x));
    y = Math.max(0, Math.min(areaRect.height - cardH, y));
    var xPct = (x / areaRect.width * 100).toFixed(1);
    var yPct = (y / areaRect.height * 100).toFixed(1);
    card.style.left = xPct + "%";
    card.style.top = yPct + "%";
  }

  function endFreeDrag() {
    var area = document.getElementById("seatFreeArea");
    if (area && freeDragId) {
      var card = area.querySelector('[data-id="' + freeDragId + '"]');
      if (card) {
        card.classList.remove("seat-free-dragging");
        var x = parseFloat(card.style.left);
        var y = parseFloat(card.style.top);
        saveFreeCard(freeDragId, x, y);
      }
    }
    freeDragId = null;
  }

  function saveFreeCard(id, x, y) {
    if (typeof db === "undefined" || !db) return;
    // 讀取現有 freeLayout，更新或新增
    db.collection("classroom").doc("seating").get().then(function(doc) {
      var data = doc.exists ? doc.data() : { ...DEFAULT_SEATING };
      var fl = data.freeLayout || [];
      var idx = fl.findIndex(function(i) { return i.id === id; });
      if (idx >= 0) { fl[idx].x = x; fl[idx].y = y; }
      else fl.push({ id: id, x: x, y: y });
      return db.collection("classroom").doc("seating").set({ freeLayout: fl }, { merge: true });
    }).catch(function(err) { console.warn("儲存自由座位失敗", err); });
  }

  /* ── 6. 教師：打開編輯座位表視窗 ── */
  function openSeatingEditor() {
    if (!APP_STATE.isTeacher) { if (typeof toast === "function") toast("請先以老師身分登入", "warn"); return; }
    var s = SEATING || { ...DEFAULT_SEATING };
    var isRows = s.mode !== "free";

    if (typeof showModal !== "function") return;
    showModal(buildEditorHtml(s), { size: "max-w-4xl", noBackdropClose: true });

    // 初始化縮放比例
    FREE_SCALE = parseFloat(s.freeScale) || 1.0;
    updateScaleLabel();

    // 綁定模式切換
    document.getElementById("seatModeRows").addEventListener("change", function() { if (this.checked) switchEditorMode("rows"); });
    document.getElementById("seatModeFree").addEventListener("change", function() { if (this.checked) switchEditorMode("free"); });
    document.getElementById("seatModeRows").checked = isRows;
    document.getElementById("seatModeFree").checked = !isRows;

    // 自由模式時顯示縮放控制
    var scaleWrap = document.getElementById("seatScaleWrap");
    if (scaleWrap) {
      if (!isRows) { scaleWrap.classList.remove("hidden"); scaleWrap.style.display = "flex"; }
      else { scaleWrap.classList.add("hidden"); }
    }

    // 綁定列/欄數變更
    ["seatRows","seatCols"].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("change", function() { refreshEditorPreview(); });
    });

    refreshEditorPreview();
  }

  function buildEditorHtml(s) {
    return '<div class="flex flex-col max-h-[90vh]">' +
      '<div class="px-6 py-4 border-b flex items-center justify-between shrink-0">' +
        '<h3 class="text-lg font-bold">🪑 編輯座位表</h3>' +
        '<button onclick="closeModal()" class="text-slate-400 hover:text-slate-600 text-xl">×</button>' +
      '</div>' +
      '<div class="px-6 py-3 border-b shrink-0 flex flex-wrap items-center gap-4">' +
        '<label class="flex items-center gap-2 font-medium text-sm cursor-pointer">' +
          '<input type="radio" name="seatMode" id="seatModeRows" value="rows" class="accent-indigo-600"> 按列排座位' +
        '</label>' +
        '<label class="flex items-center gap-2 font-medium text-sm cursor-pointer">' +
          '<input type="radio" name="seatMode" id="seatModeFree" value="free" class="accent-indigo-600"> 自由排列' +
        '</label>' +
        '<span id="seatRowsColsWrap" class="flex items-center gap-2">' +
          '<label class="text-sm text-slate-600">列數 <input type="number" id="seatRows" value="' + (s.rows||6) + '" min="1" max="12" class="w-14 border rounded-lg px-2 py-1 text-sm ml-1"></label>' +
          '<label class="text-sm text-slate-600">欄數 <input type="number" id="seatCols" value="' + (s.cols||8) + '" min="1" max="12" class="w-14 border rounded-lg px-2 py-1 text-sm ml-1"></label>' +
        '</span>' +
        '<button onclick="seatAutoFill()" class="btn3d b-blue text-xs">🔀 自動排入學生</button>' +
        '<span id="seatScaleWrap" class="hidden items-center gap-1">' +
          '<span class="text-xs text-slate-500 whitespace-nowrap">圖卡大小</span>' +
          '<button onclick="seatScaleChange(-0.1)" class="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold text-slate-700 text-sm flex items-center justify-center">－</button>' +
          '<span id="seatScaleLabel" class="text-xs font-bold text-slate-600 w-9 text-center">100%</span>' +
          '<button onclick="seatScaleChange(0.1)" class="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold text-slate-700 text-sm flex items-center justify-center">＋</button>' +
          '<button onclick="seatScaleReset()" class="text-xs text-slate-400 hover:text-slate-600 underline ml-1">重設</button>' +
        '</span>' +
        '<button onclick="downloadSeatPdf()" class="btn3d b-emerald text-xs">⬇️ 下載 PDF</button>' +
        '<button onclick="saveSeating()" class="btn3d b-indigo text-xs">💾 儲存</button>' +
      '</div>' +
      '<div id="seatEditorBody" class="overflow-auto flex-1 px-4 py-4"></div>' +
    '</div>';
  }

  function switchEditorMode(mode) {
    var wrap = document.getElementById("seatRowsColsWrap");
    if (wrap) wrap.style.display = mode === "rows" ? "" : "none";
    var scaleWrap = document.getElementById("seatScaleWrap");
    if (scaleWrap) scaleWrap.classList.toggle("hidden", mode !== "free");
    if (scaleWrap && mode === "free") scaleWrap.style.display = "flex";
    refreshEditorPreview();
  }

  function refreshEditorPreview() {
    var body = document.getElementById("seatEditorBody");
    if (!body) return;
    var s = getEditorState();
    // 暫存在 SEATING 同步資料（不存 DB，等按儲存才存）
    var tempS = Object.assign({}, SEATING || DEFAULT_SEATING, s);
    if (s.mode === "rows") renderRowsViewInto(body, tempS, true);
    else renderFreeViewInto(body, tempS, true);
  }

  function getEditorState() {
    var modeEl = document.querySelector('input[name="seatMode"]:checked');
    var mode = modeEl ? modeEl.value : "rows";
    var rows = +(document.getElementById("seatRows") || {}).value || 6;
    var cols = +(document.getElementById("seatCols") || {}).value || 8;
    return { mode: mode, rows: rows, cols: cols };
  }

  /* 渲染到指定容器（供編輯器用） */
  function renderRowsViewInto(container, s, isEdit) {
    var rows = s.rows || 6, cols = s.cols || 8;
    var layout = ensureRowLayout(s.rowLayout || [], rows, cols);
    var students = APP_STATE.students || [];
    var stuMap = {};
    students.forEach(function(st) { stuMap[st.id] = st; });

    var html = '<div class="seat-classroom">';
    html += '<div class="seat-board">📋 黑板（前方）</div>';
    html += '<div class="seat-grid" style="grid-template-columns:repeat(' + cols + ',1fr);">';
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var sid = (layout[r] || [])[c] || "";
        var st = stuMap[sid];
        html += '<div class="seat-cell' + (st ? " seat-filled" : " seat-empty") + '"' +
          (isEdit ? ' draggable="true" data-row="' + r + '" data-col="' + c + '"' : "") + '>';
        if (st) html += '<span class="seat-num">' + (st.seat||"") + '</span><span class="seat-name">' + escapeHtml(st.name||"") + '</span>';
        html += '</div>';
      }
    }
    html += '</div></div>';
    container.innerHTML = html;

    if (isEdit) {
      // 更新暫存 layout
      if (!SEATING) SEATING = Object.assign({}, DEFAULT_SEATING);
      SEATING._editLayout = layout;
      bindRowDragInto(container, layout, rows, cols);
    }
  }

  function bindRowDragInto(container, layout, rows, cols) {
    var cells = container.querySelectorAll(".seat-cell");
    cells.forEach(function(cell) {
      cell.addEventListener("dragstart", function(e) {
        dragSrc = [+cell.dataset.row, +cell.dataset.col];
        cell.classList.add("seat-dragging");
        e.dataTransfer.effectAllowed = "move";
      });
      cell.addEventListener("dragend", function() {
        cell.classList.remove("seat-dragging");
        container.querySelectorAll(".seat-over").forEach(function(el) { el.classList.remove("seat-over"); });
      });
      cell.addEventListener("dragover", function(e) {
        e.preventDefault();
        cell.classList.add("seat-over");
      });
      cell.addEventListener("dragleave", function() { cell.classList.remove("seat-over"); });
      cell.addEventListener("drop", function(e) {
        e.preventDefault();
        cell.classList.remove("seat-over");
        if (!dragSrc) return;
        var dr = +cell.dataset.row, dc = +cell.dataset.col;
        if (dragSrc[0] === dr && dragSrc[1] === dc) { dragSrc = null; return; }
        // 邊界檢查：拖放索引必須落在目前行列數範圍內，避免產生超出格子的列/欄
        if (dragSrc[0] < 0 || dragSrc[0] >= rows || dragSrc[1] < 0 || dragSrc[1] >= cols ||
            dr < 0 || dr >= rows || dc < 0 || dc >= cols) { dragSrc = null; return; }
        // 以固定 rows×cols 正規化版面後再互換，確保不會殘留多餘列/欄
        var fixed = ensureRowLayout(layout, rows, cols);
        var srcVal = (fixed[dragSrc[0]] || [])[dragSrc[1]] || "";
        var dstVal = (fixed[dr] || [])[dc] || "";
        fixed[dragSrc[0]][dragSrc[1]] = dstVal;
        fixed[dr][dc] = srcVal;
        dragSrc = null;
        if (SEATING) SEATING._editLayout = fixed;
        // 重繪：固定使用相同 rows/cols
        renderRowsViewInto(container, Object.assign({}, SEATING || DEFAULT_SEATING, { rows: rows, cols: cols, rowLayout: fixed }), true);
      });
    });
  }

  function renderFreeViewInto(container, s, isEdit) {
    var freeLayout = s.freeLayout || [];
    var students = APP_STATE.students || [];
    var stuMap = {};
    students.forEach(function(st) { stuMap[st.id] = st; });

    var html = '<div class="seat-classroom seat-classroom-free">';
    html += '<div class="seat-board">📋 黑板（前方）</div>';
    html += '<div class="seat-free-area" id="seatEditorFreeArea">';

    var scaleStyle = isEdit ? ('transform:scale(' + FREE_SCALE + ');transform-origin:top left;') : '';

    function cardHtml(cls, id, x, y, seat, name) {
      return '<div class="' + cls + '" data-id="' + id + '" style="left:' + x + '%;top:' + y + '%;' + scaleStyle + '">' +
        '<span class="seat-num">' + seat + '</span><span class="seat-name">' + escapeHtml(name) + '</span>' +
        '</div>';
    }

    freeLayout.forEach(function(item) {
      var st = stuMap[item.id];
      if (!st) return;
      var cls = 'seat-free-card' + (isEdit ? ' seat-free-draggable' : '');
      html += cardHtml(cls, item.id, item.x, item.y, st.seat||'', st.name||'');
    });

    var placed = freeLayout.map(function(i) { return i.id; });
    students.filter(function(st) { return placed.indexOf(st.id) < 0; }).forEach(function(st, idx) {
      var x = 1 + (idx % 6) * 15, y = 3;
      var cls = 'seat-free-card seat-free-unplaced' + (isEdit ? ' seat-free-draggable' : '');
      html += cardHtml(cls, st.id, x, y, st.seat||'', st.name||'');
    });

    html += '</div></div>';
    container.innerHTML = html;

    if (isEdit) bindFreeDragInto(container, s);
  }

  function bindFreeDragInto(container, s) {
    var area = container.querySelector("#seatEditorFreeArea");
    if (!area) return;
    var fl = (s.freeLayout || []).map(function(i) { return Object.assign({}, i); });
    var unplacedIds = (APP_STATE.students || []).map(function(st) { return st.id; })
      .filter(function(id) { return !fl.find(function(i) { return i.id === id; }); });

    area.querySelectorAll(".seat-free-draggable").forEach(function(card) {
      var startX, startY, startL, startT, isDragging = false;

      function pointerStart(cx, cy) {
        isDragging = true;
        startX = cx; startY = cy;
        startL = parseFloat(card.style.left) || 0;
        startT = parseFloat(card.style.top) || 0;
        card.classList.add("seat-free-dragging");
        card.style.zIndex = 999;
      }
      function pointerMove(cx, cy) {
        if (!isDragging) return;
        var areaRect = area.getBoundingClientRect();
        var dx = (cx - startX) / areaRect.width * 100;
        var dy = (cy - startY) / areaRect.height * 100;
        var newL = Math.max(0, Math.min(95, startL + dx));
        var newT = Math.max(0, Math.min(90, startT + dy));
        card.style.left = newL.toFixed(1) + "%";
        card.style.top = newT.toFixed(1) + "%";
      }
      function pointerEnd() {
        if (!isDragging) return;
        isDragging = false;
        card.classList.remove("seat-free-dragging");
        card.style.zIndex = "";
        var id = card.dataset.id;
        var x = parseFloat(card.style.left);
        var y = parseFloat(card.style.top);
        var existing = fl.find(function(i) { return i.id === id; });
        if (existing) { existing.x = x; existing.y = y; }
        else fl.push({ id: id, x: x, y: y });
        if (SEATING) SEATING._editFreeLayout = fl;
      }

      card.addEventListener("mousedown", function(e) { if (e.button === 0) { pointerStart(e.clientX, e.clientY); e.preventDefault(); } });
      document.addEventListener("mousemove", function(e) { pointerMove(e.clientX, e.clientY); });
      document.addEventListener("mouseup", pointerEnd);
      card.addEventListener("touchstart", function(e) { var t = e.touches[0]; pointerStart(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
      document.addEventListener("touchmove", function(e) { if (!isDragging) return; e.preventDefault(); var t = e.touches[0]; pointerMove(t.clientX, t.clientY); }, { passive: false });
      document.addEventListener("touchend", pointerEnd);
    });

    if (SEATING) SEATING._editFreeLayout = fl;
  }

  /* ── 6B. 縮放控制 ── */
  function updateScaleLabel() {
    var label = document.getElementById("seatScaleLabel");
    if (label) label.textContent = Math.round(FREE_SCALE * 100) + "%";
    // 套用到所有卡片
    var area = document.querySelector("#seatEditorFreeArea");
    if (area) {
      area.querySelectorAll(".seat-free-card").forEach(function(card) {
        applyCardScale(card);
      });
    }
  }

  function applyCardScale(card) {
    card.style.transform = "scale(" + FREE_SCALE + ")";
    card.style.transformOrigin = "top left";
  }

  window.seatScaleChange = function(delta) {
    FREE_SCALE = Math.min(2.0, Math.max(0.4, parseFloat((FREE_SCALE + delta).toFixed(1))));
    updateScaleLabel();
    // 也存到 SEATING 暫存，儲存時一起存
    if (SEATING) SEATING._editScale = FREE_SCALE;
  };

  window.seatScaleReset = function() {
    FREE_SCALE = 1.0;
    updateScaleLabel();
    if (SEATING) SEATING._editScale = FREE_SCALE;
  };

  /* ── 7. 自動排入學生 ── */
  window.seatAutoFill = function() {
    var s = getEditorState();
    var students = (APP_STATE.students || []).slice().sort(function(a, b) { return (a.seat||0) - (b.seat||0); });

    if (s.mode === "rows") {
      // 限制：學生人數不可超過座位總數（行×列）
      var capacity = (s.rows || 0) * (s.cols || 0);
      if (students.length > capacity) {
        if (typeof toast === "function")
          toast("人數比座位數多（學生 " + students.length + " 人，座位 " + capacity + " 個＝" + s.rows + "列×" + s.cols + "欄），請增加列數或欄數後再試。", "error");
        return false;
      }
      var layout = [];
      var idx = 0;
      for (var r = 0; r < s.rows; r++) {
        var row = [];
        for (var c = 0; c < s.cols; c++) {
          row.push(idx < students.length ? students[idx++].id : "");
        }
        layout.push(row);
      }
      if (SEATING) { SEATING.rowLayout = layout; SEATING._editLayout = layout; }
      else SEATING = Object.assign({}, DEFAULT_SEATING, { rowLayout: layout });
    } else {
      var fl = [];
      var n = students.length;
      if (n > 0) {
        // 卡片寬 68px、高約 58px，area 高 420px，寬約 100%
        // 用百分比計算：卡片寬≈10%、高≈14%（含間距），確保所有卡片在 97% 高度內
        // 欄數：讓卡片高度*列數 ≤ 95%
        var cols = Math.ceil(Math.sqrt(n * 1.5)); // 橫向稍多一點
        cols = Math.max(4, Math.min(cols, 10));   // 4~10 欄
        var rows = Math.ceil(n / cols);
        // 動態計算間距：x 方向均分 96%（留 2% 邊距），y 方向均分 92%（留頂部 8% 給黑板後的空間）
        var xStep = (cols > 1) ? (94 / (cols - 1 + 1)) : 0;   // 欄間距
        var yStep = (rows > 1) ? (88 / rows) : 0;              // 列間距
        // x 起始 2%，y 起始 5%
        students.forEach(function(st, i) {
          var c = i % cols, r = Math.floor(i / cols);
          var x = 2 + c * xStep;
          var y = 5 + r * yStep;
          // 確保不超出右邊（卡片寬約 10%）
          x = Math.min(x, 88);
          // 確保不超出底部（卡片高約 14%）
          y = Math.min(y, 84);
          fl.push({ id: st.id, x: parseFloat(x.toFixed(1)), y: parseFloat(y.toFixed(1)) });
        });
      }
      if (SEATING) { SEATING.freeLayout = fl; SEATING._editFreeLayout = fl; }
      else SEATING = Object.assign({}, DEFAULT_SEATING, { freeLayout: fl });
    }
    refreshEditorPreview();
  };

  /* ── 8. 儲存 ── */
  window.saveSeating = function() {
    if (typeof db === "undefined" || !db) return;
    var s = getEditorState();
    var data = Object.assign({}, SEATING || DEFAULT_SEATING, s);

    // 取出暫存的拖曳結果
    if (s.mode === "rows" && SEATING && SEATING._editLayout) data.rowLayout = SEATING._editLayout;
    if (s.mode === "free" && SEATING && SEATING._editFreeLayout) data.freeLayout = SEATING._editFreeLayout;
    if (s.mode === "free") data.freeScale = (SEATING && SEATING._editScale != null) ? SEATING._editScale : FREE_SCALE;

    // 清除臨時欄位
    delete data._editLayout;
    delete data._editFreeLayout;
    delete data._editScale;

    // rowLayout 是二維陣列，Firebase 不支援 nested array，序列化成 JSON 字串儲存
    if (Array.isArray(data.rowLayout)) {
      data.rowLayout = JSON.stringify(data.rowLayout);
    }

    db.collection("classroom").doc("seating").set(data)
      .then(function() { if (typeof toast === "function") toast("座位表已儲存", "success"); if (typeof closeModal === "function") closeModal(); })
      .catch(function(err) { if (typeof toast === "function") toast("儲存失敗：" + err.message, "error"); });
  };

  /* ── 9. 下載 PDF ── */
  window.downloadSeatPdf = function() {
    // 動態載入 html2canvas + jsPDF
    function loadScript(src, cb) {
      if (document.querySelector('script[src="' + src + '"]')) { cb(); return; }
      var s = document.createElement("script"); s.src = src; s.onload = cb; document.head.appendChild(s);
    }
    if (typeof toast === "function") toast("正在產生 PDF，請稍候…", "info");

    loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js", function() {
      loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js", function() {
        var target = document.querySelector("#seatEditorBody .seat-classroom") ||
                     document.querySelector("#seatContent .seat-classroom");
        if (!target) { if (typeof toast === "function") toast("找不到座位表", "error"); return; }

        html2canvas(target, { scale: 2, backgroundColor: "#ffffff", useCORS: true }).then(function(canvas) {
          var { jsPDF } = window.jspdf;
          var imgW = 280, imgH = canvas.height / canvas.width * imgW;
          var pdf = new jsPDF({ orientation: imgH > imgW ? "p" : "l", unit: "mm", format: "a4" });
          var pageW = pdf.internal.pageSize.getWidth();
          var pageH = pdf.internal.pageSize.getHeight();
          var x = (pageW - imgW) / 2, y = (pageH - imgH) / 2;
          if (y < 0) y = 5;
          pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", x, y, imgW, imgH);
          pdf.save("座位表.pdf");
        }).catch(function(e) {
          if (typeof toast === "function") toast("PDF 匯出失敗：" + e.message, "error");
        });
      });
    });
  }

  /* ── 10. 後台管理（adminSeating） ── */
  function adminSeating(body) {
    var permHtml = (typeof permBlockHtml === "function") ? permBlockHtml("seating", "班級座位表") : "";
    body.innerHTML =
      '<div class="space-y-4">' +
        permHtml +
        '<div class="space-y-3 text-center py-8">' +
          '<div class="text-4xl">🪑</div>' +
          '<h4 class="font-bold text-base text-slate-700">座位表請在主畫面操作</h4>' +
          '<p class="text-sm text-slate-500 leading-relaxed">' +
            '請關閉後台，回到主畫面的「<b>班級座位表</b>」區塊，點「<b>✏️ 編輯座位表</b>」即可：<br>' +
            '設定按列／自由模式、行列數、自動排入學生、拖曳調整位置、切換教師視角、匯出 PDF。' +
          '</p>' +
          '<button onclick="closeModal()" class="btn3d b-emerald text-sm mt-2">關閉後台，回主畫面操作</button>' +
        '</div>' +
      '</div>';
  }

  window.adminSeatSave = function() {
    if (typeof db === "undefined" || !db) return;
    var mode = (document.querySelector('input[name="adminSeatMode"]:checked') || {}).value || "rows";
    var rows = +(document.getElementById("adminSeatRows") || {}).value || 6;
    var cols = +(document.getElementById("adminSeatCols") || {}).value || 8;
    db.collection("classroom").doc("seating").set({ mode: mode, rows: rows, cols: cols }, { merge: true })
      .then(function() { if (typeof toast === "function") toast("設定已儲存", "success"); })
      .catch(function(err) { if (typeof toast === "function") toast("儲存失敗", "error"); });
  };

  window.adminSeatAutoFill = function() {
    // seatAutoFill 失敗（人數超過座位數）時回傳 false，這時不要儲存
    if (window.seatAutoFill && window.seatAutoFill() === false) return;
    window.saveSeating && window.saveSeating();
  };

  window.adminSeatClear = function() {
    if (typeof db === "undefined" || !db) return;
    if (typeof confirmDialog === "function") {
      confirmDialog("清空座位表", "確定要清空所有座位排列資料？此動作無法復原。", { okText: "清空", danger: true })
        .then(function(ok) {
          if (!ok) return;
          db.collection("classroom").doc("seating").set({ rowLayout: [], freeLayout: [] }, { merge: true })
            .then(function() { if (typeof toast === "function") toast("座位表已清空", "success"); });
        });
    }
  };

  /* ── 11. 曝光到全域（供 index.html / 30-admin.js 呼叫） ── */
  window.setupSeating      = setupSeating;
  window.renderSeating     = renderSeating;
  window.openSeatingEditor = openSeatingEditor;
  window.adminSeating      = adminSeating;

  /* 切換教師視角（左右鏡像，只影響顯示） */
  window.toggleSeatTeacherView = function() {
    _teacherView = !_teacherView;
    var btn = document.getElementById("seatViewToggle");
    if (btn) {
      btn.textContent = _teacherView ? "👥 學生視角" : "👁️ 教師視角";
      btn.classList.toggle("b-amber", _teacherView);
      btn.classList.toggle("b-indigo", !_teacherView);
    }
    if (typeof toast === "function") toast(_teacherView ? "已切換為教師視角（左右鏡像）" : "已切換為學生視角", "info");
    renderSeating();
  };

  /* 用 escapeHtml（來自 04-utils.js） */
  function escapeHtml(s) {
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

})();
