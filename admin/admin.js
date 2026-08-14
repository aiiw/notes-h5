const CFG_KEY = "notes-h5-cms-config";
let menu = null;
let currentId = null;

function cfg() {
  return JSON.parse(localStorage.getItem(CFG_KEY) || "null");
}
function setStatus(id, msg, ok) {
  const el = document.getElementById(id);
  el.textContent = msg || "";
  el.className = "status " + (ok === true ? "ok" : ok === false ? "err" : "");
}
function logout() {
  localStorage.removeItem(CFG_KEY);
  location.reload();
}
function saveConfig() {
  const c = {
    owner: document.getElementById("cfg-owner").value.trim(),
    repo: document.getElementById("cfg-repo").value.trim(),
    branch: document.getElementById("cfg-branch").value.trim() || "main",
    token: document.getElementById("cfg-token").value.trim(),
  };
  if (!c.owner || !c.repo || !c.token) {
    setStatus("login-status", "请填完整", false);
    return;
  }
  localStorage.setItem(CFG_KEY, JSON.stringify(c));
  bootApp();
}

async function gh(path, method="GET", body=null) {
  const c = cfg();
  const url = "https://api.github.com" + path;
  const headers = {
    "Accept": "application/vnd.github+json",
    "Authorization": "Bearer " + c.token,
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
async function putFile(path, content, message, sha=null) {
  const c = cfg();
  const body = {
    message,
    content: b64encode(content),
    branch: c.branch,
  };
  if (sha) body.sha = sha;
  return gh(`/repos/${c.owner}/${c.repo}/contents/${path}`, "PUT", body);
}
async function deleteFile(path, sha, message) {
  const c = cfg();
  return gh(`/repos/${c.owner}/${c.repo}/contents/${path}`, "DELETE", {
    message, sha, branch: c.branch
  });
}

async function bootApp() {
  const c = cfg();
  if (!c) return;
  document.getElementById("login-view").classList.add("hidden");
  document.getElementById("app-view").classList.remove("hidden");
  document.getElementById("cfg-owner").value = c.owner;
  document.getElementById("cfg-repo").value = c.repo;
  try {
    await reloadAll();
    setStatus("login-status", "已连接 " + c.owner + "/" + c.repo, true);
  } catch (e) {
    document.getElementById("login-view").classList.remove("hidden");
    document.getElementById("app-view").classList.add("hidden");
    setStatus("login-status", "连接失败：" + e.message, false);
  }
}

async function reloadAll() {
  const file = await getFile("content/menu.json");
  menu = JSON.parse(file.content);
  menu._sha = file.sha;
  document.getElementById("site-title").value = menu.siteTitle || "";
  document.getElementById("site-intro").value = menu.siteIntro || "";
  renderList();
  if (!currentId && menu.items && menu.items[0]) selectPost(menu.items[0].id);
  else if (currentId) selectPost(currentId);
}

function renderList() {
  const box = document.getElementById("post-list");
  const items = (menu.items || []).slice().sort((a,b)=>(a.order||0)-(b.order||0));
  box.innerHTML = items.map(it => `
    <div class="list-item ${it.id===currentId?'active':''}" onclick="selectPost('${it.id}')">
      <div><strong>${it.title || it.id}</strong></div>
      <div class="muted">${it.id} · ${it.enabled===false?'隐藏':'显示'}</div>
    </div>`).join("") || '<div class="muted">暂无文章</div>';
}

async function selectPost(id) {
  currentId = id;
  renderList();
  try {
    const file = await getFile(`content/posts/${id}.json`);
    const post = JSON.parse(file.content);
    post._sha = file.sha;
    fillEditor(post);
  } catch (e) {
    // new local only
    fillEditor({ id, title: id, intro: "", desc: "", sections: [], enabled: true });
    setStatus("save-status", "远端无此文，保存时会新建：" + e.message, false);
  }
}

function fillEditor(post) {
  document.getElementById("post-id").value = post.id || "";
  document.getElementById("post-title").value = post.title || "";
  document.getElementById("post-intro").value = post.intro || "";
  const mi = (menu.items || []).find(x => x.id === post.id) || {};
  document.getElementById("post-desc").value = mi.desc || post.desc || "";
  document.getElementById("post-enabled").value = String(mi.enabled !== false);
  window._postSha = post._sha || null;
  const box = document.getElementById("sections");
  box.innerHTML = "";
  (post.sections || []).forEach((sec, idx) => box.appendChild(sectionEl(sec, idx)));
}

function sectionEl(sec, idx) {
  const wrap = document.createElement("div");
  wrap.className = "section-editor";
  wrap.dataset.idx = idx;
  const blocksText = (sec.blocks || []).map(b => {
    if (b.type === "ul") return "ul|" + (b.items || []).join(";;");
    return (b.type || "p") + "|" + (b.text || "").replace(/\n/g, "\\n");
  }).join("\n");
  wrap.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <strong>章节 ${idx+1}</strong>
      <button class="btn btn-danger" type="button" onclick="this.closest('.section-editor').remove()">删除本节</button>
    </div>
    <div class="field"><label>标题</label><input class="sec-title" value="${escapeAttr(sec.title||'')}" /></div>
    <div class="field"><label>角标（可空，默认序号）</label><input class="sec-badge" value="${escapeAttr(sec.badge||'')}" /></div>
    <div class="field"><label>内容块（每行：类型|内容；ul 用 ul|项1;;项2）</label>
      <textarea class="sec-blocks" style="min-height:140px">${escapeHtml(blocksText)}</textarea>
    </div>`;
  return wrap;
}
function escapeAttr(s){return String(s).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");}
function escapeHtml(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;");}

function addSection() {
  document.getElementById("sections").appendChild(sectionEl({
    title: "新章节", badge: "", blocks: [{type:"p", text:"在这里写内容"}]
  }, document.querySelectorAll(".section-editor").length));
}

function parseBlocks(text) {
  return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
    const i = line.indexOf("|");
    const type = (i>=0 ? line.slice(0,i) : "p").trim() || "p";
    const raw = (i>=0 ? line.slice(i+1) : line).replace(/\\n/g, "\n");
    if (type === "ul") return { type: "ul", items: raw.split(";;").map(x=>x.trim()).filter(Boolean) };
    return { type, text: raw };
  });
}

function collectPost() {
  const id = document.getElementById("post-id").value.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("ID 只能用英文数字_-");
  const sections = [...document.querySelectorAll(".section-editor")].map((el, idx) => ({
    id: "s" + (idx+1),
    title: el.querySelector(".sec-title").value.trim() || ("章节"+(idx+1)),
    badge: el.querySelector(".sec-badge").value.trim() || String(idx+1),
    blocks: parseBlocks(el.querySelector(".sec-blocks").value)
  }));
  return {
    id,
    title: document.getElementById("post-title").value.trim() || id,
    intro: document.getElementById("post-intro").value.trim(),
    updated: new Date().toISOString(),
    sections
  };
}

async function saveMenuOnly() {
  try {
    menu.siteTitle = document.getElementById("site-title").value.trim();
    menu.siteIntro = document.getElementById("site-intro").value.trim();
    const payload = { siteTitle: menu.siteTitle, siteIntro: menu.siteIntro, items: menu.items || [] };
    const res = await putFile("content/menu.json", JSON.stringify(payload, null, 2) + "\n", "chore: update site menu", menu._sha);
    menu._sha = res.content.sha;
    setStatus("save-status", "菜单已保存", true);
  } catch (e) {
    setStatus("save-status", "保存失败：" + e.message, false);
  }
}

async function savePost() {
  try {
    const post = collectPost();
    const enabled = document.getElementById("post-enabled").value === "true";
    const desc = document.getElementById("post-desc").value.trim();
    // write post
    let sha = window._postSha;
    try {
      if (!sha) {
        const existing = await getFile(`content/posts/${post.id}.json`);
        sha = existing.sha;
      }
    } catch (e) { sha = null; }
    const put = await putFile(
      `content/posts/${post.id}.json`,
      JSON.stringify(post, null, 2) + "\n",
      `content: save ${post.id}`,
      sha
    );
    window._postSha = put.content.sha;

    // upsert menu item
    menu.items = menu.items || [];
    const idx = menu.items.findIndex(x => x.id === post.id);
    const item = {
      id: post.id,
      title: post.title,
      desc,
      updated: post.updated.slice(0,10),
      enabled,
      order: idx >= 0 ? (menu.items[idx].order || idx+1) : (menu.items.length + 1)
    };
    if (idx >= 0) menu.items[idx] = item; else menu.items.push(item);
    menu.siteTitle = document.getElementById("site-title").value.trim();
    menu.siteIntro = document.getElementById("site-intro").value.trim();
    const menuPayload = { siteTitle: menu.siteTitle, siteIntro: menu.siteIntro, items: menu.items };
    // refresh menu sha
    try {
      const latest = await getFile("content/menu.json");
      menu._sha = latest.sha;
    } catch (e) {}
    const mres = await putFile("content/menu.json", JSON.stringify(menuPayload, null, 2) + "\n", `menu: upsert ${post.id}`, menu._sha);
    menu._sha = mres.content.sha;
    currentId = post.id;
    renderList();
    setStatus("save-status", "已发布到 GitHub。Pages 约 1 分钟可刷新查看。", true);
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
    menu.items = (menu.items || []).filter(x => x.id !== id);
    const latest = await getFile("content/menu.json");
    menu._sha = latest.sha;
    const menuPayload = { siteTitle: document.getElementById("site-title").value.trim(), siteIntro: document.getElementById("site-intro").value.trim(), items: menu.items };
    const mres = await putFile("content/menu.json", JSON.stringify(menuPayload, null, 2) + "\n", `menu: remove ${id}`, menu._sha);
    menu._sha = mres.content.sha;
    currentId = menu.items[0] ? menu.items[0].id : null;
    if (currentId) await selectPost(currentId);
    else fillEditor({id:"", title:"", intro:"", sections:[]});
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
  fillEditor({
    id,
    title: "新文章",
    intro: "",
    sections: [{ title: "第一节", badge: "1", blocks: [{type:"p", text:"开始写内容"}, {type:"code", text:"示例代码"}]}]
  });
  document.getElementById("post-desc").value = "";
  document.getElementById("post-enabled").value = "true";
  renderList();
}

if (cfg()) bootApp();
else {
  // prefill from local if any
}


/* ===== batch import ===== */
let importQueue = [];
let htmlImportQueue = [];

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
      importQueue.push({ fileName: f.name, post });
      lines.push(`✅ ${f.name} → <b>${post.id}</b> · ${post.title} · ${post.sections.length} 个折叠章节`);
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
      htmlImportQueue.push({ fileName: f.name, post });
      const sample = (post.sections || []).slice(0, 3).map(s => s.title).join("；");
      lines.push(
        `✅ ${f.name} → <b>${post.id}</b> · ${post.title} · <b>${post.sections.length}</b> 个折叠章节` +
        (sample ? `<br>&nbsp;&nbsp;章节示例：${sample}${post.sections.length > 3 ? "…" : ""}` : "")
      );
    } catch (e) {
      lines.push(`❌ ${f.name} 解析失败：${e.message}`);
    }
  }
  document.getElementById("html-import-preview").innerHTML = lines.join("<br>");
  setStatus("html-import-status", `已解析 ${htmlImportQueue.length} 个 HTML，可点发布`, true);
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

    let ok = 0;
    for (const item of queue) {
      const post = item.post;
      let sha = null;
      try {
        const old = await getFile(`content/posts/${post.id}.json`);
        sha = old.sha;
      } catch (e) {}
      await putFile(
        `content/posts/${post.id}.json`,
        JSON.stringify(post, null, 2) + "\n",
        `import: ${post.id} from ${item.fileName}`,
        sha
      );
      const idx = menu.items.findIndex(x => x.id === post.id);
      const menuItem = {
        id: post.id,
        title: post.title,
        desc: (post.desc || post.intro || "").slice(0, 80),
        updated: (post.updated || "").slice(0, 10),
        enabled: true,
        order: idx >= 0 ? (menu.items[idx].order || idx + 1) : menu.items.length + 1,
      };
      if (idx >= 0) menu.items[idx] = menuItem; else menu.items.push(menuItem);
      ok += 1;
      setStatus(statusId, `已发布 ${ok}/${queue.length}：${post.id}`, true);
    }
    menu.siteTitle = document.getElementById("site-title").value.trim() || menu.siteTitle;
    menu.siteIntro = document.getElementById("site-intro").value.trim() || menu.siteIntro || "支持批量导入 Markdown / HTML";
    const latest = await getFile("content/menu.json");
    menu._sha = latest.sha;
    const payload = { siteTitle: menu.siteTitle, siteIntro: menu.siteIntro, items: menu.items };
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
