/* Markdown / H5 -> post JSON converter for batch import */
window.NotesImporter = (function () {
  function slugify(title, fallback) {
    const map = {
      "Excel 高阶公式：LAMBDA 与动态数组": "excel-lambda-dynamic-arrays",
      "Excel常用公式与数据透视表教程": "excel-common-formulas-pivot",
      "Excel 常用公式与数据透视表教程": "excel-common-formulas-pivot",
    };
    if (map[title]) return map[title];
    let s = title.toLowerCase().replace(/[^\w\-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (!/[a-z0-9]/.test(s)) return fallback;
    return s.slice(0, 60);
  }

  function parseMd(text, forcedId) {
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const lines = text.split("\n");
    let title = "未命名";
    for (const ln of lines) {
      if (ln.startsWith("# ")) { title = ln.slice(2).strip ? ln.slice(2).trim() : ln.slice(2).trim(); break; }
    }
    const introParts = [];
    for (const ln of lines) {
      if (ln.startsWith("## ")) break;
      if (ln.startsWith("> ")) {
        let t = ln.slice(2).trim();
        if (t.startsWith("#")) continue;
        introParts.push(t.replace(/[*`]/g, ""));
      }
    }
    const intro = introParts.slice(0, 3).join(" ").slice(0, 300);

    const rawSecs = [];
    let cur = null;
    for (const ln of lines) {
      if (ln.startsWith("## ")) {
        if (cur) rawSecs.push(cur);
        cur = { title: ln.slice(3).trim(), lines: [] };
      } else if (cur) cur.lines.push(ln);
    }
    if (cur) rawSecs.push(cur);

    const sections = [];
    let idx = 0;
    for (const sec of rawSecs) {
      if (sec.title === "目录" || sec.title === "Contents") continue;
      const blocks = linesToBlocks(sec.lines);
      if (!blocks.length) continue;
      idx += 1;
      sections.push({ id: "s" + idx, title: sec.title, badge: String(idx), blocks });
    }
    const id = forcedId || slugify(title, "post-" + Date.now().toString(36));
    return {
      id,
      title,
      intro: intro || title,
      updated: new Date().toISOString(),
      sections,
      desc: intro || title,
    };
  }

  function linesToBlocks(lines) {
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
      const ln = lines[i];
      if (!ln.trim()) { i++; continue; }
      if (ln.trim().startsWith("```")) {
        i++;
        const code = [];
        while (i < lines.length && !lines[i].trim().startsWith("```")) { code.push(lines[i]); i++; }
        if (i < lines.length) i++;
        blocks.push({ type: "code", text: code.join("\n").replace(/\s+$/,"") || " " });
        continue;
      }
      if (ln.startsWith("### ") || ln.startsWith("#### ")) {
        blocks.push({ type: "h3", text: ln.replace(/^#+\s*/, "").trim() });
        i++; continue;
      }
      if (ln.startsWith(">")) {
        const texts = [];
        while (i < lines.length && lines[i].startsWith(">")) {
          const t = lines[i].replace(/^>\s?/, "").trim();
          if (t) texts.push(t.replace(/^\*\*|\*\*$/g, ""));
          i++;
        }
        const joined = texts.join(" ");
        let typ = "info";
        if (/风险|注意|警告|不要|必须/.test(joined)) typ = "warning";
        else if (/固定写法|建议|提示/.test(joined)) typ = "tip";
        blocks.push({ type: typ, text: joined.replace(/[*`]/g, "") });
        continue;
      }
      if (/^[-*+] /.test(ln) || /^\d+\.\s/.test(ln)) {
        const items = [];
        while (i < lines.length && (/^[-*+] /.test(lines[i]) || /^\d+\.\s/.test(lines[i]))) {
          items.push(lines[i].replace(/^[-*+] |\d+\.\s/, "").trim().replace(/\[\[#(.+?)\]\]/g, "$1"));
          i++;
        }
        if (items.length) blocks.push({ type: "ul", items });
        continue;
      }
      if (ln.trim().startsWith("|") && ln.includes("|")) {
        const table = [];
        while (i < lines.length && lines[i].includes("|")) {
          const row = lines[i].trim();
          if (/^\|?\s*:?-{3,}/.test(row.replace(/\s/g, ""))) { i++; continue; }
          const cells = row.replace(/^\||\|$/g, "").split("|").map(c => c.trim().replace(/`/g, ""));
          table.push(cells.join(" | "));
          i++;
        }
        if (table.length) blocks.push({ type: "code", text: table.join("\n") });
        continue;
      }
      if (/^-{3,}$/.test(ln.trim()) || ln.trim() === "***") { i++; continue; }

      const para = [];
      while (i < lines.length && lines[i].trim() && !lines[i].startsWith("#") && !lines[i].startsWith(">")
        && !lines[i].trim().startsWith("```") && !/^[-*+] /.test(lines[i]) && !/^\d+\.\s/.test(lines[i])
        && !(lines[i].trim().startsWith("|") && lines[i].includes("|")) && !/^-{3,}$/.test(lines[i].trim())) {
        para.push(lines[i].trim()); i++;
      }
      if (para.length) {
        let text = para.join(" ");
        text = text.replace(/\[\[#(.+?)\]\]/g, "$1").replace(/\*\*(.+?)\*\*/g, "$1");
        blocks.push({ type: "p", text });
        continue;
      }
      i++;
    }
    return blocks;
  }

  function stripTags(s) {
    return s.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, "")
      .replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&").replace(/&quot;/g,'"').trim();
  }

  function htmlInnerToBlocks(inner) {
    const blocks = [];
    const re = /(<div class="code-block"[\s\S]*?<\/div>\s*<\/div>|<pre>[\s\S]*?<\/pre>|<div class="callout[^"]*"[\s\S]*?<\/div>|<div class="subheading"[\s\S]*?<\/div>|<p>[\s\S]*?<\/p>|<ul>[\s\S]*?<\/ul>)/gi;
    let m;
    const parts = [];
    let last = 0;
    while ((m = re.exec(inner))) {
      parts.push(m[0]);
      last = re.lastIndex;
    }
    if (!parts.length) {
      const t = stripTags(inner);
      if (t) blocks.push({ type: "p", text: t.slice(0, 2000) });
      return blocks;
    }
    for (const part of parts) {
      if (/code-block|<pre/i.test(part)) {
        const cm = part.match(/<code[^>]*>([\s\S]*?)<\/code>/i) || part.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
        if (cm) blocks.push({ type: "code", text: stripTags(cm[1]).replace(/&lt;/g,"<").replace(/&gt;/g,">") || " " });
        continue;
      }
      if (/callout-tip/i.test(part)) { blocks.push({ type: "tip", text: stripTags(part) }); continue; }
      if (/callout-warning/i.test(part)) { blocks.push({ type: "warning", text: stripTags(part) }); continue; }
      if (/callout/i.test(part)) { blocks.push({ type: "info", text: stripTags(part) }); continue; }
      if (/subheading/i.test(part)) { blocks.push({ type: "h3", text: stripTags(part) }); continue; }
      if (/^<ul/i.test(part.trim())) {
        const items = [...part.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map(x => stripTags(x[1]));
        blocks.push({ type: "ul", items });
        continue;
      }
      if (/^<p/i.test(part.trim())) {
        const t = stripTags(part);
        if (t) blocks.push({ type: "p", text: t });
      }
    }
    return blocks;
  }

  function parseH5(html, forcedId) {
    const tm = html.match(/<title>([\s\S]*?)<\/title>/i);
    const title = tm ? stripTags(tm[1]) : "导入的H5";
    const headers = [...html.matchAll(/class="accordion-title"[^>]*>([\s\S]*?)<\/div>/gi)].map(m => stripTags(m[1]));
    const contents = [...html.matchAll(/class="accordion-inner"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi)].map(m => m[1]);
    const sections = [];
    const n = Math.max(headers.length, contents.length);
    for (let i = 0; i < n; i++) {
      sections.push({
        id: "s" + (i + 1),
        title: headers[i] || ("章节" + (i + 1)),
        badge: String(i + 1),
        blocks: htmlInnerToBlocks(contents[i] || ""),
      });
    }
    return {
      id: forcedId || slugify(title, "h5-" + Date.now().toString(36)),
      title,
      intro: title,
      updated: new Date().toISOString(),
      sections: sections.length ? sections : [{ id: "s1", title, badge: "1", blocks: [{ type: "p", text: "未能解析折叠结构" }] }],
      desc: title,
    };
  }

  async function fileToPost(file) {
    const text = await file.text();
    const name = file.name.toLowerCase();
    if (name.endsWith(".md") || name.endsWith(".markdown") || name.endsWith(".txt")) {
      return parseMd(text);
    }
    if (name.endsWith(".html") || name.endsWith(".htm") || name.endsWith(".h5")) {
      return parseH5(text);
    }
    // try detect
    if (text.trim().startsWith("<") || /accordion/i.test(text)) return parseH5(text);
    return parseMd(text);
  }

  return { parseMd, parseH5, fileToPost, slugify };
})();
