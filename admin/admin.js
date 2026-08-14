const CFG_KEY = "notes-h5-cms-config";
const GATE_SESSION = "notes-h5-admin-gate";
const ADMIN_PIN_KEY = "notes-h5-admin-pin";
const DEFAULT_ADMIN_PIN = "123456";
let menu = null;
let currentId = null;
let listPage = 1;
const PAGE_SIZE = 20;
let pendingEncrypted = null; // { enc, meta } when private post not yet unlocked

function cfg() {
  return JSON.parse(localStorage.getItem(CFG_KEY) || "null");
}
function setStatus(id, msg, ok) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg || "";
  el.className = "status " + (ok === true ? "ok" : ok === false ? "err" : "");
}

function toggleFold(btn) {
  const panel = btn && btn.closest ? btn.closest(".fold-panel") : null;
  if (!panel) return;
  panel.classList.toggle("collapsed");
}

function getStoredAdminPin() {
  return localStorage.getItem(ADMIN_PIN_KEY) || DEFAULT_ADMIN_PIN;
}
function isGateOpen() {
  return sessionStorage.getItem(GATE_SESSION) === "1";
}
function openGateSession() {
  sessionStorage.setItem(GATE_SESSION, "1");
}
function closeGateSession() {
  sessionStorage.removeItem(GATE_SESSION);
}

function showOnly(viewId) {
  ["gate-view", "github-view", "app-view"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("hidden", id !== viewId);
  });
}

function submitGate() {
  const input = document.getElementById("gate-password");
  const pwd = (input && input.value) || "";
  if (pwd !== getStoredAdminPin()) {
    setStatus("gate-status", "密码错误", false);
    return;
  }
  openGateSession();
  setStatus("gate-status", "", null);
  afterGateOk();
}

function backToGate() {
  closeGateSession();
  showOnly("gate-view");
  const input = document.getElementById("gate-password");
  if (input) input.value = "";
}

function afterGateOk() {
  const c = cfg();
  if (!c || !c.token) {
    showOnly("github-view");
    if (c) {
      document.getElementById("cfg-owner").value = c.owner || "aiiw";
      document.getElementById("cfg-repo").value = c.repo || "notes-h5";
      document.getElementById("cfg-branch").value = c.branch || "main";
    }
    setStatus("login-status", "请填写 GitHub Token 后进入（只需配置一次）", null);
    return;
  }
  bootApp();
}

function logout() {
  // 只退出本次会话，保留 GitHub 配置与管理密码，避免再次进不去
  closeGateSession();
  location.reload();
}

function changeAdminPin() {
  const oldPwd = document.getElementById("admin-pin-old").value;
  const n1 = document.getElementById("admin-pin-new").value;
  const n2 = document.getElementById("admin-pin-new2").value;
  if (oldPwd !== getStoredAdminPin()) {
    setStatus("admin-pin-status", "当前密码不正确", false);
    return;
  }
  if (!n1 || n1.length < 4) {
    setStatus("admin-pin-status", "新密码至少 4 位", false);
    return;
  }
  if (n1 !== n2) {
    setStatus("admin-pin-status", "两次新密码不一致", false);
    return;
  }
  localStorage.setItem(ADMIN_PIN_KEY, n1);
  document.getElementById("admin-pin-old").value = "";
  document.getElementById("admin-pin-new").value = "";
  document.getElementById("admin-pin-new2").value = "";
  setStatus("admin-pin-status", "后台登录密码已更新（仅本机浏览器）", true);
}

function resetAdminPinToDefault() {
  if (!confirm("确认恢复初始管理密码 123456？")) return;
  localStorage.setItem(ADMIN_PIN_KEY, DEFAULT_ADMIN_PIN);
  setStatus("admin-pin-status", "已恢复为 123456", true);
}

function saveConfig() {
  if (!isGateOpen()) {
    setStatus("login-status", "请先通过管理密码登录", false);
    return;
  }
  const existing = cfg() || {};
  const tokenInput = document.getElementById("cfg-token").value.trim();
  const c = {
    owner: document.getElementById("cfg-owner").value.trim() || "aiiw",
    repo: document.getElementById("cfg-repo").value.trim() || "notes-h5",
    branch: document.getElementById("cfg-branch").value.trim() || "main",
    token: tokenInput || existing.token || "",
  };
  if (!c.owner || !c.repo || !c.token) {
    setStatus("login-status", "请填完整（Token 必填）", false);
    return;
  }
  localStorage.setItem(CFG_KEY, JSON.stringify(c));
  bootApp();
}

async function gh(path, method = "GET", body = null) {
  const c = cfg();
  const url = "https://api.github.com" + path;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: "Bearer " + c.token,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (body != null) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { method, headers, body: body == null ? null : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || res.statusText;
    throw new Error(msg);
  }
  return data;
}

function b64encode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function b64decode(str) {
  return decodeURIComponent(escape(atob(str)));
}

