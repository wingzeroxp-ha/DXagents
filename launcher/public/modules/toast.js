(function () {
  let container = document.getElementById("toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    document.body.appendChild(container);
  }

  window.showToast = function (message, type, duration) {
    type = type || "info";
    duration = duration || 4000;
    const toast = document.createElement("div");
    toast.className = "toast " + type;
    const iconMap = { success: "✓", error: "✕", warn: "⚠", info: "ℹ" };
    toast.innerHTML =
      '<span class="toast-icon">' +
      (iconMap[type] || "ℹ") +
      '</span><span class="toast-text">' +
      String(message).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") +
      "</span>";
    container.appendChild(toast);
    setTimeout(function () {
      toast.classList.add("toast-hide");
      setTimeout(function () { toast.remove(); }, 300);
    }, duration);
  };
})();
