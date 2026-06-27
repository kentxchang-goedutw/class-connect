/* ══════════════════════════════════════════════════════════════════
   90-imghost.js  免費圖床上傳模組
   支援：imgbb / freeimage.host / SM.MS
   ※ Catbox / 0x0.st 因 CORS 限制（不允許 file:// 或跨域請求），已移除。
      若需使用請將系統部署到 https:// 伺服器後再嘗試。

   對外 API：
     ImgHost.showPicker(file, onSuccess)
       → 顯示圖床選擇 UI，上傳成功後回呼 onSuccess({mode, url|data})
     ImgHost.upload(hostId, file)
       → Promise<url string>
     ImgHost.HOSTS  → 圖床清單
     ImgHost.LS_KEY → localStorage 鍵（記住上次選擇）
══════════════════════════════════════════════════════════════════ */

(function(global) {
  "use strict";

  var LS_KEY = "ptHubImgHost"; // 記住上次選用的圖床

  /* ── 圖床定義（僅保留支援 CORS 的圖床） ── */
  var HOSTS = [
    {
      id: "imgbb",
      name: "imgbb",
      note: "免費穩定、支援 CORS，需免費 API Key（api.imgbb.com 申請）",
      icon: "🖼️",
      needKey: true,
      lsKey: "ptHubImgbbKey",
      upload: function(file, key) {
        var fd = new FormData();
        fd.append("image", file);
        fd.append("key", key);
        return fetch("https://api.imgbb.com/1/upload", { method: "POST", body: fd })
          .then(function(r) { return r.json(); })
          .then(function(j) {
            if (j.success) return j.data.url;
            throw new Error(j.error && j.error.message ? j.error.message : "imgbb 上傳失敗");
          });
      }
    },
    {
      id: "freeimage",
      name: "freeimage.host",
      note: "免費、支援 CORS，無需帳號，永久儲存",
      icon: "🌅",
      needKey: false,
      upload: function(file) {
        var fd = new FormData();
        fd.append("source", file);
        fd.append("type", "file");
        fd.append("action", "upload");
        return fetch("https://freeimage.host/api/1/upload?key=6d207e02198a847aa98d0a2a901485a5", {
          method: "POST", body: fd
        })
          .then(function(r) { return r.json(); })
          .then(function(j) {
            if (j.status_code === 200 && j.image && j.image.url) return j.image.url;
            throw new Error(j.status_txt || "freeimage.host 上傳失敗");
          });
      }
    },
    {
      id: "smms",
      name: "SM.MS",
      note: "免費、支援 CORS，可選填 API Token（smms.app 申請）",
      icon: "📸",
      needKey: false,
      lsKey: "ptHubSmmsKey",
      upload: function(file, key) {
        var fd = new FormData();
        fd.append("smfile", file);
        var headers = {};
        if (key) headers["Authorization"] = key;
        return fetch("https://sm.ms/api/v2/upload", { method: "POST", headers: headers, body: fd })
          .then(function(r) { return r.json(); })
          .then(function(j) {
            if (j.success) return j.data.url;
            if (j.images) return j.images; // 圖片已存在
            throw new Error(j.message || "SM.MS 上傳失敗");
          });
      }
    }
  ];

  /* ── 取得 API Key（若需要） ── */
  function getKey(host) {
    if (!host.lsKey) return "";
    return localStorage.getItem(host.lsKey) || "";
  }
  function saveKey(host, val) {
    if (host.lsKey) localStorage.setItem(host.lsKey, val.trim());
  }

  /* ── 上傳到指定圖床 ── */
  function upload(hostId, file) {
    var host = HOSTS.find(function(h) { return h.id === hostId; });
    if (!host) return Promise.reject(new Error("未知圖床：" + hostId));
    var key = getKey(host);
    if (host.needKey && !key) return Promise.reject(new Error(host.name + " 需要 API Key，請先填入"));
    return host.upload(file, key);
  }

  /* ── 顯示圖床選擇 UI ── */
  function showPicker(file, onSuccess) {
    // 讓 lastHost 可被閉包內修改
    var lastHost = localStorage.getItem(LS_KEY) || "freeimage";

    function buildUI() {
      var rows = HOSTS.map(function(h) {
        var key = getKey(h);
        var keyInput = (h.lsKey)
          ? '<input type="text" placeholder="' + (h.needKey ? "必填 API Key" : "選填 API Token") + '" value="' +
            (typeof escapeHtml === "function" ? escapeHtml(key) : key.replace(/"/g, "&quot;")) + '" ' +
            'class="imghost-key-input border rounded-lg px-2 py-1 text-xs flex-1 min-w-0" data-host="' + h.id + '" />'
          : "";
        var sel = lastHost === h.id ? " imghost-selected" : "";
        return '<div class="imghost-row' + sel + '" data-id="' + h.id + '" onclick="ImgHost._select(this)">' +
          '<div class="flex items-center gap-2 min-w-0">' +
            '<span class="text-lg shrink-0">' + h.icon + '</span>' +
            '<div class="min-w-0">' +
              '<div class="font-bold text-sm">' + h.name + '</div>' +
              '<div class="text-xs text-slate-400 truncate">' + h.note + '</div>' +
            '</div>' +
          '</div>' +
          (keyInput ? '<div class="flex items-center gap-1 mt-1.5" onclick="event.stopPropagation()">' + keyInput +
            '<button onclick="ImgHost._saveKey(\'' + h.id + '\',this.previousElementSibling)" class="text-xs text-indigo-600 underline whitespace-nowrap">儲存</button>' +
          '</div>' : '') +
        '</div>';
      }).join("");

      return '<div class="p-5 space-y-4">' +
        '<div class="flex items-center justify-between">' +
          '<h3 class="font-bold text-base">📤 選擇圖片上傳方式</h3>' +
          '<button onclick="closeModal()" class="text-slate-400 hover:text-slate-600 text-xl">×</button>' +
        '</div>' +
        '<p class="text-xs text-slate-500">圖床模式：圖片上傳到免費圖床（省資料庫空間）。若上傳失敗請改選其他圖床，或選「存資料庫」。</p>' +
        '<div class="space-y-2" id="imghostList">' + rows + '</div>' +
        '<div class="grid grid-cols-2 gap-2 pt-1">' +
          '<button onclick="ImgHost._doUpload()" id="imghostUpBtn" class="btn3d b-indigo text-sm">⬆️ 上傳到圖床</button>' +
          '<button onclick="ImgHost._doDb()" class="btn3d b-slate text-sm">💾 存資料庫</button>' +
        '</div>' +
        '<p class="text-[11px] text-slate-400 text-center">資料庫模式：圖片以 base64 存入，較佔空間但最穩定。</p>' +
      '</div>';
    }

    ImgHost._pendingFile = file;
    ImgHost._onSuccess = onSuccess;
    ImgHost._lastHost = lastHost;

    if (typeof showModal === "function") showModal(buildUI(), { size: "max-w-sm" });
  }

  /* ── 內部：點選圖床列 ── */
  function _select(el) {
    document.querySelectorAll(".imghost-row").forEach(function(r) { r.classList.remove("imghost-selected"); });
    el.classList.add("imghost-selected");
    ImgHost._lastHost = el.dataset.id;
    localStorage.setItem(LS_KEY, el.dataset.id);
  }

  function _saveKey(hostId, inputEl) {
    var host = HOSTS.find(function(h) { return h.id === hostId; });
    if (!host || !host.lsKey) return;
    saveKey(host, inputEl.value);
    if (typeof toast === "function") toast("已儲存 " + host.name + " Key", "success");
  }

  function _doUpload() {
    var sel = document.querySelector(".imghost-selected");
    var hostId = sel ? sel.dataset.id : (ImgHost._lastHost || "freeimage");
    var file = ImgHost._pendingFile;
    if (!file) return;
    var btn = document.getElementById("imghostUpBtn");
    if (btn) { btn.disabled = true; btn.textContent = "上傳中…"; }

    // 若有輸入框先儲存 key
    var keyInput = sel ? sel.querySelector(".imghost-key-input") : null;
    if (keyInput) {
      var host = HOSTS.find(function(h) { return h.id === hostId; });
      if (host) saveKey(host, keyInput.value);
    }

    upload(hostId, file)
      .then(function(url) {
        if (typeof closeModal === "function") closeModal();
        if (typeof ImgHost._onSuccess === "function") ImgHost._onSuccess({ mode: "url", url: url });
      })
      .catch(function(err) {
        if (btn) { btn.disabled = false; btn.textContent = "⬆️ 上傳到圖床"; }
        if (typeof toast === "function") toast("上傳失敗：" + err.message + "（可換其他圖床再試，或改存資料庫）", "error");
      });
  }

  function _doDb() {
    var file = ImgHost._pendingFile;
    if (!file) return;
    if (typeof closeModal === "function") closeModal();
    if (typeof toast === "function") toast("圖片壓縮中…", "info");
    (typeof compressImage === "function" ? compressImage(file) : Promise.reject(new Error("compressImage 未定義")))
      .then(function(base64) {
        if (typeof ImgHost._onSuccess === "function") ImgHost._onSuccess({ mode: "base64", data: base64 });
      })
      .catch(function(err) {
        if (typeof toast === "function") toast("壓縮失敗：" + err.message, "error");
      });
  }

  /* ── 公開 API ── */
  global.ImgHost = {
    HOSTS: HOSTS,
    LS_KEY: LS_KEY,
    upload: upload,
    showPicker: showPicker,
    _select: _select,
    _saveKey: _saveKey,
    _doUpload: _doUpload,
    _doDb: _doDb,
    _pendingFile: null,
    _onSuccess: null,
    _lastHost: localStorage.getItem(LS_KEY) || "freeimage"
  };

})(window);