async function getFile(path) {
  const c = cfg();
  const data = await gh(`/repos/${c.owner}/${c.repo}/contents/${path}?ref=${encodeURIComponent(c.branch)}`);
  return { sha: data.sha, content: b64decode(data.content.replace(/\n/g, "")) };
}
async function putFile(path, content, message, sha = null) {
  const c = cfg();
  const body = { message, content: b64encode(content), branch: c.branch };
  if (sha) body.sha = sha;
  return gh(`/repos/${c.owner}/${c.repo}/contents/${path}`, "PUT", body);
}
async function deleteFile(path, sha, message) {
  const c = cfg();
  return gh(`/repos/${c.owner}/${c.repo}/contents/${path}`, "DELETE", {
    message, sha, branch: c.branch,
  });
}

async function bootApp() {
  if (!isGateOpen()) {
    showOnly("gate-view");
    return;
  }
  const c = cfg();
  if (!c || !c.token) {
    showOnly("github-view");
    setStatus("login-status", "请先配置 GitHub Token", false);
    return;
  }
  document.getElementById("cfg-owner").value = c.owner || "aiiw";
  document.getElementById("cfg-repo").value = c.repo || "notes-h5";
  document.getElementById("cfg-branch").value = c.branch || "main";
  try {
    showOnly("app-view");
    renderVault();
    refreshPwdSelect();
    await reloadAll();
    setStatus("login-status", "已连接 " + c.owner + "/" + c.repo, true);
  } catch (e) {
    showOnly("github-view");
    document.getElementById("cfg-token").value = "";
    const bad = cfg();
    if (bad) {
      delete bad.token;
      localStorage.setItem(CFG_KEY, JSON.stringify(bad));
    }
    setStatus("login-status", "GitHub 连接失败：" + e.message + "。请重新填写有效 Token（需 repo 权限）", false);
  }
}

let listCategoryFilter = "";

const DEFAULT_CATEGORIES = [
  { id: "work", name: "工作", order: 1 },
  { id: "study", name: "学习", order: 2 },
  { id: "fun", name: "娱乐", order: 3 },
];

function ensureCategories() {
  if (!menu) return;
  if (!Array.isArray(menu.categories) || !menu.categories.length) {
    menu.categories = DEFAULT_CATEGORIES.map((x) => ({ ...x }));
  }
  menu.categories = menu.categories
    .map((c, i) => ({
      id: String(c.id || "").trim() || ("cat-" + (i + 1)),
      name: String(c.name || c.id || "未命名").trim(),
      order: c.order || i + 1,
    }))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const firstId = menu.categories[0] ? menu.categories[0].id : "study";
  (menu.items || []).forEach((it) => {
    if (!it.category || !menu.categories.some((c) => c.id === it.category)) {
      it.category = firstId;
    }
  });
}

