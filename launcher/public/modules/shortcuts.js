(function () {
  document.addEventListener("keydown", function (e) {
    var tag = document.activeElement && document.activeElement.tagName;
    var isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

    // Ctrl+Shift+R: Refresh
    if (e.ctrlKey && e.shiftKey && (e.key === "r" || e.key === "R")) {
      e.preventDefault();
      if (window.refreshAll) window.refreshAll();
      return;
    }

    // Ctrl+K: Focus on first chat input
    if (e.ctrlKey && (e.key === "k" || e.key === "K") && !isInput) {
      e.preventDefault();
      var firstInput = document.querySelector("[data-chat-input]");
      if (firstInput) firstInput.focus();
      return;
    }

    // Escape: Close dialog
    if (e.key === "Escape") {
      var dialog = document.querySelector("dialog[open]");
      if (dialog) dialog.close();
      return;
    }

    // Ctrl+B: Back up
    if (e.ctrlKey && (e.key === "b" || e.key === "B") && !isInput) {
      e.preventDefault();
      if (window.backupData) window.backupData();
      return;
    }

    // Ctrl+D: Diagnostics
    if (e.ctrlKey && (e.key === "d" || e.key === "D") && !isInput) {
      e.preventDefault();
      if (window.runDiagnostics) window.runDiagnostics();
      return;
    }
  });
})();
