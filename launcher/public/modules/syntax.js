(function () {
  const LANG_MAP = {
    js: "javascript", javascript: "javascript", ts: "typescript", typescript: "typescript",
    py: "python", python: "python", go: "go", golang: "go",
    rs: "rust", rust: "rust", java: "java", c: "c", cpp: "cpp", cs: "csharp",
    html: "html", css: "css", json: "json", xml: "xml", yaml: "yaml", yml: "yaml",
    md: "markdown", markdown: "markdown", sh: "bash", bash: "bash", zsh: "bash",
    sql: "sql", ruby: "ruby", rb: "ruby", php: "php", swift: "swift",
    kt: "kotlin", kotlin: "kotlin", scala: "scala", groovy: "groovy",
    diff: "diff", dockerfile: "dockerfile", docker: "dockerfile",
    makefile: "makefile", make: "makefile",
  };

  function detectLang(codeBlock) {
    var match = codeBlock.match(/^```(\w+)/);
    if (match) return LANG_MAP[match[1].toLowerCase()] || match[1];
    return "";
  }

  function escapeHtml(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function highlightInline(text) {
    return String(text).replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  }

  function highlightCode(text) {
    // Auto-detect and convert ```code blocks``` to highlighted HTML
    return String(text).replace(/```(\w*)\n?([\s\S]*?)```/g, function (_, lang, code) {
      var langName = LANG_MAP[lang.toLowerCase()] || lang || "text";
      return (
        '<div class="code-block" data-lang="' +
        escapeHtml(lang || "text") +
        '">' +
        '<div class="code-header">' +
        '<span class="code-lang">' +
        escapeHtml(lang || "code") +
        '</span>' +
        '<button class="code-copy" onclick="copyCode(this)">复制</button>' +
        "</div>" +
        '<pre><code class="hljs lang-' +
        escapeHtml(langName) +
        '">' +
        escapeHtml(code.replace(/^\n/, "")) +
        "</code></pre>" +
        "</div>"
      );
    });
  }

  function renderContent(text) {
    text = String(text || "");
    var hasCodeBlock = /```/.test(text);
    if (hasCodeBlock) {
      return highlightCode(text);
    }
    return highlightInline(text);
  }

  window.copyCode = function (btn) {
    var block = btn.closest(".code-block");
    var code = block ? block.querySelector("code") : null;
    if (!code) return;
    var text = code.textContent || "";
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function () {
        btn.textContent = "已复制";
        setTimeout(function () { btn.textContent = "复制"; }, 2000);
      });
    }
  };

  window.renderContent = renderContent;
  window.syntaxHighlight = { renderContent: renderContent, escapeHtml: escapeHtml, highlightCode: highlightCode };
})();
