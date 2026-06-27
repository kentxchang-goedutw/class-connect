/* ══════════════════════════════════════════════════════════════════
   14-slips.js  回條拍照回傳（前台清單、上傳）
══════════════════════════════════════════════════════════════════ */

/* ════════ 模組 4：回條拍照回傳 ════════ */
let SLIP_DATA = [], SUB_DATA = [];
function setupSlips() {
  db.collection("slips").orderBy("createdAt", "desc").onSnapshot(snap => { SLIP_DATA = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderSlips(); }, err => console.warn("回條監聽失敗", err));
  db.collection("slipSubmissions").onSnapshot(snap => { SUB_DATA = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderSlips(); }, err => console.warn("回條繳交監聽失敗", err));
}

function renderSlips() {
  const locked = document.getElementById("slipLocked"), list = document.getElementById("slipList");

  // 教師端：最優先 — 直接在前台回條區呈現後台「回條進度」管理介面，
  // 免進後台即可查看、審核、下載（不受權限鎖影響）。
  if (APP_STATE.isTeacher) {
    if (locked) locked.classList.add("hidden");
    if (list) list.classList.remove("hidden");
    if (typeof adminSlips === "function") {
      adminSlips(list, true);   // hideCreate：前台已有右上角「建立回條」按鈕，不重複顯示表單
    } else {
      // 後台模組尚未載入時的保底：仍以前台清單呈現
      list.innerHTML = '<p class="text-center text-slate-400 text-sm py-6">回條管理載入中…</p>';
    }
    return;
  }

  if (!canView("slips")) { locked.classList.remove("hidden"); list.classList.add("hidden"); return; }
  locked.classList.add("hidden"); list.classList.remove("hidden");

  const active = SLIP_DATA.filter(s => !s.hidden);
  if (!active.length) { list.innerHTML = '<p class="text-center text-slate-400 text-sm py-6">目前沒有待繳回條。</p>'; return; }

  list.innerHTML = active.map(function(s) {
    // ── 家長端：顯示自己的繳交狀態 ──
    if (!APP_STATE.isTeacher) {
      const my = APP_STATE.session ? SUB_DATA.find(function(x) { return x.slipId === s.id && String(x.seat) === String(APP_STATE.session.seat); }) : null;
      let statusHtml = "", actionHtml = "";
      if (APP_STATE.session) {
        if (my) {
          const map = {
            pending:  ["⏳ 已回傳，等待老師審核", "bg-amber-100 text-amber-700"],
            approved: ["✅ 教師已收到",           "bg-emerald-100 text-emerald-700"],
            rejected: ["❌ 已退回：" + escapeHtml(my.reason||""), "bg-rose-100 text-rose-700"]
          };
          const st = map[my.status] || map.pending;
          statusHtml = '<span class="text-xs px-2 py-1 rounded-full ' + st[1] + '">' + st[0] + '</span>';
          if (my.status === "rejected") {
            actionHtml = '<label class="text-xs text-blue-600 underline cursor-pointer">重新上傳<input type="file" accept="image/*" capture="environment" class="hidden" onchange="triggerSlipUpload(\'' + s.id + '\', this)"></label>';
          }
        } else {
          actionHtml = '<label class="btn3d b-emerald text-xs cursor-pointer">📷 拍照／上傳<input type="file" accept="image/*" capture="environment" class="hidden" onchange="triggerSlipUpload(\'' + s.id + '\', this)"></label>';
        }
      } else {
        statusHtml = '<span class="text-xs text-slate-400">登入後可上傳</span>';
      }
      return '<div class="bg-white/60 border border-white/70 rounded-2xl p-4 flex items-center justify-between gap-3 flex-wrap shadow-sm">' +
        '<div><h3 class="font-medium text-emerald-800">' + escapeHtml(s.name || "回條") + '</h3><p class="text-xs text-slate-400">截止：' + escapeHtml(s.deadline || "—") + '</p></div>' +
        '<div class="flex items-center gap-2">' + statusHtml + actionHtml + '</div>' +
      '</div>';
    }

    // ── 教師端：內嵌繳交進度 + 縮圖審核 ──
    const subs = SUB_DATA.filter(function(x) { return x.slipId === s.id; });
    const submitted = subs.length;
    const total = APP_STATE.students.length;
    const approved = subs.filter(function(x) { return x.status === "approved"; }).length;
    const rejected = subs.filter(function(x) { return x.status === "rejected"; }).length;
    const pending  = subs.filter(function(x) { return x.status === "pending" || !x.status; }).length;

    // 縮圖牆：以學生名單為主；若名單為空則直接以實際繳交資料呈現，確保一定看得到回傳內容
    const roster = (APP_STATE.students && APP_STATE.students.length)
      ? APP_STATE.students
      : subs.map(function(x){ return { seat: x.seat, name: x.name || "" }; });
    const thumbs = roster.map(function(st) {
      const sub = subs.find(function(x) { return String(x.seat) === String(st.seat); });
      if (!sub) {
        return '<div class="slip-thumb slip-thumb-none" title="' + escapeHtml(st.seat + '號 ' + (st.name||'')) + '">' +
          '<span class="slip-thumb-seat">' + escapeHtml(String(st.seat)) + '</span>' +
        '</div>';
      }
      const imgSrc = sub.imageUrl || sub.image || "";
      const statusCls = sub.status === "approved" ? "slip-thumb-ok"
                      : sub.status === "rejected" ? "slip-thumb-rej"
                      : "slip-thumb-pending";
      const badge = sub.status === "approved" ? "✅" : sub.status === "rejected" ? "❌" : "⏳";
      return '<div class="slip-thumb ' + statusCls + '" ' +
        'onclick="slipTeacherReview(\'' + s.id + '\',\'' + escapeHtml(String(st.seat)) + '\')" ' +
        'title="' + escapeHtml(st.seat + '號 ' + (st.name||'')) + ' — 點擊審核">' +
        (imgSrc ? '<img src="' + imgSrc + '" class="slip-thumb-img" />' : '') +
        '<span class="slip-thumb-seat">' + escapeHtml(String(st.seat)) + '</span>' +
        '<span class="slip-thumb-badge">' + badge + '</span>' +
      '</div>';
    }).join("");

    // 展開區：直接並列顯示每位家長回傳的大圖 + 上傳者姓名 + 審核狀態（免進後台）
    const submittedSubs = subs.slice()
      .filter(function(x){ return x.image || x.imageUrl; })
      .sort(function(a,b){ return (Number(a.seat)||0) - (Number(b.seat)||0); });
    const gallery = submittedSubs.length
      ? submittedSubs.map(function(sub) {
          const imgSrc = sub.imageUrl || sub.image || "";
          const stCls = sub.status === "approved" ? "text-emerald-600"
                      : sub.status === "rejected" ? "text-rose-600" : "text-amber-600";
          const stTxt = sub.status === "approved" ? "✅ 已通過"
                      : sub.status === "rejected" ? "❌ 已退回" : "⏳ 待審";
          return '<div class="border border-white/70 rounded-xl overflow-hidden bg-white/70 shadow-sm">' +
            (imgSrc ? '<img src="' + imgSrc + '" class="w-full h-40 object-cover cursor-pointer" onclick="slipTeacherReview(\'' + s.id + '\',\'' + escapeHtml(String(sub.seat)) + '\')" />' : '<div class="w-full h-40 flex items-center justify-center text-slate-300 text-xs">無圖</div>') +
            '<div class="px-2 py-1.5 flex items-center justify-between gap-1">' +
              '<span class="text-xs font-medium text-slate-600 truncate">' + escapeHtml(sub.seat + '號 ' + (sub.name||'')) + '</span>' +
              '<span class="text-[11px] ' + stCls + ' shrink-0">' + stTxt + '</span>' +
            '</div>' +
          '</div>';
        }).join("")
      : '<p class="text-center text-slate-400 text-sm py-4 col-span-full">目前尚無家長回傳。</p>';

    const approveAllBtn = pending > 0
      ? '<button onclick="slipApproveAll(\'' + s.id + '\')" class="text-xs btn3d b-emerald">✅ 一鍵全通過（' + pending + '）</button>'
      : '';

    return '<div class="bg-white/60 border border-white/70 rounded-2xl p-4 space-y-3 shadow-sm">' +
      '<div class="flex items-center justify-between flex-wrap gap-2">' +
        '<div>' +
          '<h3 class="font-medium text-emerald-800">' + escapeHtml(s.name || "回條") + '</h3>' +
          '<p class="text-xs text-slate-400">截止：' + escapeHtml(s.deadline || "—") + '</p>' +
        '</div>' +
        '<div class="flex gap-2 flex-wrap items-center">' +
          approveAllBtn +
          '<button onclick="downloadSlipImagesPdf(\'' + s.id + '\')" class="text-xs text-rose-600 underline">📄 下載PDF</button>' +
          '<button onclick="downloadSlipImagesZip(\'' + s.id + '\')" class="text-xs text-indigo-600 underline">⬇️ 下載全部圖片(zip)</button>' +
          '<button onclick="exportSlip(\'' + s.id + '\')" class="text-xs text-emerald-600 underline">📋 匯出清單</button>' +
        '</div>' +
      '</div>' +
      '<div class="flex gap-3 text-xs text-slate-500">' +
        '<span>已繳 <b class="text-emerald-700">' + submitted + '</b>/' + total + '</span>' +
        '<span>通過 <b class="text-emerald-600">' + approved + '</b></span>' +
        '<span>待審 <b class="text-amber-600">' + pending + '</b></span>' +
        '<span>退回 <b class="text-rose-600">' + rejected + '</b></span>' +
      '</div>' +
      '<details class="ann-details" open>' +
        '<summary class="cursor-pointer text-xs font-medium text-emerald-700 select-none py-1">📂 家長回傳內容（' + submittedSubs.length + '）— 點圖可放大並審核</summary>' +
        '<div class="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2">' + gallery + '</div>' +
      '</details>' +
      '<details class="ann-details">' +
        '<summary class="cursor-pointer text-xs font-medium text-slate-500 select-none py-1">🔢 依座號縮圖牆（含未繳）</summary>' +
        '<div class="slip-thumbs-wrap pt-2">' + thumbs + '</div>' +
        '<p class="text-[11px] text-slate-400">灰=未繳　黃=待審　綠=通過　紅=退回</p>' +
      '</details>' +
    '</div>';
  }).join("");
}

