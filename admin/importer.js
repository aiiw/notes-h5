/* Markdown / H5 / Tutorial-HTML -> post JSON converter for batch import */
window.NotesImporter = (function () {
  function slugify(title, fallback) {
    const map = {
      "Excel 高阶公式：LAMBDA 与动态数组": "excel-lambda-dynamic-arrays",
      "Excel常用公式与数据透视表教程": "excel-common-formulas-pivot",
      "Excel 常用公式与数据透视表教程": "excel-common-formulas-pivot",
      "SQL Server 编程教程 — 基于自动点模脚本 p_mold_auto_apply_v4_bak": "sqlserver-mold-auto-apply",
      "SQL Server 编程教程": "sqlserver-mold-auto-apply",
    };
    if (map[title]) return map[title];
    let s = title.toLowerCase().replace(/[^\w\-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (!/[a-z0-9]/.test(s)) return fallback;
    return s.slice(0, 60);
  }

  function decodeEntities(s) {
    return String(s || "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
  }

  function stripTags(s) {
    return decodeEntities(
      String(s || "")
        .replace(/<br\s*\/?\s*>/gi, "\n")
        .replace(/<\/(p|div|h\d|li|tr)>/gi, "\n")
        .replace(/<[^>]+>/g, "")
    )
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function parseMd(text, forcedId) {
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const lines = text.split("\n");
    let title = "未命名";
    for (const ln of lines) {
      if (ln.startsWith("# ")) { title = ln.slice(2).trim(); break; }
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
        blocks.push({ type: "code", text: code.join("\n").replace(/\s+$/, "") || " " });
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

  function htmlInnerToBlocks(inner) {
    const blocks = [];
    const re = /(<div class="code-block"[\s\S]*?<\/div>\s*<\/div>|<pre>[\s\S]*?<\/pre>|<div class="callout[^"]*"[\s\S]*?<\/div>|<div class="subheading"[\s\S]*?<\/div>|<p>[\s\S]*?<\/p>|<ul>[\s\S]*?<\/ul>)/gi;
    let m;
    const parts = [];
    while ((m = re.exec(inner))) parts.push(m[0]);
    if (!parts.length) {
      const t = stripTags(inner);
      if (t) blocks.push({ type: "p", text: t.slice(0, 2000) });
      return blocks;
    }
    for (const part of parts) {
      if (/code-block|<pre/i.test(part)) {
        const cm = part.match(/<code[^>]*>([\s\S]*?)<\/code>/i) || part.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
        if (cm) blocks.push({ type: "code", text: stripTags(cm[1]) || " " });
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

  /** Extract balanced HTML fragment starting at openTagIndex (tag already matched). */
  function extractBalanced(html, openTagIndex, tagName) {
    const openRe = new RegExp("<" + tagName + "\\b[^>]*>", "gi");
    const closeRe = new RegExp("</" + tagName + "\\s*>", "gi");
    openRe.lastIndex = openTagIndex;
    const open = openRe.exec(html);
    if (!open) return null;
    let depth = 1;
    let i = openRe.lastIndex;
    while (depth > 0 && i < html.length) {
      openRe.lastIndex = i;
      closeRe.lastIndex = i;
      const nextOpen = openRe.exec(html);
      const nextClose = closeRe.exec(html);
      if (!nextClose) break;
      if (nextOpen && nextOpen.index < nextClose.index) {
        depth++;
        i = openRe.lastIndex;
      } else {
        depth--;
        i = closeRe.lastIndex;
        if (depth === 0) {
          return {
            full: html.slice(openTagIndex, i),
            inner: html.slice(open.index + open[0].length, nextClose.index),
            end: i,
          };
        }
      }
    }
    return null;
  }

  function tableToText(tableHtml) {
    const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((rm) => {
      const cells = [...rm[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => stripTags(c[1]).replace(/\s+/g, " "));
      return cells.join(" | ");
    }).filter(Boolean);
    return rows.join("\n");
  }

  function tutorialSectionToBlocks(inner) {
    const blocks = [];
    let i = 0;
    const src = inner;

    while (i < src.length) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (i >= src.length) break;

      // skip script/style
      if (/^<(script|style)\b/i.test(src.slice(i))) {
        const tag = src.slice(i).match(/^<(script|style)\b/i)[1];
        const end = src.toLowerCase().indexOf("</" + tag.toLowerCase() + ">", i);
        i = end >= 0 ? end + tag.length + 3 : src.length;
        continue;
      }

      // headings h3/h4
      const hm = src.slice(i).match(/^<h([34])\b[^>]*>([\s\S]*?)<\/h\1>/i);
      if (hm) {
        blocks.push({ type: "h3", text: stripTags(hm[2]) });
        i += hm[0].length;
        continue;
      }

      // boxes: info / tip / warn / pattern
      const boxM = src.slice(i).match(/^<div\b[^>]*class="[^"]*(?:info-box|tip-box|warn-box|pattern-box|callout)[^"]*"[^>]*>/i);
      if (boxM) {
        const bal = extractBalanced(src, i, "div");
        if (bal) {
          const cls = (boxM[0].match(/class="([^"]*)"/i) || [, ""])[1];
          let typ = "info";
          if (/warn|warning|risk/i.test(cls)) typ = "warning";
          else if (/tip|pattern/i.test(cls)) typ = "tip";
          const text = stripTags(bal.inner).replace(/\n+/g, " ").trim();
          if (text) blocks.push({ type: typ, text });
          i = bal.end;
          continue;
        }
      }

      // pre / code
      if (/^<pre\b/i.test(src.slice(i))) {
        const bal = extractBalanced(src, i, "pre");
        if (bal) {
          const cm = bal.inner.match(/<code[^>]*>([\s\S]*?)<\/code>/i);
          blocks.push({ type: "code", text: stripTags(cm ? cm[1] : bal.inner) || " " });
          i = bal.end;
          continue;
        }
      }

      // table
      if (/^<table\b/i.test(src.slice(i))) {
        const bal = extractBalanced(src, i, "table");
        if (bal) {
          const t = tableToText(bal.full);
          if (t) blocks.push({ type: "code", text: t });
          i = bal.end;
          continue;
        }
      }

      // ul / ol
      if (/^<(ul|ol)\b/i.test(src.slice(i))) {
        const tag = src.slice(i).match(/^<(ul|ol)\b/i)[1];
        const bal = extractBalanced(src, i, tag);
        if (bal) {
          const items = [...bal.inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((x) => stripTags(x[1]).replace(/\n+/g, " "));
          if (items.length) blocks.push({ type: "ul", items });
          i = bal.end;
          continue;
        }
      }

      // paragraph
      if (/^<p\b/i.test(src.slice(i))) {
        const bal = extractBalanced(src, i, "p");
        if (bal) {
          const t = stripTags(bal.inner).replace(/\n+/g, " ");
          if (t) blocks.push({ type: "p", text: t });
          i = bal.end;
          continue;
        }
      }

      // generic div — recurse into children if not a known box
      if (/^<div\b/i.test(src.slice(i))) {
        const bal = extractBalanced(src, i, "div");
        if (bal) {
          const nested = tutorialSectionToBlocks(bal.inner);
          if (nested.length) blocks.push(...nested);
          else {
            const t = stripTags(bal.inner).replace(/\n+/g, " ").trim();
            if (t) blocks.push({ type: "p", text: t.slice(0, 3000) });
          }
          i = bal.end;
          continue;
        }
      }

      // hr / comments / other tags — skip one tag
      const skip = src.slice(i).match(/^<!--[\s\S]*?-->|^<[^>]+>/);
      if (skip) { i += skip[0].length; continue; }
      // plain text
      const plain = src.slice(i).match(/^[^<]+/);
      if (plain) {
        const t = plain[0].trim();
        if (t) blocks.push({ type: "p", text: t });
        i += plain[0].length;
        continue;
      }
      i++;
    }
    return blocks;
  }

  function isTutorialHtml(html) {
    if (/class="accordion-title"/i.test(html)) return false;
    const body = html.match(/<div\b[^>]*class="[^"]*main-content[^"]*"[^>]*>([\s\S]*)/i)
      || html.match(/<body[^>]*>([\s\S]*)/i);
    const chunk = body ? body[1] : html;
    const h2n = (chunk.match(/<h2\b/gi) || []).length;
    return h2n >= 2;
  }

  /**
   * Dedicated converter for tutorial-style HTML:
   * sidebar TOC + main-content with h2 chapters (e.g. SQL Server 编程教程).
   * Each h2 becomes one accordion section.
   */
  function parseTutorialHtml(html, forcedId) {
    const titleMatch = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)
      || html.match(/<title>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? stripTags(titleMatch[1]).replace(/\s+/g, " ") : "导入的HTML教程";

    let intro = "";
    const sub = html.match(/class="subtitle"[^>]*>([\s\S]*?)(?:<\/div>|<\/p>)/i);
    if (sub) intro = stripTags(sub[1]).replace(/\s+/g, " ").slice(0, 300);
    if (!intro) intro = title;

    let main = html;
    const mainM = html.match(/<div\b[^>]*class="[^"]*main-content[^"]*"[^>]*>/i);
    if (mainM) {
      const bal = extractBalanced(html, mainM.index, "div");
      if (bal) main = bal.inner;
    } else {
      const bm = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      if (bm) main = bm[1];
    }

    // drop sidebar if somehow included
    main = main.replace(/<aside[\s\S]*?<\/aside>/gi, "")
      .replace(/<div\b[^>]*class="[^"]*sidebar[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "");

    const sections = [];
    const h2Re = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;
    const heads = [];
    let m;
    while ((m = h2Re.exec(main))) {
      heads.push({ title: stripTags(m[1]).replace(/\s+/g, " "), start: m.index, end: h2Re.lastIndex });
    }

    for (let i = 0; i < heads.length; i++) {
      const end = i + 1 < heads.length ? heads[i + 1].start : main.length;
      const inner = main.slice(heads[i].end, end);
      let secTitle = heads[i].title;
      // strip leading "01" style nums already in title for badge
      let badge = String(i + 1);
      const numM = secTitle.match(/^(\d+)\s*/);
      if (numM) {
        badge = String(parseInt(numM[1], 10));
        // keep full title including number for clarity
      }
      if (/^目录$|^Contents$/i.test(secTitle)) continue;
      const blocks = tutorialSectionToBlocks(inner);
      if (!blocks.length) continue;
      sections.push({
        id: "s" + (sections.length + 1),
        title: secTitle,
        badge,
        blocks,
      });
    }

    // content before first h2 as intro enrichment
    if (heads.length) {
      const before = stripTags(main.slice(0, heads[0].start)).replace(/\s+/g, " ").trim();
      if (before && before.length > 20 && before.length < 400 && !intro.includes(before.slice(0, 40))) {
        intro = (intro + " · " + before).slice(0, 300);
      }
    }

    const id = forcedId || slugify(title, "html-" + Date.now().toString(36));
    return {
      id,
      title,
      intro,
      updated: new Date().toISOString(),
      sections: sections.length
        ? sections
        : [{ id: "s1", title, badge: "1", blocks: [{ type: "p", text: "未能按 h2 拆分章节，请检查 HTML 结构" }] }],
      desc: intro.slice(0, 80),
    };
  }

  function parseHtmlSmart(html, forcedId) {
    if (/class="accordion-title"/i.test(html)) return parseH5(html, forcedId);
    if (isTutorialHtml(html)) return parseTutorialHtml(html, forcedId);
    // fallback: try accordion, then tutorial
    const h5 = parseH5(html, forcedId);
    if (h5.sections.length > 1 || (h5.sections[0] && h5.sections[0].blocks[0]?.text !== "未能解析折叠结构")) {
      return h5;
    }
    return parseTutorialHtml(html, forcedId);
  }

  async function fileToPost(file, opts) {
    const text = await file.text();
    const name = file.name.toLowerCase();
    const mode = (opts && opts.mode) || "auto";
    if (mode === "tutorial-html" || mode === "html") {
      return parseTutorialHtml(text);
    }
    if (mode === "h5") return parseH5(text);
    if (mode === "md") return parseMd(text);
    if (name.endsWith(".md") || name.endsWith(".markdown") || name.endsWith(".txt")) {
      return parseMd(text);
    }
    if (name.endsWith(".html") || name.endsWith(".htm") || name.endsWith(".h5")) {
      return parseHtmlSmart(text);
    }
    if (text.trim().startsWith("<") || /accordion|main-content|<h2\b/i.test(text)) {
      return parseHtmlSmart(text);
    }
    return parseMd(text);
  }

  return {
    parseMd,
    parseH5,
    parseTutorialHtml,
    parseHtmlSmart,
    fileToPost,
    slugify,
    isTutorialHtml,
  };
})();
