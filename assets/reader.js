(function () {
  const THEME_KEY = "notes-h5-theme";
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    const btn = document.getElementById("theme-toggle");
    if (btn) btn.textContent = t === "dark" ? "☀️" : "🌙";
  }
  window.toggleTheme = function () {
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    const next = cur === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  };
  applyTheme(localStorage.getItem(THEME_KEY) || "dark");

  window.toggleSearch = function () {
    document.getElementById("search-box").classList.toggle("active");
    const input = document.getElementById("search-input");
    if (document.getElementById("search-box").classList.contains("active")) input.focus();
  };

  window.scrollToTop = function () {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  window.addEventListener("scroll", function () {
    const btn = document.getElementById("back-top");
    if (!btn) return;
    btn.classList.toggle("visible", window.scrollY > 300);
  });

  window.copyCode = function (btn) {
    const code = btn.parentElement.querySelector("code");
    const text = code.textContent;
    const done = () => {
      btn.textContent = "已复制";
      btn.classList.add("copied");
      setTimeout(() => { btn.textContent = "复制"; btn.classList.remove("copied"); }, 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallback(text, done));
    } else fallback(text, done);
  };
  function fallback(text, cb) {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta); if (cb) cb();
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function inlineFormat(text) {
    return esc(text).replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  }

  function renderBlocks(blocks) {
    if (!blocks || !blocks.length) return "";
    return blocks.map((b) => {
      const t = b.type || "p";
      if (t === "h3") return `<div class="subheading">${inlineFormat(b.text || "")}</div>`;
      if (t === "p") return `<p>${inlineFormat(b.text || "")}</p>`;
      if (t === "ul") {
        const items = (b.items || []).map((i) => `<li>${inlineFormat(i)}</li>`).join("");
        return `<ul class="ul">${items}</ul>`;
      }
      if (t === "code") {
        return `<div class="code-block"><button class="copy-btn" onclick="copyCode(this)">复制</button><pre><code>${esc(b.text || "")}</code></pre></div>`;
      }
      if (t === "tip" || t === "warning" || t === "info") {
        return `<div class="callout callout-${t}">${inlineFormat(b.text || "")}</div>`;
      }
      return `<p>${inlineFormat(b.text || "")}</p>`;
    }).join("");
  }

  window.renderAccordion = function (sections, mountId) {
    const mount = document.getElementById(mountId || "accordion");
    if (!mount) return;
    mount.innerHTML = (sections || []).map((sec, idx) => {
      const n = sec.badge || String(idx + 1);
      const body = renderBlocks(sec.blocks || []);
      return `<div class="accordion-item" data-title="${esc(sec.title || "")}">
        <div class="accordion-header" onclick="toggleAcc(this)">
          <div class="badge">${esc(n)}</div>
          <div class="accordion-title">${esc(sec.title || "")}</div>
          <div class="accordion-icon">▼</div>
        </div>
        <div class="accordion-content"><div class="accordion-content-clip"><div class="accordion-inner">${body}</div></div></div>
      </div>`;
    }).join("");
  };

  window.toggleAcc = function (header) {
    const item = header.parentElement;
    if (!item) return;
    const willOpen = !item.classList.contains("active");
    // 可选：同组只开一节，避免多节同时撑开造成错乱感
    const group = item.parentElement;
    if (group && willOpen) {
      group.querySelectorAll(".accordion-item.active").forEach((el) => {
        if (el !== item) el.classList.remove("active");
      });
    }
    item.classList.toggle("active", willOpen);
  };

  window.filterAccordion = function (q) {
    q = (q || "").trim().toLowerCase();
    document.querySelectorAll(".accordion-item").forEach((el) => {
      const title = (el.getAttribute("data-title") || "").toLowerCase();
      const text = el.textContent.toLowerCase();
      el.classList.toggle("hidden", q && !(title.includes(q) || text.includes(q)));
    });
  };

  window.loadJSON = async function (url) {
    const res = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now());
    if (!res.ok) throw new Error("加载失败: " + url);
    return res.json();
  };
})();