/* ── 教師端前台審核（點縮圖後） ── */
window.slipTeacherReview = function(slipId, seat) {
  const sub = SUB_DATA.find(function(x) { return x.slipId === slipId && String(x.seat) === String(seat); });
  if (!sub) { toast("座號 " + seat + " 尚未繳交", "info"); return; }
  const imgSrc = sub.imageUrl || sub.image || "";
  showModal(
    '<div class="p-5 space-y-3">' +
      '<div class="flex items-center justify-between">' +
        '<h3 class="font-bold">審核：' + escapeHtml(seat) + '號 ' + escapeHtml(sub.name||"") + '</h3>' +
        '<button onclick="closeModal()" class="text-slate-400 text-xl">×</button>' +
      '</div>' +
      (imgSrc ? '<img src="' + imgSrc + '" class="w-full rounded-xl border max-h-80 object-contain bg-slate-50" />' : '<p class="text-slate-400 text-sm">（無圖片）</p>') +
      '<div class="flex gap-2">' +
        '<button id="slipAppr" class="btn3d b-emerald flex-1">✅ 審核通過</button>' +
        '<button id="slipRej" class="btn3d b-rose flex-1">❌ 退回</button>' +
      '</div>' +
    '</div>', { size: "max-w-md" }
  );
  document.getElementById("slipAppr").onclick = async function() {
    await db.collection("slipSubmissions").doc(sub.id).update({ status: "approved", reason: "" });
    toast("已通過", "success"); closeModal();
  };
  document.getElementById("slipRej").onclick = function() {
    showModal(
      '<div class="p-5 space-y-3">' +
        '<h3 class="font-bold">退回原因</h3>' +
        '<input id="rejReason2" class="w-full border rounded-xl px-3 py-2 text-sm" placeholder="如：照片模糊，請重拍" />' +
        '<div class="flex justify-end gap-2">' +
          '<button onclick="closeModal()" class="px-4 py-2 rounded-xl bg-slate-100 text-sm">取消</button>' +
          '<button id="rejOk2" class="btn3d b-rose text-sm">確定退回</button>' +
        '</div>' +
      '</div>', { size: "max-w-sm" }
    );
    document.getElementById("rejOk2").onclick = async function() {
      await db.collection("slipSubmissions").doc(sub.id).update({ status: "rejected", reason: document.getElementById("rejReason2").value.trim() });
      toast("已退回", "info"); closeModal();
    };
  };
};

