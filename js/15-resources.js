/* ══════════════════════════════════════════════════════════════════
   15-resources.js  資源充電站（前台連結卡、後台管理）
══════════════════════════════════════════════════════════════════ */

/* ════════════════════ 模組：資源充電站 ════════════════════ */
function setupResources() {
  db.collection("resources").onSnapshot(snap => { RES_DATA = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderResources(); }, err => console.warn("資源監聽失敗", err));
}
function renderResources() {
  const locked = document.getElementById("resLocked"), list = document.getElementById("resList");
  if (!list) return;
  if (!canView("resources")) { locked.classList.remove("hidden"); list.classList.add("hidden"); return; }
  locked.classList.add("hidden"); list.classList.remove("hidden");
  if (!RES_DATA.length) { list.innerHTML = '<p class="text-center text-slate-400 text-sm py-6">尚無學習資源連結。</p>'; return; }
  const cats = [...new Set(RES_DATA.map(r => r.category || "未分類"))];
  list.innerHTML = cats.map(cat => {
    const items = RES_DATA.filter(r => (r.category || "未分類") === cat);
    return `<div>
      <div class="text-sm font-bold text-emerald-700 mb-2 flex items-center gap-1">🔖 ${escapeHtml(cat)}</div>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">${items.map(r => `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener" class="res-card">${escapeHtml(r.name || "連結")}</a>`).join("")}</div>
    </div>`;
  }).join("");
}
/* 後台：資源連結管理 */
function adminResources(body) {
  const cats = [...new Set(RES_DATA.map(r => r.category || "未分類"))];
  const list = RES_DATA.length ? cats.map(cat => {
    const items = RES_DATA.filter(r => (r.category || "未分類") === cat);
    return `<div class="space-y-1"><div class="text-xs font-bold text-emerald-700">${escapeHtml(cat)}</div>${items.map(r => `
      <div class="flex items-center justify-between border rounded-lg p-2 text-sm gap-2">
        <div class="min-w-0"><div class="font-medium truncate">${escapeHtml(r.name || "")}</div><div class="text-xs text-slate-400 truncate">${escapeHtml(r.url || "")}</div></div>
        <div class="flex gap-2 shrink-0"><button onclick="editResource('${r.id}')" class="text-blue-600 text-xs underline">編輯</button><button onclick="delResource('${r.id}')" class="text-rose-600 text-xs underline">刪除</button></div>
      </div>`).join("")}</div>`;
  }).join("") : '<p class="text-slate-400 text-sm">尚無資源</p>';
  body.innerHTML = `<div class="space-y-4"><div class="flex items-center justify-between"><h4 class="font-bold text-sm">學習資源連結（${RES_DATA.length}）</h4><button onclick="editResource()" class="btn3d b-emerald text-xs">＋ 新增連結</button></div>${list}</div>`;
}
function editResource(id, fromQuick) {
  const r = id ? RES_DATA.find(x => x.id === id) : {};
  const cats = [...new Set(RES_DATA.map(x => x.category).filter(Boolean))];
  showModal(`
    <div class="p-6 space-y-3">
      <h3 class="font-bold text-lg">${id ? "編輯" : "新增"}學習資源</h3>
      <div><label class="text-sm">資源名稱</label><input id="erName" class="w-full mt-1 border rounded-xl px-3 py-2 text-sm" value="${escapeHtml(r?.name || "")}" placeholder="例：因材網"></div>
      <div><label class="text-sm">資源網址 (URL)</label><input id="erUrl" class="w-full mt-1 border rounded-xl px-3 py-2 text-sm" value="${escapeHtml(r?.url || "")}" placeholder="https://..."></div>
      <div><label class="text-sm">分類分組</label><input id="erCat" list="erCats" class="w-full mt-1 border rounded-xl px-3 py-2 text-sm" value="${escapeHtml(r?.category || "")}" placeholder="例：常用線上平台"><datalist id="erCats">${cats.map(c => `<option value="${escapeHtml(c)}">`).join("")}</datalist></div>
      <div class="flex gap-2 justify-end pt-2">
        <button onclick="${fromQuick ? "closeModal()" : "openAdmin();adminGoTab(8)"}" class="px-4 py-2 rounded-xl bg-slate-100 text-sm">${fromQuick ? "取消" : "返回"}</button>
        <button id="erSave" class="btn3d b-emerald text-sm">儲存</button>
      </div>
    </div>`, { size: "max-w-sm", noBackdropClose: true });
  document.getElementById("erSave").onclick = async () => {
    const name = document.getElementById("erName").value.trim();
    let url = document.getElementById("erUrl").value.trim();
    const category = document.getElementById("erCat").value.trim() || "未分類";
    if (!name || !url) { toast("請填寫名稱與網址", "warn"); return; }
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    try {
      if (id) await db.collection("resources").doc(id).set({ name, url, category }, { merge: true });
      else await db.collection("resources").add({ name, url, category, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      toast("已儲存", "success");
      if (fromQuick) closeModal(); else { openAdmin(); adminGoTab(8); }
    } catch (e) { toast("儲存失敗：" + e.message, "error"); }
  };
}
async function delResource(id) {
  if (!await confirmDialog("刪除資源", "確定刪除此連結？", { okText: "刪除", danger: true })) return;
  try { await db.collection("resources").doc(id).delete(); toast("已刪除", "info"); openAdmin(); adminGoTab(8); }
  catch (e) { toast("刪除失敗：" + e.message, "error"); }
}