function sortedCategories() {
  ensureCategories();
  return (menu.categories || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
}

function categoryName(id) {
  const c = sortedCategories().find((x) => x.id === id);
  return c ? c.name : (id || "未分类");
}

function resolveCategoryId(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const cats = sortedCategories();
  const byId = cats.find((c) => c.id === s || c.id.toLowerCase() === s.toLowerCase());
  if (byId) return byId.id;
  const byName = cats.find((c) => c.name === s);
  if (byName) return byName.id;
  // fuzzy: 包含关系
  const fuzzy = cats.find((c) => s.includes(c.name) || c.name.includes(s));
  return fuzzy ? fuzzy.id : "";
}

function getImportDefaultCategory(selectId) {
  const el = document.getElementById(selectId);
  if (el && el.value) return el.value;
  if (listCategoryFilter) return listCategoryFilter;
  return (sortedCategories()[0] && sortedCategories()[0].id) || "study";
}

function buildMenuPayload() {
  ensureCategories();
  return {
    siteTitle: menu.siteTitle || "",
    siteIntro: menu.siteIntro || "",
    categories: sortedCategories().map((c, i) => ({
      id: c.id,
      name: c.name,
      order: c.order || i + 1,
    })),
    items: menu.items || [],
  };
}

function slugCategoryId(name) {
  const map = { 工作: "work", 学习: "study", 娱乐: "fun", 生活: "life", 技术: "tech" };
  if (map[name]) return map[name];
  let s = String(name || "")
    .toLowerCase()
    .replace(/[^\w\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!/[a-z0-9]/.test(s)) s = "cat-" + Date.now().toString(36);
  const exist = new Set((menu.categories || []).map((c) => c.id));
  let id = s.slice(0, 24);
  let n = 2;
  while (exist.has(id)) {
    id = s.slice(0, 20) + "-" + n;
    n += 1;
  }
  return id;
}

function refreshCategorySelects() {
  const cats = sortedCategories();
  const opts = cats.map((c) => `<option value="${escapeAttr(c.id)}">${escapeHtml(c.name)}</option>`).join("");
  const postSel = document.getElementById("post-category");
  if (postSel) {
    const cur = postSel.value;
    postSel.innerHTML = opts || '<option value="study">学习</option>';
    if (cur && cats.some((c) => c.id === cur)) postSel.value = cur;
  }
  const filter = document.getElementById("list-category-filter");
  if (filter) {
    const cur = listCategoryFilter;
    filter.innerHTML = '<option value="">全部栏目</option>' + opts;
    filter.value = cur || "";
  }
  document.querySelectorAll(".import-category-select").forEach((sel) => {
    const cur = sel.value;
    sel.innerHTML = '<option value="">用筛选栏/第一个栏目</option>' + opts;
    if (cur && cats.some((c) => c.id === cur)) sel.value = cur;
  });
}

function renderCategoryManager() {
  const box = document.getElementById("category-list");
  if (!box) return;
  const cats = sortedCategories();
  box.innerHTML = cats.map((c, idx) => `
    <div class="pwd-item">
      <div style="flex:1">
        <input class="cat-name" data-id="${escapeAttr(c.id)}" value="${escapeAttr(c.name)}" style="width:100%;border:1px solid var(--border);background:var(--bg);color:var(--text);border-radius:8px;padding:6px 8px;font-size:13px" />
        <div class="muted" style="margin-top:4px">${escapeHtml(c.id)} · ${(menu.items || []).filter((x) => x.category === c.id).length} 篇</div>
      </div>
      <div class="row">
        <button class="btn" type="button" onclick="moveCategory('${c.id}',-1)" ${idx === 0 ? "disabled" : ""}>上移</button>
        <button class="btn" type="button" onclick="moveCategory('${c.id}',1)" ${idx >= cats.length - 1 ? "disabled" : ""}>下移</button>
        <button class="btn btn-danger" type="button" onclick="removeCategory('${c.id}')">删除</button>
      </div>
    </div>`).join("") || '<div class="muted">暂无栏目</div>';
  refreshCategorySelects();
}

function syncCategoryNamesFromInputs() {
  document.querySelectorAll("#category-list .cat-name").forEach((input) => {
    const id = input.getAttribute("data-id");
    const c = (menu.categories || []).find((x) => x.id === id);
    if (c) c.name = input.value.trim() || c.name;
  });
}

function addCategory() {
  ensureCategories();
  const name = (document.getElementById("cat-new-name").value || "").trim();
  if (!name) {
    setStatus("cat-status", "请填写栏目名称", false);
    return;
  }
  syncCategoryNamesFromInputs();
  const id = slugCategoryId(name);
  menu.categories.push({ id, name, order: menu.categories.length + 1 });
  document.getElementById("cat-new-name").value = "";
  renderCategoryManager();
  setStatus("cat-status", "已添加，请点「只保存菜单/站点信息」写入 GitHub", true);
}

function removeCategory(id) {
  ensureCategories();
  if (menu.categories.length <= 1) {
    setStatus("cat-status", "至少保留一个栏目", false);
    return;
  }
  if (!confirm("删除栏目后，其中文章会挪到第一个栏目。确认删除？")) return;
  syncCategoryNamesFromInputs();
  menu.categories = menu.categories.filter((c) => c.id !== id);
  const fallback = menu.categories[0].id;
  (menu.items || []).forEach((it) => {
    if (it.category === id) it.category = fallback;
  });
  renderCategoryManager();
  renderList();
  setStatus("cat-status", "已删除（本地），请保存菜单生效", true);
}

function moveCategory(id, delta) {
  syncCategoryNamesFromInputs();
  const cats = sortedCategories();
  const idx = cats.findIndex((c) => c.id === id);
  const j = idx + delta;
  if (idx < 0 || j < 0 || j >= cats.length) return;
  const tmp = cats[idx];
  cats[idx] = cats[j];
  cats[j] = tmp;
  cats.forEach((c, i) => { c.order = i + 1; });
  menu.categories = cats;
  renderCategoryManager();
  setStatus("cat-status", "顺序已调整，请保存菜单", true);
}

function onListCategoryFilter() {
  const el = document.getElementById("list-category-filter");
  listCategoryFilter = el ? el.value : "";
  listPage = 1;
  renderList();
}

async function reloadAll() {
  const file = await getFile("content/menu.json");
  menu = JSON.parse(file.content);
  menu._sha = file.sha;
  ensureCategories();
  document.getElementById("site-title").value = menu.siteTitle || "";
  document.getElementById("site-intro").value = menu.siteIntro || "";
  renderCategoryManager();
  const items = sortedItems();
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  if (listPage > pages) listPage = pages;
  renderList();
  if (!currentId && items[0]) selectPost(items[0].id);
  else if (currentId) selectPost(currentId);
}

function sortedItems() {
  let items = (menu.items || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  if (listCategoryFilter) {
    items = items.filter((x) => (x.category || "") === listCategoryFilter);
  }
  return items;
}

function renderList() {
  const box = document.getElementById("post-list");
  const items = sortedItems();
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE) || 1);
  if (listPage < 1) listPage = 1;
  if (listPage > pages) listPage = pages;
  const start = (listPage - 1) * PAGE_SIZE;
  const pageItems = items.slice(start, start + PAGE_SIZE);

  box.innerHTML = pageItems.map((it) => `
    <div class="list-item ${it.id === currentId ? "active" : ""}" onclick="selectPost('${it.id}')">
      <div><strong>${escapeHtml(it.title || it.id)}</strong>${it.private ? '<span class="badge-priv">私密</span>' : ""}</div>
      <div class="muted">${escapeHtml(categoryName(it.category))} · ${escapeHtml(it.id)} · ${it.enabled === false ? "隐藏" : "显示"}</div>
    </div>`).join("") || '<div class="muted">暂无文章</div>';

  const pager = document.getElementById("post-pager");
  if (!pager) return;
  const total = items.length;
  pager.innerHTML = `
    <span>共 ${total} 篇 · 每页 ${PAGE_SIZE} · 第 ${listPage}/${pages} 页</span>
    <div class="row">
      <button class="btn" type="button" onclick="gotoListPage(1)" ${listPage <= 1 ? "disabled" : ""}>首页</button>
      <button class="btn" type="button" onclick="gotoListPage(${listPage - 1})" ${listPage <= 1 ? "disabled" : ""}>上一页</button>
      <button class="btn" type="button" onclick="gotoListPage(${listPage + 1})" ${listPage >= pages ? "disabled" : ""}>下一页</button>
      <button class="btn" type="button" onclick="gotoListPage(${pages})" ${listPage >= pages ? "disabled" : ""}>末页</button>
    </div>`;
}

function gotoListPage(p) {
  listPage = p;
  renderList();
}

async function selectPost(id) {
  currentId = id;
  // jump list page to contain selected
  const items = sortedItems();
  const idx = items.findIndex((x) => x.id === id);
  if (idx >= 0) listPage = Math.floor(idx / PAGE_SIZE) + 1;
  renderList();
  try {
    const file = await getFile(`content/posts/${id}.json`);
    const post = JSON.parse(file.content);
    post._sha = file.sha;
    await fillEditor(post);
  } catch (e) {
    pendingEncrypted = null;
    fillEditorPlain({ id, title: id, intro: "", desc: "", sections: [], enabled: true, private: false });
    setStatus("save-status", "远端无此文，保存时会新建：" + e.message, false);
  }
}

async function fillEditor(post) {
  pendingEncrypted = null;
  document.getElementById("post-id").value = post.id || "";
  document.getElementById("post-title").value = post.title || "";
  document.getElementById("post-intro").value = post.intro || "";
  const mi = (menu.items || []).find((x) => x.id === post.id) || {};
  document.getElementById("post-desc").value = mi.desc || post.desc || "";
  document.getElementById("post-enabled").value = String(mi.enabled !== false);
  refreshCategorySelects();
  document.getElementById("post-category").value = mi.category || (sortedCategories()[0] && sortedCategories()[0].id) || "study";
  const isPrivate = !!(post.private || mi.private || post.enc);
  document.getElementById("post-visibility").value = isPrivate ? "private" : "public";
  window._postSha = post._sha || null;
  onVisibilityChange();
  refreshPwdSelect();

  if (post.enc && (!post.sections || !post.sections.length)) {
    pendingEncrypted = { enc: post.enc, id: post.id, title: post.title, intro: post.intro };
    document.getElementById("sections").innerHTML = '<div class="muted">私密内容已加密，请先解锁后再编辑章节。</div>';
    document.getElementById("private-unlock-box").classList.remove("hidden");
    // try vault default
    const guess = NotesCrypto.getDefaultPassword();
    if (guess) {
      try {
        await tryDecryptIntoEditor(guess);
        return;
      } catch (e) {}
    }
    return;
  }
  document.getElementById("private-unlock-box").classList.add("hidden");
  fillSections(post.sections || []);
}

function fillEditorPlain(post) {
  pendingEncrypted = null;
  document.getElementById("post-id").value = post.id || "";
  document.getElementById("post-title").value = post.title || "";
  document.getElementById("post-intro").value = post.intro || "";
  document.getElementById("post-desc").value = post.desc || "";
  document.getElementById("post-enabled").value = String(post.enabled !== false);
  refreshCategorySelects();
  document.getElementById("post-category").value = post.category || (sortedCategories()[0] && sortedCategories()[0].id) || "study";
  document.getElementById("post-visibility").value = post.private ? "private" : "public";
  window._postSha = post._sha || null;
  onVisibilityChange();
  refreshPwdSelect();
  document.getElementById("private-unlock-box").classList.add("hidden");
  fillSections(post.sections || []);
}

function fillSections(sections) {
  const box = document.getElementById("sections");
  box.innerHTML = "";
  (sections || []).forEach((sec, idx) => box.appendChild(sectionEl(sec, idx)));
}

function onVisibilityChange() {
  const priv = document.getElementById("post-visibility").value === "private";
  document.getElementById("private-pwd-box").classList.toggle("hidden", !priv);
}

function renderVault() {
  const box = document.getElementById("pwd-list");
  if (!box) return;
  if (typeof NotesCrypto === "undefined") {
    box.innerHTML = '<div class="muted">加密模块未加载，请强制刷新页面（Ctrl+F5）。</div>';
    return;
  }
  const vault = NotesCrypto.loadVault();
  const entries = vault.entries || [];
  if (!entries.length) {
    box.innerHTML = '<div class="muted">暂无密码，请先添加。</div>';
    return;
  }
  box.innerHTML = entries.map((e) => `
    <div class="pwd-item">
      <div>
        <strong>${escapeHtml(e.label)}</strong>
        ${e.id === vault.defaultId ? '<span class="badge-priv">默认</span>' : ""}
        <div class="muted">••••••••</div>
      </div>
      <div class="row">
        <button class="btn" type="button" onclick="setDefaultPwd('${e.id}')">设默认</button>
        <button class="btn btn-danger" type="button" onclick="removeVaultPwd('${e.id}')">删除</button>
      </div>
    </div>`).join("");
}

function refreshPwdSelect() {
  const sel = document.getElementById("post-pwd-select");
  if (!sel) return;
  if (typeof NotesCrypto === "undefined") {
    sel.innerHTML = '<option value="">（加密模块未加载）</option>';
    return;
  }
  const vault = NotesCrypto.loadVault();
  const entries = vault.entries || [];
  sel.innerHTML = entries.length
    ? entries.map((e) => `<option value="${e.id}" ${e.id === vault.defaultId ? "selected" : ""}>${escapeHtml(e.label)}</option>`).join("")
    : '<option value="">（密码库为空，请先在上方添加）</option>';
}

function addVaultPassword() {
  const label = document.getElementById("pwd-label").value.trim();
  const password = document.getElementById("pwd-value").value;
  const makeDefault = document.getElementById("pwd-default").checked;
  if (!label || !password) {
    setStatus("pwd-status", "请填写名称和密码", false);
    return;
  }
  NotesCrypto.upsertPassword(label, password, makeDefault);
  document.getElementById("pwd-label").value = "";
  document.getElementById("pwd-value").value = "";
  renderVault();
  refreshPwdSelect();
  setStatus("pwd-status", "已保存到本机密码库", true);
}

function removeVaultPwd(id) {
  if (!confirm("删除该密码？已加密文章不受影响，但以后要用原密码解锁。")) return;
  NotesCrypto.removePassword(id);
  renderVault();
  refreshPwdSelect();
}

function setDefaultPwd(id) {
  NotesCrypto.setDefault(id);
  renderVault();
  refreshPwdSelect();
}

function resolveEditorPassword() {
  const typed = document.getElementById("post-pwd-input").value;
  if (typed) return typed;
  const id = document.getElementById("post-pwd-select").value;
  return NotesCrypto.getPasswordById(id) || NotesCrypto.getDefaultPassword();
}

async function tryDecryptIntoEditor(password) {
  if (!pendingEncrypted) throw new Error("没有待解锁内容");
  const payload = await NotesCrypto.decryptPayload(password, pendingEncrypted.enc);
  fillSections(payload.sections || []);
  if (payload.intro != null) document.getElementById("post-intro").value = payload.intro;
  pendingEncrypted = null;
  document.getElementById("private-unlock-box").classList.add("hidden");
  document.getElementById("post-pwd-input").value = password;
  setStatus("unlock-status", "已解锁，可编辑", true);
}

async function unlockCurrentPost() {
  const pwd = document.getElementById("unlock-pwd").value || resolveEditorPassword();
  if (!pwd) {
    setStatus("unlock-status", "请输入密码", false);
    return;
  }
  try {
    await tryDecryptIntoEditor(pwd);
  } catch (e) {
    setStatus("unlock-status", e.message, false);
  }
}

function sectionEl(sec, idx) {
  const wrap = document.createElement("div");
  wrap.className = "section-editor";
  wrap.dataset.idx = idx;
  const blocksText = (sec.blocks || []).map((b) => {
    if (b.type === "ul") return "ul|" + (b.items || []).join(";;");
    return (b.type || "p") + "|" + (b.text || "").replace(/\n/g, "\\n");
  }).join("\n");
  wrap.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <strong>章节 ${idx + 1}</strong>
      <button class="btn btn-danger" type="button" onclick="this.closest('.section-editor').remove()">删除本节</button>
    </div>
    <div class="field"><label>标题</label><input class="sec-title" value="${escapeAttr(sec.title || "")}" /></div>
    <div class="field"><label>角标（可空，默认序号）</label><input class="sec-badge" value="${escapeAttr(sec.badge || "")}" /></div>
    <div class="field"><label>内容块（每行：类型|内容；ul 用 ul|项1;;项2）</label>
      <textarea class="sec-blocks" style="min-height:140px">${escapeHtml(blocksText)}</textarea>
    </div>`;
  return wrap;
}
function escapeAttr(s) { return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }
function escapeHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }

function addSection() {
  document.getElementById("sections").appendChild(sectionEl({
    title: "新章节", badge: "", blocks: [{ type: "p", text: "在这里写内容" }],
  }, document.querySelectorAll(".section-editor").length));
}

function parseBlocks(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
    const i = line.indexOf("|");
    const type = (i >= 0 ? line.slice(0, i) : "p").trim() || "p";
    const raw = (i >= 0 ? line.slice(i + 1) : line).replace(/\\n/g, "\n");
    if (type === "ul") return { type: "ul", items: raw.split(";;").map((x) => x.trim()).filter(Boolean) };
    return { type, text: raw };
  });
}

function collectPost() {
  const id = document.getElementById("post-id").value.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("ID 只能用英文数字_-");
  if (pendingEncrypted) throw new Error("私密文章尚未解锁，请先解锁再保存");
  const sections = [...document.querySelectorAll(".section-editor")].map((el, idx) => ({
    id: "s" + (idx + 1),
    title: el.querySelector(".sec-title").value.trim() || ("章节" + (idx + 1)),
    badge: el.querySelector(".sec-badge").value.trim() || String(idx + 1),
    blocks: parseBlocks(el.querySelector(".sec-blocks").value),
  }));
  return {
    id,
    title: document.getElementById("post-title").value.trim() || id,
    intro: document.getElementById("post-intro").value.trim(),
    updated: new Date().toISOString(),
    sections,
  };
}

async function saveMenuOnly() {
  try {
    syncCategoryNamesFromInputs();
    menu.siteTitle = document.getElementById("site-title").value.trim();
    menu.siteIntro = document.getElementById("site-intro").value.trim();
    const payload = buildMenuPayload();
    const res = await putFile("content/menu.json", JSON.stringify(payload, null, 2) + "\n", "chore: update site menu", menu._sha);
    menu._sha = res.content.sha;
    renderCategoryManager();
    setStatus("save-status", "菜单/栏目已保存", true);
    setStatus("cat-status", "栏目已保存到 GitHub", true);
  } catch (e) {
    setStatus("save-status", "保存失败：" + e.message, false);
  }
}

async function savePost() {
  try {
    const isPrivate = document.getElementById("post-visibility").value === "private";
    const post = collectPost();
    const enabled = document.getElementById("post-enabled").value === "true";
    const desc = document.getElementById("post-desc").value.trim();
    const category = document.getElementById("post-category").value || (sortedCategories()[0] && sortedCategories()[0].id) || "study";

    let publishBody;
    if (isPrivate) {
      const password = resolveEditorPassword();
      if (!password) throw new Error("私密文章请选择或输入密码（可先到密码管理添加）");
      const enc = await NotesCrypto.encryptPayload(password, {
        sections: post.sections,
        intro: post.intro,
      });
      publishBody = {
        id: post.id,
        title: post.title,
        intro: post.intro ? "（私密内容，需密码解锁）" : "（私密内容，需密码解锁）",
        private: true,
        updated: post.updated,
        enc,
        sections: [],
      };
      // keep a public teaser intro optional - use original short desc in menu only
    } else {
      publishBody = { ...post, private: false };
      delete publishBody.enc;
    }

    let sha = window._postSha;
    try {
      if (!sha) {
        const existing = await getFile(`content/posts/${post.id}.json`);
        sha = existing.sha;
      }
    } catch (e) { sha = null; }

    const put = await putFile(
      `content/posts/${post.id}.json`,
      JSON.stringify(publishBody, null, 2) + "\n",
      `content: save ${post.id}`,
      sha
    );
    window._postSha = put.content.sha;

    menu.items = menu.items || [];
    const idx = menu.items.findIndex((x) => x.id === post.id);
    const item = {
      id: post.id,
      title: post.title,
      desc,
      updated: post.updated.slice(0, 10),
      enabled,
      private: isPrivate,
      category,
      order: idx >= 0 ? (menu.items[idx].order || idx + 1) : (menu.items.length + 1),
    };
    if (idx >= 0) menu.items[idx] = item; else menu.items.push(item);
    syncCategoryNamesFromInputs();
    menu.siteTitle = document.getElementById("site-title").value.trim();
    menu.siteIntro = document.getElementById("site-intro").value.trim();
    const menuPayload = buildMenuPayload();
    try {
      const latest = await getFile("content/menu.json");
      menu._sha = latest.sha;
    } catch (e) {}
    const mres = await putFile("content/menu.json", JSON.stringify(menuPayload, null, 2) + "\n", `menu: upsert ${post.id}`, menu._sha);
    menu._sha = mres.content.sha;
    currentId = post.id;
    renderCategoryManager();
    renderList();
    setStatus("save-status", isPrivate ? "已加密发布到 GitHub（私密）。" : "已发布到 GitHub。Pages 约 1 分钟可刷新查看。", true);
  } catch (e) {
    setStatus("save-status", "保存失败：" + e.message, false);
  }
}

async function deletePost() {
  const id = document.getElementById("post-id").value.trim();
  if (!id || !confirm("确认删除文章 " + id + "？")) return;
  try {
    let sha = window._postSha;
    if (!sha) {
      const f = await getFile(`content/posts/${id}.json`);
      sha = f.sha;
    }
    await deleteFile(`content/posts/${id}.json`, sha, `content: delete ${id}`);
    menu.items = (menu.items || []).filter((x) => x.id !== id);
    const latest = await getFile("content/menu.json");
    menu._sha = latest.sha;
    const menuPayload = buildMenuPayload();
    menuPayload.siteTitle = document.getElementById("site-title").value.trim();
    menuPayload.siteIntro = document.getElementById("site-intro").value.trim();
    menuPayload.items = menu.items;
    const mres = await putFile("content/menu.json", JSON.stringify(menuPayload, null, 2) + "\n", `menu: remove ${id}`, menu._sha);
    menu._sha = mres.content.sha;
    currentId = menu.items[0] ? menu.items[0].id : null;
    if (currentId) await selectPost(currentId);
    else fillEditorPlain({ id: "", title: "", intro: "", sections: [] });
    renderList();
    setStatus("save-status", "已删除", true);
  } catch (e) {
    setStatus("save-status", "删除失败：" + e.message, false);
  }
}

function newPost() {
  const id = "post-" + Date.now().toString(36);
  currentId = id;
  window._postSha = null;
  fillEditorPlain({
    id,
    title: "新文章",
    intro: "",
    category: (document.getElementById("list-category-filter") && document.getElementById("list-category-filter").value)
      || (sortedCategories()[0] && sortedCategories()[0].id)
      || "study",
    sections: [{ title: "第一节", badge: "1", blocks: [{ type: "p", text: "开始写内容" }, { type: "code", text: "示例代码" }] }],
    private: false,
  });
  document.getElementById("post-desc").value = "";
  document.getElementById("post-enabled").value = "true";
  document.getElementById("post-pwd-input").value = "";
  renderList();
}

// 启动：先过管理密码门，再进 GitHub / 后台
(function initAdminBoot() {
  const gateInput = document.getElementById("gate-password");
  if (gateInput) {
    gateInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitGate();
    });
  }
  if (isGateOpen()) afterGateOk();
  else showOnly("gate-view");
})();

/* ===== batch import ===== */
let importQueue = [];
let htmlImportQueue = [];
let officeImportQueue = [];

function clearImport() {
  importQueue = [];
  document.getElementById("import-files").value = "";
  document.getElementById("import-preview").innerHTML = "";
  setStatus("import-status", "", null);
}
function clearHtmlImport() {
  htmlImportQueue = [];
  document.getElementById("html-import-files").value = "";
  document.getElementById("html-import-preview").innerHTML = "";
  setStatus("html-import-status", "", null);
}
function clearOfficeImport() {
  officeImportQueue = [];
  document.getElementById("office-import-files").value = "";
  document.getElementById("office-import-preview").innerHTML = "";
  setStatus("office-import-status", "", null);
}

async function previewImport() {
  const input = document.getElementById("import-files");
  const files = [...(input.files || [])];
  if (!files.length) {
    setStatus("import-status", "请先选择文件", false);
    return;
  }
  setStatus("import-status", "解析中…", null);
  importQueue = [];
  const lines = [];
  for (const f of files) {
    try {
      const post = await NotesImporter.fileToPost(f);
      importQueue.push({ fileName: f.name, post, categorySelectId: "import-category" });
      const cat = resolveCategoryId(post.category) || getImportDefaultCategory("import-category");
      lines.push(`✅ ${f.name} → <b>${post.id}</b> · ${post.title} · ${post.sections.length} 节 · 栏目：${categoryName(cat)}`);
    } catch (e) {
      lines.push(`❌ ${f.name} 解析失败：${e.message}`);
    }
  }
  document.getElementById("import-preview").innerHTML = lines.join("<br>");
  setStatus("import-status", `已解析 ${importQueue.length} 个文件，可点一键发布`, true);
}

async function previewHtmlImport() {
  const input = document.getElementById("html-import-files");
  const files = [...(input.files || [])];
  if (!files.length) {
    setStatus("html-import-status", "请先选择 HTML 文件", false);
    return;
  }
  setStatus("html-import-status", "按教程 HTML 结构解析中…", null);
  htmlImportQueue = [];
  const lines = [];
  for (const f of files) {
    try {
      const post = await NotesImporter.fileToPost(f, { mode: "tutorial-html" });
      htmlImportQueue.push({ fileName: f.name, post, categorySelectId: "html-import-category" });
      const sample = (post.sections || []).slice(0, 3).map((s) => s.title).join("；");
      const cat = resolveCategoryId(post.category) || getImportDefaultCategory("html-import-category");
      lines.push(
        `✅ ${f.name} → <b>${post.id}</b> · ${post.title} · <b>${post.sections.length}</b> 节 · 栏目：${categoryName(cat)}` +
        (sample ? `<br>&nbsp;&nbsp;章节示例：${sample}${post.sections.length > 3 ? "…" : ""}` : "")
      );
    } catch (e) {
      lines.push(`❌ ${f.name} 解析失败：${e.message}`);
    }
  }
  document.getElementById("html-import-preview").innerHTML = lines.join("<br>");
  setStatus("html-import-status", `已解析 ${htmlImportQueue.length} 个 HTML，可点发布`, true);
}

async function previewOfficeImport() {
  const input = document.getElementById("office-import-files");
  const files = [...(input.files || [])];
  if (!files.length) {
    setStatus("office-import-status", "请先选择 Word/Excel 文件", false);
    return;
  }
  setStatus("office-import-status", "解析 Office 文件中…", null);
  officeImportQueue = [];
  const lines = [];
  for (const f of files) {
    try {
      const posts = await NotesOfficeImporter.fileToPosts(f);
      for (const post of posts) {
        officeImportQueue.push({ fileName: f.name, post, categorySelectId: "office-import-category" });
        const cat = resolveCategoryId(post.category) || getImportDefaultCategory("office-import-category");
        lines.push(`✅ ${f.name} → <b>${post.id}</b> · ${post.title} · ${post.sections.length} 节 · 栏目：${categoryName(cat)}`);
      }
    } catch (e) {
      lines.push(`❌ ${f.name} 解析失败：${e.message}`);
    }
  }
  document.getElementById("office-import-preview").innerHTML = lines.join("<br>");
  setStatus("office-import-status", `已解析 ${officeImportQueue.length} 篇文章，可点发布`, true);
}

async function publishQueue(queue, statusId, emptyMsg) {
  if (!cfg()) {
    setStatus(statusId, "请先登录 GitHub", false);
    return;
  }
  if (!queue.length) {
    setStatus(statusId, emptyMsg, false);
    return;
  }
  setStatus(statusId, "发布中，请稍候…", null);
  try {
    const menuFile = await getFile("content/menu.json");
    menu = JSON.parse(menuFile.content);
    menu._sha = menuFile.sha;
    menu.items = menu.items || [];
    ensureCategories();

    let ok = 0;
    for (const item of queue) {
      const post = item.post;
      let sha = null;
      try {
        const old = await getFile(`content/posts/${post.id}.json`);
        sha = old.sha;
      } catch (e) {}
      const body = { ...post, private: false };
      delete body.desc;
      delete body.category;
      await putFile(
        `content/posts/${post.id}.json`,
        JSON.stringify(body, null, 2) + "\n",
        `import: ${post.id} from ${item.fileName}`,
        sha
      );
      const idx = menu.items.findIndex((x) => x.id === post.id);
      const fromFile = resolveCategoryId(post.category);
      const fallback = getImportDefaultCategory(item.categorySelectId || "import-category");
      const menuItem = {
        id: post.id,
        title: post.title,
        desc: (post.desc || post.intro || "").slice(0, 80),
        updated: (post.updated || "").slice(0, 10),
        enabled: true,
        private: false,
        category: fromFile || (idx >= 0 ? menu.items[idx].category : null) || fallback,
        order: idx >= 0 ? (menu.items[idx].order || idx + 1) : menu.items.length + 1,
      };
      if (idx >= 0) menu.items[idx] = menuItem; else menu.items.push(menuItem);
      ok += 1;
      setStatus(statusId, `已发布 ${ok}/${queue.length}：${post.id} → ${categoryName(menuItem.category)}`, true);
    }
    menu.siteTitle = document.getElementById("site-title").value.trim() || menu.siteTitle;
    menu.siteIntro = document.getElementById("site-intro").value.trim() || menu.siteIntro || "支持栏目分类与多种导入";
    const latest = await getFile("content/menu.json");
    menu._sha = latest.sha;
    const payload = buildMenuPayload();
    const mres = await putFile("content/menu.json", JSON.stringify(payload, null, 2) + "\n", "menu: batch import", menu._sha);
    menu._sha = mres.content.sha;
    await reloadAll();
    setStatus(statusId, `全部完成：成功 ${ok} 篇。约 1 分钟后刷新站点查看。`, true);
  } catch (e) {
    setStatus(statusId, "发布失败：" + e.message, false);
  }
}

async function publishImport() {
  if (!importQueue.length) {
    await previewImport();
    if (!importQueue.length) return;
  }
  await publishQueue(importQueue, "import-status", "请先解析文件");
}
async function publishHtmlImport() {
  if (!htmlImportQueue.length) {
    await previewHtmlImport();
    if (!htmlImportQueue.length) return;
  }
  await publishQueue(htmlImportQueue, "html-import-status", "请先解析 HTML");
}
async function publishOfficeImport() {
  if (!officeImportQueue.length) {
    await previewOfficeImport();
    if (!officeImportQueue.length) return;
  }
  await publishQueue(officeImportQueue, "office-import-status", "请先解析 Office 文件");
}