/* ── 一鍵全通過：把此回條所有「已繳交」的回傳都設為通過 ── */
window.slipApproveAll = async function(slipId) {
  const slip = SLIP_DATA.find(function(s) { return s.id === slipId; });
  // 所有已繳交（有圖片）且尚未通過的繳交
  const targets = SUB_DATA.filter(function(x) {
    return x.slipId === slipId && (x.image || x.imageUrl) && x.status !== "approved";
  });
  if (!targets.length) { toast("沒有需要通過的繳交", "info"); return; }
  const slipName = slip ? (slip.name || "回條") : "回條";
  const ok = await confirmDialog(
    "一鍵全通過",
    "確定把「" + slipName + "」中所有已繳交的 " + targets.length + " 份回傳全部設為「通過」？",
    { okText: "全部通過" }
  );
  if (!ok) return;
  toast("審核中…", "info");
  try {
    let done = 0;
    for (const sub of targets) {
      await db.collection("slipSubmissions").doc(sub.id).update({ status: "approved", reason: "" });
      done++;
    }
    toast("已全部通過（" + done + " 份）", "success");
  } catch (e) {
    toast("操作失敗：" + e.message, "error");
  }
};

/* ── 選完檔案後執行上傳 ── */
window.triggerSlipUpload = function(slipId, input) {
  if (!APP_STATE.session) { toast("請先登入", "warn"); return; }
  const file = input.files[0];
  if (!file) return;
  input.value = "";
  toast("圖片處理中…", "info");
  compressImage(file).then(function(base64) {
    _saveSlipSub(slipId, { imageUrl: "", image: base64 });
  }).catch(function(e) { toast("上傳失敗：" + e.message, "error"); });
};

