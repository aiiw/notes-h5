/* Excel / Word -> post JSON (requires SheetJS XLSX + mammoth on page) */
window.NotesOfficeImporter = (function () {
  function slugify(title, fallback) {
    let s = String(title || "")
      .toLowerCase()
      .replace(/[^\w\-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    if (!/[a-z0-9]/.test(s)) return fallback || "post-" + Date.now().toString(36);
    return s.slice(0, 60);
  }

  function normType(t) {
    t = String(t || "p").trim().toLowerCase();
    const map = {
      段落: "p", p: "p", paragraph: "p",
      小标题: "h3", h3: "h3", heading: "h3",
      代码: "code", code: "code", sql: "code",
      提示: "tip", tip: "tip",
      警告: "warning", warning: "warning", warn: "warning",
      信息: "info", info: "info",
      列表: "ul", ul: "ul", list: "ul",
    };
    return map[t] || "p";
  }

  function rowToBlock(type, content) {
    type = normType(type);
    content = String(content == null ? "" : content);
    if (type === "ul") {
      return { type: "ul", items: content.split(";;").map((x) => x.trim()).filter(Boolean) };
    }
    return { type, text: content };
  }

  function excelRowsToPosts(rows) {
    // rows: array of objects with Chinese or English keys
    const byId = new Map();
    for (const r of rows) {
      const idRaw = r["文章ID"] || r["id"] || r["ID"] || "";
      const title = String(r["文章标题"] || r["title"] || r["标题"] || "").trim();
      const id = String(idRaw || "").trim() || slugify(title, "xlsx-" + Date.now().toString(36));
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) continue;
      const secTitle = String(r["章节标题"] || r["section"] || r["章节"] || "未命名章节").trim();
      const badge = String(r["角标"] || r["badge"] || "").trim();
      const block = rowToBlock(r["块类型"] || r["type"] || "p", r["内容"] || r["content"] || r["文本"] || "");
      if (!byId.has(id)) {
        byId.set(id, {
          id,
          title: title || id,
          desc: String(r["菜单简介"] || r["desc"] || "").trim(),
          intro: String(r["文首说明"] || r["intro"] || "").trim(),
          category: String(r["栏目"] || r["category"] || r["分类"] || "").trim(),
          updated: new Date().toISOString(),
          _secs: new Map(),
        });
      }
      const post = byId.get(id);
      if (title) post.title = title;
      if (r["菜单简介"] || r["desc"]) post.desc = String(r["菜单简介"] || r["desc"] || "").trim();
      if (r["文首说明"] || r["intro"]) post.intro = String(r["文首说明"] || r["intro"] || "").trim();
      const catRaw = String(r["栏目"] || r["category"] || r["分类"] || "").trim();
      if (catRaw) post.category = catRaw;
      if (!post._secs.has(secTitle)) post._secs.set(secTitle, { title: secTitle, badge, blocks: [] });
      const sec = post._secs.get(secTitle);
      if (badge) sec.badge = badge;
      if (block.type === "ul" ? block.items.length : (block.text || "").trim()) {
        sec.blocks.push(block);
      }
    }
    const posts = [];
    for (const post of byId.values()) {
      let i = 0;
      post.sections = [...post._secs.values()].map((s) => {
        i += 1;
        return {
          id: "s" + i,
          title: s.title,
          badge: s.badge || String(i),
          blocks: s.blocks.length ? s.blocks : [{ type: "p", text: "（空章节）" }],
        };
      });
      delete post._secs;
      if (!post.intro) post.intro = post.title;
      if (!post.desc) post.desc = post.intro.slice(0, 80);
      posts.push(post);
    }
    return posts;
  }

  async function parseExcelFile(file) {
    if (typeof XLSX === "undefined") throw new Error("未加载 Excel 解析库 XLSX");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheetName = wb.SheetNames.includes("内容") ? "内容" : wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    if (!rows.length) throw new Error("Excel 无数据行");
    return excelRowsToPosts(rows);
  }

  function parseWordHtml(html, fileName) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    let title = "";
    let id = "";
    let intro = "";
    let desc = "";
    let category = "";
    const sections = [];
    let cur = null;
    let inCode = false;
    let codeBuf = [];

    function flushCode() {
      if (!cur) return;
      if (codeBuf.length) {
        cur.blocks.push({ type: "code", text: codeBuf.join("\n") });
        codeBuf = [];
      }
      inCode = false;
    }

    const nodes = [...doc.body.childNodes];
    for (const node of nodes) {
      if (node.nodeType !== 1) continue;
      const tag = node.tagName.toLowerCase();
      const text = (node.textContent || "").trim();
      if (!text && tag !== "ul" && tag !== "ol") continue;

      if (tag === "h1") {
        title = text;
        continue;
      }
      if (tag === "h2") {
        flushCode();
        cur = { title: text, badge: "", blocks: [] };
        sections.push(cur);
        continue;
      }
      if (tag === "h3") {
        if (!cur) {
          cur = { title: "正文", badge: "1", blocks: [] };
          sections.push(cur);
        }
        cur.blocks.push({ type: "h3", text });
        continue;
      }

      // meta lines before first h2
      if (!cur && /^ID\s*[:：]/i.test(text)) {
        id = text.replace(/^ID\s*[:：]\s*/i, "").trim();
        continue;
      }
      if (!cur && /^INTRO\s*[:：]/i.test(text)) {
        intro = text.replace(/^INTRO\s*[:：]\s*/i, "").trim();
        continue;
      }
      if (!cur && /^DESC\s*[:：]/i.test(text)) {
        desc = text.replace(/^DESC\s*[:：]\s*/i, "").trim();
        continue;
      }
      if (!cur && /^(CATEGORY|栏目|分类)\s*[:：]/i.test(text)) {
        category = text.replace(/^(CATEGORY|栏目|分类)\s*[:：]\s*/i, "").trim();
        continue;
      }
      if (!cur && /^菜单简介\s*[:：]/.test(text)) {
        desc = text.replace(/^菜单简介\s*[:：]\s*/, "").trim();
        continue;
      }
      if (!cur) {
        if (!intro) intro = text;
        continue;
      }

      if (/^\[CODE\]$/i.test(text)) { inCode = true; codeBuf = []; continue; }
      if (/^\[\/CODE\]$/i.test(text)) { flushCode(); continue; }
      if (inCode) { codeBuf.push(text); continue; }

      if (/^\[TIP\]/i.test(text)) {
        cur.blocks.push({ type: "tip", text: text.replace(/^\[TIP\]\s*/i, "") });
        continue;
      }
      if (/^\[WARNING\]/i.test(text)) {
        cur.blocks.push({ type: "warning", text: text.replace(/^\[WARNING\]\s*/i, "") });
        continue;
      }
      if (/^\[INFO\]/i.test(text)) {
        cur.blocks.push({ type: "info", text: text.replace(/^\[INFO\]\s*/i, "") });
        continue;
      }

      if (tag === "ul" || tag === "ol") {
        const items = [...node.querySelectorAll("li")].map((li) => li.textContent.trim()).filter(Boolean);
        if (items.length) cur.blocks.push({ type: "ul", items });
        continue;
      }

      if (tag === "pre" || node.querySelector && node.querySelector("code")) {
        cur.blocks.push({ type: "code", text });
        continue;
      }

      // bullet-like paragraphs
      if (/^[-*•]\s+/.test(text)) {
        const items = [];
        // single item; consecutive handled separately
        items.push(text.replace(/^[-*•]\s+/, ""));
        const last = cur.blocks[cur.blocks.length - 1];
        if (last && last.type === "ul") last.items.push(...items);
        else cur.blocks.push({ type: "ul", items });
        continue;
      }

      cur.blocks.push({ type: "p", text });
    }
    flushCode();

    if (!title) title = (fileName || "导入文档").replace(/\.(docx|doc)$/i, "");
    if (!id) id = slugify(title, "docx-" + Date.now().toString(36));
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) id = slugify(id, "docx-" + Date.now().toString(36));

    const outSecs = sections.map((s, i) => ({
      id: "s" + (i + 1),
      title: s.title,
      badge: s.badge || String(i + 1),
      blocks: s.blocks.length ? s.blocks : [{ type: "p", text: "（空章节）" }],
    }));

    return [{
      id,
      title,
      intro: intro || title,
      desc: desc || (intro || title).slice(0, 80),
      category: category || "",
      updated: new Date().toISOString(),
      sections: outSecs.length ? outSecs : [{
        id: "s1", title: title, badge: "1",
        blocks: [{ type: "p", text: "未能从 Word 识别二级标题章节，请按模板使用「标题2」。" }],
      }],
    }];
  }

  async function parseWordFile(file) {
    if (typeof mammoth === "undefined") throw new Error("未加载 Word 解析库 mammoth");
    const buf = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer: buf });
    return parseWordHtml(result.value || "", file.name);
  }

  async function fileToPosts(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) {
      return parseExcelFile(file);
    }
    if (name.endsWith(".docx") || name.endsWith(".doc")) {
      return parseWordFile(file);
    }
    throw new Error("仅支持 .xlsx / .docx");
  }

  return { parseExcelFile, parseWordFile, fileToPosts, excelRowsToPosts };
})();
