/* ════════════════════════════════════════════════════════════════════
   00-local-db.js  純本地模式 — LocalStorage 虛擬資料庫層
   ────────────────────────────────────────────────────────────────────
   提供與 Firebase Firestore (v8 compat) 相容的 API shim，讓其餘模組
   （contactbook、homework、announcements、students … 等）完全不需改動，
   即可在不連線 Firebase 的情況下，以 localStorage 儲存所有資料。

   支援多班級：每個班級的資料以不同 prefix 隔離：
     LOCAL_ldb_{classId}_{collection}_{docId}  ← 文件
     LOCAL_ldb_{classId}_{collection}/__docs__  ← 集合文件清單（index）

   對外 API（掛載在 window.LocalDB）：
     LocalDB.init(classId)     切換到指定班級（或初次建立）
     LocalDB.getShimDb()       回傳與 Firestore db 相容的物件
   ════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  /* ── 當前班級 prefix ── */
  var _prefix = "";  // "LOCAL_ldb_{classId}_"

  function setClass(classId) {
    _prefix = "LOCAL_ldb_" + classId + "_";
  }

  /* ════════ 低階 LocalStorage 存取 ════════ */
  function lsKey(col, docId) { return _prefix + col + "/" + docId; }
  function lsIndexKey(col)   { return _prefix + col + "/__index__"; }

  function lsGet(col, docId) {
    try { return JSON.parse(localStorage.getItem(lsKey(col, docId)) || "null"); } catch(e) { return null; }
  }
  function lsSet(col, docId, data) {
    localStorage.setItem(lsKey(col, docId), JSON.stringify(data));
    // 維護 index
    var idx = lsIndex(col);
    if (!idx.includes(docId)) { idx.push(docId); localStorage.setItem(lsIndexKey(col), JSON.stringify(idx)); }
  }
  function lsDel(col, docId) {
    localStorage.removeItem(lsKey(col, docId));
    var idx = lsIndex(col).filter(function(id){ return id !== docId; });
    localStorage.setItem(lsIndexKey(col), JSON.stringify(idx));
  }
  function lsIndex(col) {
    try { return JSON.parse(localStorage.getItem(lsIndexKey(col)) || "[]"); } catch(e) { return []; }
  }

  /* ── 自動遞增 ID（用來模擬 Firestore auto-id） ── */
  function autoId() { return "_" + Math.random().toString(36).slice(2,9) + Date.now().toString(36); }

  /* ── 偽 serverTimestamp（存入真實 Date，讀出包裝成可呼叫 .toDate() 的物件） ── */
  function fakeTimestamp(d) {
    var ms = (d instanceof Date) ? d.getTime() : (typeof d === "number" ? d : Date.now());
    return { _t: ms, toDate: function(){ return new Date(this._t); }, seconds: Math.floor(ms/1000) };
  }

  /* ── onSnapshot 觀察者管理 ── */
  var _listeners = {};   // key → [callback, ...]
  function _notifyListeners(key) {
    (_listeners[key] || []).forEach(function(cb){ try { cb(); } catch(e){} });
  }
  function _addListener(key, cb) {
    if (!_listeners[key]) _listeners[key] = [];
    _listeners[key].push(cb);
    return function unsubscribe() {
      _listeners[key] = (_listeners[key] || []).filter(function(f){ return f !== cb; });
    };
  }
  function _colKey(col) { return _prefix + col; }  // 集合級 key

  /* ════════════════════════════════════════════════════════════
     DocumentReference shim
  ════════════════════════════════════════════════════════════ */
  function DocRef(col, docId) {
    this._col = col;
    this._id  = docId;
    this.id   = docId;
  }

  DocRef.prototype.get = function() {
    var self = this;
    return Promise.resolve(_makeDocSnap(self._col, self._id));
  };

  DocRef.prototype.set = function(data, opts) {
    var self = this;
    var existing = lsGet(self._col, self._id) || {};
    var resolved = _resolveSpecialValues(data, existing);   // increment 等以舊值為基準解析
    var merged = (opts && opts.merge) ? _deepMerge(existing, resolved) : resolved;
    lsSet(self._col, self._id, merged);
    _notifyListeners(lsKey(self._col, self._id));
    _notifyListeners(_colKey(self._col));
    return Promise.resolve();
  };

  DocRef.prototype.update = function(data) {
    var self = this;
    var existing = lsGet(self._col, self._id) || {};
    var merged = _deepMerge(existing, _resolveSpecialValues(data, existing));
    lsSet(self._col, self._id, merged);
    _notifyListeners(lsKey(self._col, self._id));
    _notifyListeners(_colKey(self._col));
    return Promise.resolve();
  };

  DocRef.prototype.delete = function() {
    var self = this;
    lsDel(self._col, self._id);
    _notifyListeners(lsKey(self._col, self._id));
    _notifyListeners(_colKey(self._col));
    return Promise.resolve();
  };

  DocRef.prototype.onSnapshot = function(cb, errCb) {
    var self = this;
    var key = lsKey(self._col, self._id);
    var fire = function(){ try{ cb(_makeDocSnap(self._col, self._id)); }catch(e){ if(errCb) errCb(e); } };
    fire(); // 立即呼叫一次
    return _addListener(key, fire);
  };

  DocRef.prototype.collection = function(subCol) {
    return new ColRef(this._col + "/" + this._id + "/" + subCol);
  };

  /* ════════════════════════════════════════════════════════════
     CollectionReference / Query shim
  ════════════════════════════════════════════════════════════ */
  function ColRef(col, _filters, _orders, _lim) {
    this._col     = col;
    this._filters = _filters || [];  // [{field, op, val}]
    this._orders  = _orders  || [];  // [{field, dir}]
    this._lim     = _lim     || null;
  }

  ColRef.prototype.doc = function(id) {
    return new DocRef(this._col, id !== undefined ? String(id) : autoId());
  };

  ColRef.prototype.add = function(data) {
    var id = autoId();
    var ref = new DocRef(this._col, id);
    return ref.set(data).then(function(){ return ref; });
  };

  ColRef.prototype.where = function(field, op, val) {
    return new ColRef(this._col, this._filters.concat([{field:field,op:op,val:val}]), this._orders, this._lim);
  };

  ColRef.prototype.orderBy = function(field, dir) {
    return new ColRef(this._col, this._filters, this._orders.concat([{field:field,dir:dir||"asc"}]), this._lim);
  };

  ColRef.prototype.limit = function(n) {
    return new ColRef(this._col, this._filters, this._orders, n);
  };

  ColRef.prototype.get = function() {
    var self = this;
    return Promise.resolve(_makeQuerySnap(self._col, self._filters, self._orders, self._lim));
  };

  ColRef.prototype.onSnapshot = function(cb, errCb) {
    var self = this;
    var key = _colKey(self._col);
    var fire = function(){
      try{ cb(_makeQuerySnap(self._col, self._filters, self._orders, self._lim)); }
      catch(e){ if(errCb) errCb(e); }
    };
    fire();
    return _addListener(key, fire);
  };

  /* ════════════════════════════════════════════════════════════
     Snapshot 建構
  ════════════════════════════════════════════════════════════ */
  function _makeDocSnap(col, docId) {
    var data = lsGet(col, docId);
    return {
      exists: data !== null,
      id: docId,
      ref: new DocRef(col, docId),
      data: function(){ return data ? JSON.parse(JSON.stringify(data)) : undefined; }
    };
  }

  function _makeQuerySnap(col, filters, orders, lim) {
    var ids = lsIndex(col);
    var docs = ids.map(function(id){
      var data = lsGet(col, id);
      return data !== null ? { id: id, data: data } : null;
    }).filter(Boolean);

    // where 過濾
    filters.forEach(function(f) {
      docs = docs.filter(function(d){
        var v = _getField(d.data, f.field);
        if (f.op === "==" || f.op === "===") return v === f.val;
        if (f.op === "!=" || f.op === "!==") return v !== f.val;
        if (f.op === "<")  return v < f.val;
        if (f.op === "<=") return v <= f.val;
        if (f.op === ">")  return v > f.val;
        if (f.op === ">=") return v >= f.val;
        if (f.op === "array-contains") return Array.isArray(v) && v.includes(f.val);
        return true;
      });
    });

    // orderBy
    orders.forEach(function(o) {
      docs.sort(function(a, b){
        var av = _getField(a.data, o.field), bv = _getField(b.data, o.field);
        // 處理 timestamp 物件
        if (av && av._t) av = av._t;
        if (bv && bv._t) bv = bv._t;
        // 處理 document ID 排序（FieldPath.documentId() 時 field 為 "__id__"）
        if (o.field === "__id__") { av = a.id; bv = b.id; }
        if (av < bv) return o.dir === "desc" ? 1 : -1;
        if (av > bv) return o.dir === "desc" ? -1 : 1;
        return 0;
      });
    });

    if (lim) docs = docs.slice(0, lim);

    var snapDocs = docs.map(function(d){
      return {
        id: d.id,
        exists: true,
        ref: new DocRef(col, d.id),
        data: function(){ return JSON.parse(JSON.stringify(d.data)); }
      };
    });

    return {
      docs: snapDocs,
      empty: snapDocs.length === 0,
      size: snapDocs.length,
      forEach: function(cb){ snapDocs.forEach(cb); }
    };
  }

  /* ── 欄位路徑取值（支援 a.b.c） ── */
  function _getField(obj, path) {
    if (!path || !obj) return undefined;
    return path.split(".").reduce(function(o, k){ return o && o[k] !== undefined ? o[k] : undefined; }, obj);
  }

  /* ── 深度合併（merge: true） ── */
  function _deepMerge(target, source) {
    var out = Object.assign({}, target);
    Object.keys(source).forEach(function(k){
      if (source[k] !== null && typeof source[k] === "object" && !Array.isArray(source[k]) && !(source[k]._t)) {
        out[k] = _deepMerge(typeof out[k] === "object" ? out[k] : {}, source[k]);
      } else {
        out[k] = source[k];
      }
    });
    return out;
  }

  /* ── 解析特殊值（serverTimestamp / FieldValue.increment / arrayUnion 等） ──
     prev 為「現有資料中對應位置的舊值」，用來正確處理 increment / arrayUnion / arrayRemove */
  function _resolveSpecialValues(data, prev) {
    if (!data || typeof data !== "object") return data;
    if (data._isFieldValue) {
      if (data._type === "serverTimestamp") return fakeTimestamp(new Date());
      if (data._type === "increment") {
        var base = Number(prev);
        if (!isFinite(base)) base = 0;
        var add = Number(data._n);
        if (!isFinite(add)) add = 0;
        return base + add;   // 累加到舊值（雲端 increment 行為）
      }
      if (data._type === "arrayUnion") {
        var arr = Array.isArray(prev) ? prev.slice() : [];
        (data._elements || []).forEach(function(el){ if (arr.indexOf(el) < 0) arr.push(el); });
        return arr;
      }
      if (data._type === "arrayRemove") {
        var arr2 = Array.isArray(prev) ? prev.slice() : [];
        return arr2.filter(function(el){ return (data._elements || []).indexOf(el) < 0; });
      }
      if (data._type === "delete") return undefined;
      return data;
    }
    var out = Array.isArray(data) ? [] : {};
    Object.keys(data).forEach(function(k){
      var prevChild = (prev && typeof prev === "object") ? prev[k] : undefined;
      var v = _resolveSpecialValues(data[k], prevChild);
      if (v !== undefined) out[k] = v;
    });
    return out;
  }

  /* ════════════════════════════════════════════════════════════
     shimDb — 對外暴露，模擬 firebase.firestore() 的 db 物件
  ════════════════════════════════════════════════════════════ */
  /* ════════════════════════════════════════════════════════════
     WriteBatch 相容（db.batch()）
  ════════════════════════════════════════════════════════════ */
  function WriteBatch() {
    this._ops = [];
  }
  WriteBatch.prototype.set = function(docRef, data, opts) {
    this._ops.push({ type: "set", ref: docRef, data: data, opts: opts || {} });
    return this;
  };
  WriteBatch.prototype.update = function(docRef, data) {
    this._ops.push({ type: "update", ref: docRef, data: data });
    return this;
  };
  WriteBatch.prototype.delete = function(docRef) {
    this._ops.push({ type: "delete", ref: docRef });
    return this;
  };
  WriteBatch.prototype.commit = function() {
    var ops = this._ops;
    return new Promise(function(resolve, reject) {
      try {
        ops.forEach(function(op) {
          if (op.type === "set")    op.ref.set(op.data, op.opts);
          else if (op.type === "update") op.ref.update(op.data);
          else if (op.type === "delete") op.ref.delete();
        });
        resolve();
      } catch(e) { reject(e); }
    });
  };

  var shimDb = {
    collection: function(col) { return new ColRef(col); },
    batch: function() { return new WriteBatch(); },
    /* Firestore.FieldValue 相容 */
    _fieldValue: {
      serverTimestamp: function(){ return { _isFieldValue:true, _type:"serverTimestamp" }; },
      arrayUnion:  function(){ var els=[].slice.call(arguments); return { _isFieldValue:true,_type:"arrayUnion",_elements:els }; },
      arrayRemove: function(){ var els=[].slice.call(arguments); return { _isFieldValue:true,_type:"arrayRemove",_elements:els }; },
      increment:   function(n){ return { _isFieldValue:true,_type:"increment",_n:n }; },
      delete:      function(){  return { _isFieldValue:true,_type:"delete" }; }
    }
  };

  /* ════════════════════════════════════════════════════════════
     FieldPath 相容（documentId()）
  ════════════════════════════════════════════════════════════ */
  shimDb.FieldPath = {
    documentId: function(){ return "__id__"; }
  };

  /* ════════════════════════════════════════════════════════════
     多班級管理
  ════════════════════════════════════════════════════════════ */
  var LS_CLASSES = "LOCAL_classes";     // 班級清單
  var LS_ACTIVE  = "LOCAL_activeClass"; // 目前使用班級 id

  function getClasses() {
    try { return JSON.parse(localStorage.getItem(LS_CLASSES) || "[]"); } catch(e){ return []; }
  }
  function saveClasses(list) { localStorage.setItem(LS_CLASSES, JSON.stringify(list)); }

  function createClass(name) {
    var id = "cls_" + Date.now().toString(36);
    var list = getClasses();
    list.push({ id: id, name: name, createdAt: Date.now() });
    saveClasses(list);
    return id;
  }
  function deleteClass(id) {
    // 刪除所有 key
    var keys = Object.keys(localStorage).filter(function(k){ return k.startsWith("LOCAL_ldb_" + id + "_"); });
    keys.forEach(function(k){ localStorage.removeItem(k); });
    saveClasses(getClasses().filter(function(c){ return c.id !== id; }));
  }
  function renameClass(id, name) {
    var list = getClasses().map(function(c){ return c.id === id ? Object.assign({},c,{name:name}) : c; });
    saveClasses(list);
  }
  function getActiveClassId() { return localStorage.getItem(LS_ACTIVE) || null; }
  function setActiveClass(id) { localStorage.setItem(LS_ACTIVE, id); }

  /* ════════════════════════════════════════════════════════════
     匯出 / 匯入
  ════════════════════════════════════════════════════════════ */
  function exportClass(classId) {
    var clsName = (getClasses().find(function(c){ return c.id === classId; }) || {}).name || classId;
    var prefix = "LOCAL_ldb_" + classId + "_";
    var data = { _version: 1, _classId: classId, _className: clsName, _exportedAt: Date.now(), collections: {} };
    Object.keys(localStorage).forEach(function(k){
      if (!k.startsWith(prefix)) return;
      var rel = k.slice(prefix.length); // e.g. "students/__index__" or "students/abc123"
      var parts = rel.split("/");
      var col = parts[0], docId = parts.slice(1).join("/");
      if (!data.collections[col]) data.collections[col] = {};
      try { data.collections[col][docId] = JSON.parse(localStorage.getItem(k)); } catch(e){}
    });
    return data;
  }

  function importClass(jsonData) {
    if (!jsonData || jsonData._version !== 1 || !jsonData._classId) throw new Error("格式錯誤");
    var classId = jsonData._classId;
    var list = getClasses();
    // 若不存在則加入
    if (!list.find(function(c){ return c.id === classId; })) {
      list.push({ id: classId, name: jsonData._className || classId, createdAt: Date.now() });
      saveClasses(list);
    }
    var prefix = "LOCAL_ldb_" + classId + "_";
    var cols = jsonData.collections || {};
    Object.keys(cols).forEach(function(col){
      Object.keys(cols[col]).forEach(function(docId){
        localStorage.setItem(prefix + col + "/" + docId, JSON.stringify(cols[col][docId]));
      });
    });
    return classId;
  }

  /* ════════════════════════════════════════════════════════════
     對外公開 API（window.LocalDB）
  ════════════════════════════════════════════════════════════ */
  // 切換／初始化到指定班級：設定 prefix 並記為目前使用班級
  function init(classId) {
    if (classId) {
      setClass(classId);
      setActiveClass(classId);
    }
    return shimDb;
  }
  function getShimDb() { return shimDb; }

  window.LocalDB = {
    /* Firestore shim */
    db: shimDb,
    getShimDb:        getShimDb,
    init:             init,
    /* 多班級 */
    getClasses:       getClasses,
    createClass:      createClass,
    deleteClass:      deleteClass,
    renameClass:      renameClass,
    getActiveClassId: getActiveClassId,
    setActiveClass:   setActiveClass,
    /* 匯出匯入 */
    exportClass:      exportClass,
    importClass:      importClass
  };

}());