async function _saveSlipSub(slipId, imgData) {
  try {
    toast("回傳中…", "info");
    const docId = slipId + "_" + APP_STATE.session.seat;
    await db.collection("slipSubmissions").doc(docId).set({
      slipId,
      seat: APP_STATE.session.seat,
      name: APP_STATE.session.name || "",
      image:    imgData.image    || "",
      imageUrl: imgData.imageUrl || "",
      status: "pending",
      reason: "",
      submittedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    toast("已回傳，等待老師審核", "success");
  } catch (e) {
    toast("上傳失敗：" + e.message, "error");
  }
}

/* ── 一鍵下載所有圖片（ZIP）── */
window.downloadSlipImagesZip = async function(slipId) {
  const slip = SLIP_DATA.find(function(s) { return s.id === slipId; });
  const subs = SUB_DATA.filter(function(x) { return x.slipId === slipId && (x.image || x.imageUrl); });
  if (!subs.length) { toast("此回條尚無圖片", "warn"); return; }
  if (typeof JSZip === "undefined") { toast("JSZip 未載入，無法打包", "error"); return; }

  toast("打包中，請稍候…", "info");
  const zip = new JSZip();
  const slipName = slip ? (slip.name || "回條") : "回條";

  for (const sub of subs) {
    const filename = slipName + "_" + sub.seat + "號.jpg";
    try {
      const src = sub.imageUrl || sub.image;
      const res = await fetch(src);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const blob = await res.blob();
      zip.file(filename, blob);
    } catch(e) {
      zip.file(slipName + "_" + sub.seat + "號_請手動下載.txt",
        "圖片網址：" + (sub.imageUrl || "") + "\n（請複製網址手動開啟）");
    }
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = slipName + "_所有圖片.zip";
  a.click();
  setTimeout(function() { URL.revokeObjectURL(a.href); }, 5000);
  toast("ZIP 已下載", "success");
};

/* ── 一鍵下載所有回傳圖片（PDF，一張一頁，每頁標示上傳者姓名）── */
function _loadJsPdf() {
  return new Promise(function(resolve, reject) {
    if (window.jspdf && window.jspdf.jsPDF) { resolve(); return; }
    var s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    s.onload = function() { resolve(); };
    s.onerror = function() { reject(new Error("jsPDF 載入失敗，請檢查網路")); };
    document.head.appendChild(s);
  });
}

// 讀入圖片來源，回傳 { dataUrl, w, h }
function _loadImageData(src) {
  return new Promise(function(resolve, reject) {
    var img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = function() {
      try {
        var canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        canvas.getContext("2d").drawImage(img, 0, 0);
        resolve({ dataUrl: canvas.toDataURL("image/jpeg", 0.9), w: canvas.width, h: canvas.height });
      } catch (e) {
        // 圖床圖片若無 CORS 而污染畫布，退而求其次直接用原 src（base64 一定可行）
        if (/^data:/.test(src)) reject(e);
        else resolve({ dataUrl: src, w: img.naturalWidth || 800, h: img.naturalHeight || 1000 });
      }
    };
    img.onerror = function() { reject(new Error("圖片載入失敗")); };
    img.src = src;
  });
}

window.downloadSlipImagesPdf = async function(slipId) {
  const slip = SLIP_DATA.find(function(s) { return s.id === slipId; });
  const subs = SUB_DATA
    .filter(function(x) { return x.slipId === slipId && (x.image || x.imageUrl); })
    .sort(function(a, b) { return (Number(a.seat) || 0) - (Number(b.seat) || 0); });
  if (!subs.length) { toast("此回條尚無圖片", "warn"); return; }

  toast("PDF 產生中，請稍候…", "info");
  try {
    await _loadJsPdf();
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 12;
    const headerH = 12;            // 頁首姓名區高度
    const slipName = slip ? (slip.name || "回條") : "回條";

    let added = 0;
    for (let i = 0; i < subs.length; i++) {
      const sub = subs[i];
      const who = (sub.seat != null ? sub.seat + "號 " : "") + (sub.name || "");
      const src = sub.imageUrl || sub.image;
      let imgData;
      try { imgData = await _loadImageData(src); }
      catch (e) { continue; }       // 單張失敗則略過

      if (added > 0) pdf.addPage();
      added++;

      // 頁首：回條名稱 + 上傳者姓名
      // jsPDF 內建字型不支援中文 → 改以圖片方式繪製頁首文字，確保姓名正確顯示
      _drawHeaderText(pdf, slipName + "　" + who, pageW, margin, headerH);

      // 圖片置中縮放至頁面可用區
      const availW = pageW - margin * 2;
      const availH = pageH - margin * 2 - headerH;
      let drawW = availW;
      let drawH = (imgData.h / imgData.w) * drawW;
      if (drawH > availH) { drawH = availH; drawW = (imgData.w / imgData.h) * drawH; }
      const x = (pageW - drawW) / 2;
      const y = margin + headerH + (availH - drawH) / 2;
      pdf.addImage(imgData.dataUrl, "JPEG", x, y, drawW, drawH);
    }

    if (!added) { toast("所有圖片都無法載入，PDF 產生失敗", "error"); return; }
    pdf.save(slipName + "_回傳圖片.pdf");
    toast("PDF 已下載（共 " + added + " 頁）", "success");
  } catch (e) {
    toast("PDF 產生失敗：" + e.message, "error");
  }
};

// 以 canvas 繪製中文頁首文字後當作圖片貼到 PDF（jsPDF 內建字型無中文）
function _drawHeaderText(pdf, text, pageW, margin, headerH) {
  const scale = 4;                          // 高解析度避免模糊
  const canvas = document.createElement("canvas");
  const cw = Math.round((pageW - margin * 2) * 3.78); // mm→px (約 96dpi)
  const ch = Math.round(headerH * 3.78);
  canvas.width = cw * scale; canvas.height = ch * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 22px 'Microsoft JhengHei','PingFang TC','Heiti TC',sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 4, ch / 2);
  pdf.addImage(canvas.toDataURL("image/png"), "PNG", margin, margin, pageW - margin * 2, headerH);
}

/* 後台 adminSlips 別名 */
window.downloadSlipImages = window.downloadSlipImagesZip;

/* 舊介面相容 */
async function uploadSlip(slipId, input) {
  if (!APP_STATE.session) { toast("請先登入", "warn"); return; }
  const file = input.files[0]; if (!file) return;
  toast("圖片處理中…", "info");
  try {
    const base64 = await compressImage(file);
    await _saveSlipSub(slipId, { image: base64, imageUrl: "" });
  } catch (e) { toast("上傳失敗：" + e.message, "error"); }
  input.value = "";
}
