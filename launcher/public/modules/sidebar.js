;(function () {
  "use strict";

  var sidebar = document.getElementById("sidebar");
  var toggle = document.getElementById("menuToggle");
  var menuItems = sidebar && sidebar.querySelectorAll(".sidebar-menu li");
  var activePanel = "chat";

  function switchPanel(panelId) {
    if (!panelId || panelId === activePanel) return;
    activePanel = panelId;

    for (var i = 0; i < menuItems.length; i++) {
      var item = menuItems[i];
      var isActive = item.dataset.panel === panelId;
      item.classList.toggle("active", isActive);
    }

    var wraps = document.querySelectorAll("#workContent .panel-wrap");
    for (var j = 0; j < wraps.length; j++) {
      wraps[j].classList.toggle("active", wraps[j].id === "panel-" + panelId);
    }

    if (window.onPanelSwitch) window.onPanelSwitch(panelId);
  }

  function toggleSidebar() {
    sidebar.classList.toggle("expanded");
    sidebar.classList.toggle("collapsed");
  }

  function init() {
    if (!sidebar) return;

    if (toggle) {
      toggle.addEventListener("click", toggleSidebar);
    }

    for (var i = 0; i < menuItems.length; i++) {
      (function (item) {
        item.addEventListener("click", function () {
          switchPanel(item.dataset.panel);
        });
      })(menuItems[i]);
    }

    var saved = localStorage.getItem("sidebarState");
    if (saved === "collapsed") {
      sidebar.classList.remove("expanded");
      sidebar.classList.add("collapsed");
    }
  }

  window.switchPanel = switchPanel;
  window.toggleSidebar = toggleSidebar;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
