/* ════════════════════════════════════════════════════════════════════
   60-points.js  課堂加扣分模組（原 points-module.js）
   ────────────────────────────────────────────────────────────────────
   作者：阿剛老師　│　整合：班級親師互動網 V2
   功能完全參考「現代風加扣分系統」教師端：
     • 教師端：點學生卡片開啟加扣分視窗、管理行為項目、查看個人歷史、重設點數、
       全螢幕卡牆加扣分、依小組批次加扣分
     • 家長／學生端：唯讀。顯示「全班點數排行」，但只有自己孩子顯示姓名，
       其餘同學以「○號」匿名呈現。
   後台：老師後台新增「加扣分」分頁（行為管理 + 學生分組設定）。
   權限：沿用三段式設定（關閉 off / 公開瀏覽 public / 登入瀏覽 login）
   資料：沿用既有 students 集合（每筆學生 doc 上新增 points、group 欄位）
         classroom/config.perms.points     ← 權限
         behaviors 集合                      ← 加扣分行為項目
         pointlogs 集合                      ← 加扣分歷史紀錄
   ════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  /* ── 1. 註冊進既有的權限／名稱／排序系統 ──
     本檔在主程式核心 <script> 之前或之後載入皆可；註冊動作延後到
     setupPoints()（startApp 內）才執行，確保全域變數已就緒。 */
  function registerModule() {
    if (typeof DEFAULT_PERMS === "object" && DEFAULT_PERMS && !DEFAULT_PERMS.points) DEFAULT_PERMS.points = "login";
    if (typeof MODULE_NAMES === "object" && MODULE_NAMES) MODULE_NAMES.points = "課堂加扣分";
    if (typeof ORDER_LABELS === "object" && ORDER_LABELS) ORDER_LABELS.points = "課堂加扣分";
    if (typeof DEFAULT_ORDER !== "undefined" && Array.isArray(DEFAULT_ORDER) && DEFAULT_ORDER.indexOf("points") < 0) DEFAULT_ORDER.push("points");
  }

  /* ── 2. 模組狀態 ── */
  var BEHAVIORS = [];        // [{id,name,points,type}]
  var behUnsub = null;
  var ptStudentId = null;    // 目前操作中的學生 id
  var _behSaving = false;    // 儲存行為項目中（避免本地模式 batch 非原子時誤觸自動補預設）

  var DEFAULT_BEHAVIORS = [
    { name: "踴躍發言", points: 1, type: "positive" },
    { name: "熱心助人", points: 1, type: "positive" },
    { name: "準時繳交作業", points: 2, type: "positive" },
    { name: "團隊合作", points: 1, type: "positive" },
    { name: "創意表現", points: 2, type: "positive" },
    { name: "上課分心", points: -1, type: "negative" },
    { name: "未交作業", points: -2, type: "negative" },
    { name: "影響秩序", points: -1, type: "negative" },
    { name: "遲到", points: -1, type: "negative" }
  ];

  /* ── 3. 啟動：監聽行為項目 ── */
  function setupPoints() {
    registerModule();
    if (typeof db === "undefined" || !db) return;
    if (behUnsub) behUnsub();
    behUnsub = db.collection("behaviors").onSnapshot(function (snap) {
      BEHAVIORS = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      BEHAVIORS.sort(function (a, b) { return (a.points || 0) - (b.points || 0); });
      // 本地模式下 batch 為非原子，儲存過程中會短暫出現空集合；_behSaving 時不可自動補預設，否則造成重複
      if (snap.empty && APP_STATE.isTeacher && !_behSaving) seedDefaultBehaviors();
      renderPoints();
    }, function (err) { console.warn("行為項目監聽失敗", err); });
  }

  function seedDefaultBehaviors() {
    var batch = db.batch();
    DEFAULT_BEHAVIORS.forEach(function (b) { batch.set(db.collection("behaviors").doc(), b); });
    batch.commit().catch(function (e) { console.warn("建立預設行為失敗", e); });
  }

  /* ── 4. 主畫面渲染 ── */
  function renderPoints() {
    var sec = document.querySelector('[data-module="points"]');
    if (!sec) return;
    var locked = document.getElementById("ptLocked");
    var body = document.getElementById("ptBody");
    var toolBtn = document.getElementById("ptManageBtn");
    if (!body) return;

    if (!canView("points")) {
      if (locked) locked.classList.remove("hidden");
      body.classList.add("hidden");
      if (toolBtn) toolBtn.classList.add("hidden");
      return;
    }
    if (locked) locked.classList.add("hidden");
    body.classList.remove("hidden");

    if (APP_STATE.isTeacher) renderTeacherBoard(body, toolBtn);
    else renderParentBoard(body, toolBtn);

    // 若全螢幕卡牆開啟中，一併更新
    if (APP_STATE.isTeacher && document.getElementById("ptFsBody")) renderFullscreen();
  }

  function ptOf(stu) {
    var v = stu ? Number(stu.points) : 0;
    return isFinite(v) ? v : 0;   // 防呆：舊資料若為 NaN / 物件等，視為 0，避免畫面顯示 NaN
  }

  /* 列出目前所有分組名稱（依出現順序） */
  function groupList() {
    var seen = [];
    (APP_STATE.students || []).forEach(function (s) {
      var g = (s.group || "").trim();
      if (g && seen.indexOf(g) < 0) seen.push(g);
    });
    return seen;
  }

  /* ── 4a. 教師端：可點擊的學生卡片牆 ── */
  function renderTeacherBoard(body, toolBtn) {
    if (toolBtn) toolBtn.classList.remove("hidden");
    var students = (APP_STATE.students || []).slice().sort(function (a, b) { return Number(a.seat) - Number(b.seat); });
    if (!students.length) {
      body.innerHTML = '<p class="text-slate-400 text-sm py-4 text-center">尚無學生名單，請先到老師後台建立。</p>';
      return;
    }
    var cards = students.map(function (s) { return studentCardHtml(s); }).join("");
    var groups = groupList();
    var groupBtn = groups.length ? '<button onclick="ptGroupAward()" class="btn3d b-emerald text-xs">👥 小組加扣分</button>' : '';
    body.innerHTML =
      '<div class="flex items-center justify-between mb-3 gap-2">' +
        '<p class="text-xs text-slate-400">點選學生即可加扣分；點數會即時同步給家長。</p>' +
        '<div class="flex gap-2 shrink-0">' + groupBtn +
          '<button onclick="ptFullscreen()" class="btn3d b-indigo text-xs">🔍 放大</button>' +
        '</div>' +
      '</div>' +
      '<div class="pt-grid">' + cards + '</div>';
  }

  /* 單張學生卡 HTML */
  function studentCardHtml(s, big, onclickJs) {
    var pts = ptOf(s);
    var color = pts > 0 ? "pt-pos" : (pts < 0 ? "pt-neg" : "pt-zero");
    var name = s.hideName ? (s.seat + "號") : (s.name || (s.seat + "號"));
    var grp = (s.group || "").trim();
    var click = onclickJs || ("ptOpenStudent('" + s.id + "')");
    return '<button class="pt-card ' + color + (big ? ' pt-card-big' : '') + '" onclick="' + click + '">' +
      '<div class="pt-seat">' + escapeHtml(String(s.seat)) + '號' + (grp ? ' · ' + escapeHtml(grp) : '') + '</div>' +
      '<div class="pt-name">' + escapeHtml(name) + '</div>' +
      '<div class="pt-val">' + pts + '</div></button>';
  }

  /* ── 4b. 家長／學生端：我的點數 + 區段提示 ── */
  function renderParentBoard(body, toolBtn) {
    if (toolBtn) toolBtn.classList.add("hidden");
    var mySeat = APP_STATE.session ? String(APP_STATE.session.seat) : null;
    var students = (APP_STATE.students || []).slice().sort(function (a, b) {
      return ptOf(b) - ptOf(a) || (Number(a.seat) - Number(b.seat));
    });
    if (!students.length) {
      body.innerHTML = '<p class="text-slate-400 text-sm py-4 text-center">尚無資料。</p>';
      return;
    }
    var myStu = students.filter(function (s) { return mySeat !== null && String(s.seat) === mySeat; })[0];
    if (!myStu) {
      body.innerHTML = '<p class="text-slate-400 text-sm py-4 text-center">請先登入查看點數。</p>';
      return;
    }

    var myPts = ptOf(myStu);
    var n = students.length;
    var myRank = students.findIndex(function (s) { return s.id === myStu.id; }) + 1; // 1-based

    // 計算區段：前三分之一 / 中間 / 後三分之一
    var topEnd    = Math.ceil(n / 3);
    var bottomStart = n - Math.floor(n / 3) + 1;
    var segment, segIcon, segColor, segBg;
    if (myRank <= topEnd) {
      segment = "前段"; segIcon = "🌟"; segColor = "text-emerald-700"; segBg = "bg-emerald-50 border-emerald-200";
    } else if (myRank >= bottomStart) {
      segment = "後段"; segIcon = "💪"; segColor = "text-rose-600"; segBg = "bg-rose-50 border-rose-200";
    } else {
      segment = "中段"; segIcon = "👍"; segColor = "text-amber-600"; segBg = "bg-amber-50 border-amber-200";
    }

    var ptColor = myPts > 0 ? "text-emerald-600" : (myPts < 0 ? "text-rose-600" : "text-slate-400");
    var histBtn = '<button onclick="ptViewHistory(\'' + myStu.id + '\')" class="btn3d b-indigo text-xs mt-4 w-full">📜 查看加扣分紀錄</button>';

    body.innerHTML =
      '<div class="pt-myhead"><span>' + escapeHtml(myStu.seat + "號 " + (myStu.name || "")) +
        ' 目前點數</span><b class="' + ptColor + '">' + myPts + '</b></div>' +
      '<div class="mt-3 border rounded-2xl px-4 py-3 flex items-center gap-3 ' + segBg + '">' +
        '<span class="text-2xl">' + segIcon + '</span>' +
        '<div>' +
          '<div class="text-xs text-slate-500">在班上的點數區段</div>' +
          '<div class="font-black text-base ' + segColor + '">' + segment + '</div>' +
        '</div>' +
      '</div>' +
      histBtn;
  }

  /* ── 5. 教師端：開啟某學生的加扣分視窗 ── */
  function ptOpenStudent(id) {
    if (!APP_STATE.isTeacher) return;
    var stu = (APP_STATE.students || []).filter(function (s) { return s.id === id; })[0];
    if (!stu) return;
    ptStudentId = id;
    var name = stu.hideName ? (stu.seat + "號") : (stu.seat + "號 " + (stu.name || ""));
    var pos = BEHAVIORS.filter(function (b) { return b.type === "positive"; });
    var neg = BEHAVIORS.filter(function (b) { return b.type === "negative"; });
    function btnHtml(b, cls) {
      var p = (b.points > 0 ? "+" + b.points : b.points);
      return '<button class="pt-beh ' + cls + '" onclick="ptAward(\'' + b.id + '\')">' +
        '<span>' + escapeHtml(b.name) + '</span><span class="pt-beh-pt">' + p + '</span></button>';
    }
    showModal(
      '<div class="p-6 space-y-4 overflow-y-auto">' +
        '<div class="flex items-center justify-between"><h3 class="font-bold text-lg">給「' + escapeHtml(name) + '」點數</h3>' +
        '<button onclick="closeModal()" class="text-slate-400 hover:text-slate-600 text-xl">×</button></div>' +
        '<div class="text-center text-sm text-slate-500">目前點數：<b class="text-lg ' + (ptOf(stu) >= 0 ? "text-emerald-600" : "text-rose-600") + '">' + ptOf(stu) + '</b></div>' +
        '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">' +
          '<div class="bg-emerald-50 rounded-2xl p-3 border border-emerald-100"><h4 class="font-bold text-emerald-700 text-sm mb-2">👍 加分</h4>' +
            '<div class="space-y-2">' + (pos.map(function (b) { return btnHtml(b, "pt-beh-pos"); }).join("") || '<p class="text-xs text-slate-400">尚無項目</p>') + '</div></div>' +
          '<div class="bg-rose-50 rounded-2xl p-3 border border-rose-100"><h4 class="font-bold text-rose-700 text-sm mb-2">⚠️ 待改進</h4>' +
            '<div class="space-y-2">' + (neg.map(function (b) { return btnHtml(b, "pt-beh-neg"); }).join("") || '<p class="text-xs text-slate-400">尚無項目</p>') + '</div></div>' +
        '</div>' +
        '<div class="flex gap-2 pt-1">' +
          '<button onclick="ptManualAdjust()" class="btn3d b-slate text-xs flex-1">✏️ 自訂分數</button>' +
          '<button onclick="ptViewHistory(\'' + id + '\')" class="btn3d b-indigo text-xs flex-1">📜 查看紀錄</button>' +
        '</div>' +
      '</div>', { size: "max-w-lg" });
  }

  function ptAward(behId) {
    var beh = BEHAVIORS.filter(function (b) { return b.id === behId; })[0];
    if (!beh || !ptStudentId) return;
    applyPoints(ptStudentId, Number(beh.points), beh.name);
  }

  function ptManualAdjust() {
    var stu = (APP_STATE.students || []).filter(function (s) { return s.id === ptStudentId; })[0];
    if (!stu) return;
    showModal(
      '<div class="p-6 space-y-4">' +
        '<h3 class="font-bold text-lg">自訂加扣分</h3>' +
        '<div><label class="text-sm font-medium">分數（正數加分、負數扣分）</label>' +
        '<input id="ptManVal" type="number" value="1" class="w-full mt-1 border rounded-xl px-3 py-2 text-sm" /></div>' +
        '<div><label class="text-sm font-medium">原因（選填）</label>' +
        '<input id="ptManReason" class="w-full mt-1 border rounded-xl px-3 py-2 text-sm" placeholder="例：自主學習" /></div>' +
        '<div class="flex gap-2 justify-end"><button onclick="closeModal()" class="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-sm">取消</button>' +
        '<button id="ptManOk" class="btn3d b-blue text-sm">確定</button></div>' +
      '</div>', { size: "max-w-sm" });
    document.getElementById("ptManOk").onclick = function () {
      var v = Number(document.getElementById("ptManVal").value);
      if (!v) { toast("請輸入非零分數", "warn"); return; }
      var reason = document.getElementById("ptManReason").value.trim() || (v > 0 ? "自訂加分" : "自訂扣分");
      applyPoints(ptStudentId, v, reason);
    };
  }

  /* 核心：寫入點數與紀錄 */
  function applyPoints(studentId, delta, reason) {
    var stu = (APP_STATE.students || []).filter(function (s) { return s.id === studentId; })[0];
    if (!stu) return;
    // 直接寫入「絕對新總分」(舊總分 + delta)，雲端／本地皆穩定，且不受 FieldValue.increment 實作差異影響
    var newTotal = ptOf(stu) + Number(delta);
    var batch = db.batch();
    batch.update(db.collection("students").doc(studentId), { points: newTotal });
    batch.set(db.collection("pointlogs").doc(), {
      studentId: studentId, seat: stu.seat, studentName: stu.name || "",
      behaviorName: reason, points: delta,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    batch.commit().then(function () {
      closeModal();
      toast(stu.seat + "號 " + (delta > 0 ? "+" : "") + delta + " 分！", delta > 0 ? "success" : "warn");
    }).catch(function (e) { toast("更新失敗：" + e.message, "error"); });
  }

  /* ── 5b. 全螢幕加扣分卡牆 ── */
  function ptFullscreen() {
    if (!APP_STATE.isTeacher) return;
    showModal(
      '<div class="pt-fs flex flex-col">' +
        '<div class="px-5 py-3 border-b flex items-center justify-between shrink-0">' +
          '<h3 class="font-bold text-lg">⭐ 課堂加扣分（全班）</h3>' +
          '<button onclick="closeModal()" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">×</button>' +
        '</div>' +
        '<div id="ptFsBody" class="px-5 py-4 overflow-y-auto flex-1"></div>' +
      '</div>', { size: "max-w-5xl", noBackdropClose: true });
    renderFullscreen();
  }

  function renderFullscreen() {
    var box = document.getElementById("ptFsBody");
    if (!box) return;
    var students = (APP_STATE.students || []).slice().sort(function (a, b) { return Number(a.seat) - Number(b.seat); });
    if (!students.length) { box.innerHTML = '<p class="text-slate-400 text-center py-8">尚無學生名單。</p>'; return; }
    var cards = students.map(function (s) { return studentCardHtml(s, true); }).join("");
    var groups = groupList();
    var groupBtn = groups.length ? '<button onclick="ptGroupAward()" class="btn3d b-emerald text-xs mb-3">👥 小組加扣分</button>' : '';
    box.innerHTML = groupBtn + '<div class="pt-grid pt-grid-big">' + cards + '</div>';
  }

  /* ── 5c. 小組加扣分 ── */
  function ptGroupAward(groupName) {
    if (!APP_STATE.isTeacher) return;
    var groups = groupList();
    if (!groups.length) { toast("尚未設定分組，請到後台「加扣分」分頁設定", "warn"); return; }
    if (!groupName) {
      var opts = groups.map(function (g) {
        var mem = (APP_STATE.students || [])
          .filter(function (s) { return (s.group || "").trim() === g; })
          .sort(function (a, b) { return Number(a.seat) - Number(b.seat); });
        var names = mem.map(function (m) {
          return '<span class="pt-grp-chip">' + escapeHtml(m.hideName ? (m.seat + "號") : (m.name || (m.seat + "號"))) + '</span>';
        }).join("");
        return '<button class="pt-grp-card" onclick="ptGroupAward(\'' + encodeURIComponent(g) + '\')">' +
          '<div class="pt-grp-card-head"><span class="pt-grp-card-name">' + escapeHtml(g) + '</span>' +
          '<span class="pt-grp-card-count">' + mem.length + ' 人</span></div>' +
          '<div class="pt-grp-chips">' + (names || '<span class="text-xs text-slate-400">（無組員）</span>') + '</div></button>';
      }).join("");
      showModal(
        '<div class="p-6 space-y-4">' +
          '<div class="flex items-center justify-between"><h3 class="font-bold text-lg">選擇要加扣分的小組</h3>' +
          '<button onclick="closeModal()" class="text-slate-400 hover:text-slate-600 text-xl">×</button></div>' +
          '<div class="pt-grp-pick">' + opts + '</div>' +
        '</div>', { size: "max-w-lg" });
      return;
    }
    var gName = decodeURIComponent(groupName);
    var members = (APP_STATE.students || []).filter(function (s) { return (s.group || "").trim() === gName; });
    if (!members.length) { toast("該組沒有成員", "warn"); return; }
    var pos = BEHAVIORS.filter(function (b) { return b.type === "positive"; });
    var neg = BEHAVIORS.filter(function (b) { return b.type === "negative"; });
    function btnHtml(b, cls) {
      var p = (b.points > 0 ? "+" + b.points : b.points);
      return '<button class="pt-beh ' + cls + '" onclick="ptGroupAwardApply(\'' + encodeURIComponent(gName) + '\',\'' + b.id + '\')">' +
        '<span>' + escapeHtml(b.name) + '</span><span class="pt-beh-pt">' + p + '</span></button>';
    }
    var memberCards = members
      .slice()
      .sort(function (a, b) { return Number(a.seat) - Number(b.seat); })
      .map(function (m) { return studentCardHtml(m, false, "void 0"); })
      .join("");
    showModal(
      '<div class="p-6 space-y-4 overflow-y-auto">' +
        '<div class="flex items-center justify-between"><h3 class="font-bold text-lg">「' + escapeHtml(gName) + '」全組加扣分（' + members.length + ' 人）</h3>' +
        '<button onclick="closeModal()" class="text-slate-400 hover:text-slate-600 text-xl">×</button></div>' +
        '<div><p class="text-xs text-slate-500 mb-2">組員名單</p><div class="pt-grid pt-grid-members">' + memberCards + '</div></div>' +
        '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">' +
          '<div class="bg-emerald-50 rounded-2xl p-3 border border-emerald-100"><h4 class="font-bold text-emerald-700 text-sm mb-2">👍 加分</h4>' +
            '<div class="space-y-2">' + (pos.map(function (b) { return btnHtml(b, "pt-beh-pos"); }).join("") || '<p class="text-xs text-slate-400">尚無項目</p>') + '</div></div>' +
          '<div class="bg-rose-50 rounded-2xl p-3 border border-rose-100"><h4 class="font-bold text-rose-700 text-sm mb-2">⚠️ 待改進</h4>' +
            '<div class="space-y-2">' + (neg.map(function (b) { return btnHtml(b, "pt-beh-neg"); }).join("") || '<p class="text-xs text-slate-400">尚無項目</p>') + '</div></div>' +
        '</div>' +
      '</div>', { size: "max-w-lg" });
  }

  function ptGroupAwardApply(groupName, behId) {
    var gName = decodeURIComponent(groupName);
    var beh = BEHAVIORS.filter(function (b) { return b.id === behId; })[0];
    if (!beh) return;
    var members = (APP_STATE.students || []).filter(function (s) { return (s.group || "").trim() === gName; });
    if (!members.length) return;
    var delta = Number(beh.points);
    var batch = db.batch();
    members.forEach(function (stu) {
      batch.update(db.collection("students").doc(stu.id), { points: ptOf(stu) + delta });
      batch.set(db.collection("pointlogs").doc(), {
        studentId: stu.id, seat: stu.seat, studentName: stu.name || "",
        behaviorName: "[" + gName + "] " + beh.name, points: delta,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
    batch.commit().then(function () {
      closeModal();
      toast("「" + gName + "」全組 " + (delta > 0 ? "+" : "") + delta + " 分！", delta > 0 ? "success" : "warn");
      if (document.getElementById("ptFsBody")) renderFullscreen();
    }).catch(function (e) { toast("更新失敗：" + e.message, "error"); });
  }

  /* ── 6. 歷史紀錄 ── */
  function ptViewHistory(studentId) {
    var stu = (APP_STATE.students || []).filter(function (s) { return s.id === studentId; })[0];
    if (!stu) return;
    if (!APP_STATE.isTeacher) {
      if (!APP_STATE.session || String(APP_STATE.session.seat) !== String(stu.seat)) { toast("僅能查看自己孩子的紀錄", "warn"); return; }
    }
    var ownByParent = !APP_STATE.isTeacher && APP_STATE.session && String(APP_STATE.session.seat) === String(stu.seat);
    var title = (stu.hideName && !APP_STATE.isTeacher && !ownByParent) ? (stu.seat + "號") : (stu.seat + "號 " + (stu.name || ""));
    showModal(
      '<div class="flex flex-col max-h-[80vh]">' +
        '<div class="px-6 py-4 border-b flex items-center justify-between shrink-0"><h3 class="font-bold text-lg">' + escapeHtml(title) + ' 的加扣分紀錄</h3>' +
        '<button onclick="closeModal()" class="text-slate-400 hover:text-slate-600 text-xl">×</button></div>' +
        '<div id="ptHistBox" class="px-6 py-4 overflow-y-auto"><div class="text-center text-slate-400 py-6">讀取中…</div></div>' +
      '</div>', { size: "max-w-md" });
    db.collection("pointlogs").where("studentId", "==", studentId).limit(200).get().then(function (snap) {
      var logs = snap.docs.map(function (d) { return d.data(); });
      logs.sort(function (a, b) {
        var ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
        var tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
        return tb - ta;
      });
      var box = document.getElementById("ptHistBox");
      if (!box) return;
      if (!logs.length) { box.innerHTML = '<p class="text-center text-slate-400 py-6">尚無加扣分紀錄。</p>'; return; }
      box.innerHTML = logs.map(function (l) {
        var when = l.createdAt && l.createdAt.toDate ? l.createdAt.toDate().toLocaleString("zh-TW") : "";
        var p = l.points > 0 ? "+" + l.points : l.points;
        var cls = l.points > 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600";
        return '<div class="flex items-center justify-between rounded-xl px-3 py-2 mb-2 ' + cls + '">' +
          '<div><div class="font-bold text-sm">' + escapeHtml(l.behaviorName || "") + '</div>' +
          '<div class="text-xs opacity-70">' + escapeHtml(when) + '</div></div>' +
          '<div class="text-lg font-black">' + p + '</div></div>';
      }).join("");
    }).catch(function (e) {
      var box = document.getElementById("ptHistBox");
      if (box) box.innerHTML = '<p class="text-center text-rose-500 py-6">讀取失敗：' + escapeHtml(e.message) + '</p>';
    });
  }

  /* ── 7. 後台「加扣分」分頁（行為項目 / 分組 / 重設） ── */
  // 主畫面「⚙️ 管理」按鈕：開啟老師後台並切到加扣分分頁
  function ptManage() {
    if (!APP_STATE.isTeacher) { toast("請先以老師身分登入", "warn"); return; }
    if (typeof openAdmin === "function") openAdmin();
    if (typeof adminGoTab === "function") adminGoTab(10);
  }

  // 後台分頁主體（由 renderAdminTab(10) 呼叫）
  function adminPoints(body) {
    if (!body) return;
    var groups = groupList();
    body.innerHTML =
      '<div class="space-y-6">' +
        '<div>' +
          '<div class="flex items-center justify-between mb-2"><h4 class="font-bold text-sm">加扣分行為項目</h4>' +
          '<button onclick="ptAddBehRow()" class="btn3d b-emerald text-xs">＋ 新增一項</button></div>' +
          '<p class="text-xs text-slate-400 mb-2">正數為加分、負數為扣分。儲存後即時套用到加扣分視窗。</p>' +
          '<div id="ptBehEditor" class="space-y-2"></div>' +
          '<button id="ptSaveBeh" class="btn3d b-blue w-full mt-3 text-sm">💾 儲存行為項目</button>' +
        '</div>' +
        '<div class="border-t pt-5">' +
          '<div class="flex items-center justify-between mb-2"><h4 class="font-bold text-sm">學生分組</h4>' +
          '<span class="text-xs text-slate-400">目前 ' + groups.length + ' 組</span></div>' +
          '<p class="text-xs text-slate-400 mb-3">為每位學生設定組別（同名即同組，留空表示未分組）。設定後主畫面即可「小組加扣分」。</p>' +
          '<div class="flex flex-wrap gap-2 mb-3">' +
            '<input id="ptQuickGroup" class="flex-1 min-w-[140px] border rounded-xl px-3 py-2 text-sm" placeholder="快速套用組名，例：第一組">' +
            '<button onclick="ptApplyQuickGroup()" class="btn3d b-slate text-xs whitespace-nowrap">套用到已勾選</button>' +
          '</div>' +
          '<div id="ptGroupEditor" class="border rounded-xl overflow-hidden"></div>' +
          '<button id="ptSaveGroups" class="btn3d b-blue w-full mt-3 text-sm">💾 儲存分組</button>' +
        '</div>' +
        '<div class="border-t pt-5">' +
          '<h4 class="font-bold text-sm text-rose-600 mb-2">危險操作</h4>' +
          '<button onclick="ptResetAll()" class="btn3d b-rose w-full text-sm">🔄 全班點數歸零並清除紀錄</button>' +
        '</div>' +
      '</div>';
    var editor = document.getElementById("ptBehEditor");
    (BEHAVIORS.length ? BEHAVIORS : DEFAULT_BEHAVIORS).forEach(function (b) { addBehRow(editor, b); });
    document.getElementById("ptSaveBeh").onclick = saveBehaviors;
    renderGroupEditor();
    document.getElementById("ptSaveGroups").onclick = saveGroups;
  }

  function addBehRow(editor, b) {
    b = b || { name: "", points: 1, type: "positive" };
    var row = document.createElement("div");
    row.className = "pt-beh-row flex items-center gap-2 border rounded-xl px-2 py-2";
    row.innerHTML =
      '<input type="text" value="' + escapeHtml(b.name || "") + '" class="pt-beh-name flex-1 border rounded-lg px-2 py-1 text-sm" placeholder="行為名稱">' +
      '<input type="number" value="' + (b.points != null ? b.points : 1) + '" class="pt-beh-pts w-16 border rounded-lg px-2 py-1 text-sm text-center">' +
      '<select class="pt-beh-type border rounded-lg px-1 py-1 text-sm"><option value="positive"' + (b.type !== "negative" ? " selected" : "") + '>加分</option><option value="negative"' + (b.type === "negative" ? " selected" : "") + '>扣分</option></select>' +
      '<button class="text-rose-500 text-lg px-1" title="刪除">✕</button>';
    row.querySelector("button").onclick = function () { row.remove(); };
    editor.appendChild(row);
  }
  function ptAddBehRow() { var e = document.getElementById("ptBehEditor"); if (e) addBehRow(e); }

  function saveBehaviors() {
    var rows = document.querySelectorAll("#ptBehEditor .pt-beh-row");
    var list = [], ok = true;
    rows.forEach(function (r) {
      var name = r.querySelector(".pt-beh-name").value.trim();
      var pts = r.querySelector(".pt-beh-pts").value;
      var type = r.querySelector(".pt-beh-type").value;
      if (name && pts !== "") list.push({ name: name, points: Number(pts), type: type });
      else if (name || pts !== "") ok = false;
    });
    if (!ok) { toast("請完整填寫行為名稱與分數", "warn"); return; }
    if (!list.length) { toast("至少需要一項行為", "warn"); return; }
    _behSaving = true;   // 保護：儲存期間若集合短暫為空，不要自動補預設項目
    db.collection("behaviors").get().then(function (snap) {
      var batch = db.batch();
      snap.docs.forEach(function (d) { batch.delete(d.ref); });
      list.forEach(function (b) { batch.set(db.collection("behaviors").doc(), b); });
      return batch.commit();
    }).then(function () { toast("行為項目已儲存", "success"); })
      .catch(function (e) { toast("儲存失敗：" + e.message, "error"); })
      .then(function () { _behSaving = false; });
  }

  /* 分組編輯器 */
  function renderGroupEditor() {
    var box = document.getElementById("ptGroupEditor");
    if (!box) return;
    var students = (APP_STATE.students || []).slice().sort(function (a, b) { return Number(a.seat) - Number(b.seat); });
    if (!students.length) { box.innerHTML = '<p class="text-center text-slate-400 py-4 text-sm">尚無學生</p>'; return; }
    box.innerHTML =
      '<table class="w-full text-sm"><thead class="bg-slate-50 text-slate-500 text-xs"><tr>' +
      '<th class="py-2 px-2 w-8"></th><th class="py-2 px-2 text-left">座號</th><th class="py-2 px-2 text-left">姓名</th><th class="py-2 px-2 text-left">組別</th></tr></thead><tbody>' +
      students.map(function (s) {
        return '<tr class="border-t pt-grp-row" data-id="' + s.id + '">' +
          '<td class="py-1 px-2 text-center"><input type="checkbox" class="pt-grp-chk rounded"></td>' +
          '<td class="py-1 px-2">' + escapeHtml(String(s.seat)) + '</td>' +
          '<td class="py-1 px-2">' + escapeHtml(s.name || "") + '</td>' +
          '<td class="py-1 px-2"><input class="pt-grp-input border rounded-lg px-2 py-1 text-sm w-full" value="' + escapeHtml(s.group || "") + '" placeholder="未分組"></td>' +
          '</tr>';
      }).join("") + '</tbody></table>';
  }

  function ptApplyQuickGroup() {
    var g = (document.getElementById("ptQuickGroup").value || "").trim();
    var rows = document.querySelectorAll("#ptGroupEditor .pt-grp-row");
    var any = false;
    rows.forEach(function (r) {
      if (r.querySelector(".pt-grp-chk").checked) { r.querySelector(".pt-grp-input").value = g; any = true; }
    });
    if (!any) toast("請先勾選要套用的學生", "warn");
  }

  function saveGroups() {
    var rows = document.querySelectorAll("#ptGroupEditor .pt-grp-row");
    if (!rows.length) { toast("尚無學生", "warn"); return; }
    var batch = db.batch();
    rows.forEach(function (r) {
      var id = r.getAttribute("data-id");
      var g = (r.querySelector(".pt-grp-input").value || "").trim();
      batch.update(db.collection("students").doc(id), { group: g });
    });
    batch.commit().then(function () { toast("分組已儲存", "success"); })
      .catch(function (e) { toast("儲存失敗：" + e.message, "error"); });
  }

  /* 重設全班點數並清除紀錄 */
  async function ptResetAll() {
    var ok = await confirmDialog("確定要重設？", "此操作會將<b>全班點數歸零</b>並<b>刪除所有加扣分紀錄</b>，且無法復原。", { okText: "確定重設", danger: true });
    if (!ok) return;
    try {
      var batch = db.batch();
      (APP_STATE.students || []).forEach(function (s) { batch.update(db.collection("students").doc(s.id), { points: 0 }); });
      await batch.commit();
      var snap = await db.collection("pointlogs").get();
      var cur = db.batch(), n = 0, jobs = [];
      snap.docs.forEach(function (d) {
        cur.delete(d.ref); n++;
        if (n >= 450) { jobs.push(cur.commit()); cur = db.batch(); n = 0; }
      });
      if (n > 0) jobs.push(cur.commit());
      await Promise.all(jobs);
      toast("已重設全班點數與紀錄", "success");
    } catch (e) { toast("重設失敗：" + e.message, "error"); }
  }

  /* ── 8. 對外掛載 ── */
  window.setupPoints = setupPoints;
  window.renderPoints = renderPoints;
  window.ptOpenStudent = ptOpenStudent;
  window.ptAward = ptAward;
  window.ptManualAdjust = ptManualAdjust;
  window.ptViewHistory = ptViewHistory;
  window.ptManage = ptManage;
  window.adminPoints = adminPoints;
  window.ptAddBehRow = ptAddBehRow;
  window.ptResetAll = ptResetAll;
  window.ptFullscreen = ptFullscreen;
  window.ptGroupAward = ptGroupAward;
  window.ptGroupAwardApply = ptGroupAwardApply;
  window.ptApplyQuickGroup = ptApplyQuickGroup;
})();
