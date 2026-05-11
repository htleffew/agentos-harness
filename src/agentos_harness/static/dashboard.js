let dashboardState = null;
let activeSection = "overview";
let activeFilter = "all";

const byId = (id) => document.getElementById(id);

function basePath() {
  const match = window.location.pathname.match(/^(\/codeeditor\/default\/(?:proxy|ports)\/\d+)(?:\/|$)/);
  return match ? match[1] : "";
}

function urlFor(path) {
  return `${basePath()}${path}`;
}

function signalLabel(signal) {
  if (signal === "healthy") return "Healthy";
  if (signal === "attention") return "Attention";
  if (signal === "blocked") return "Blocked";
  return "Optional";
}

async function copyText(value) {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(value);
  }
}

function section() {
  return dashboardState.sections.find((item) => item.id === activeSection) || dashboardState.sections[0];
}

function updateTop() {
  byId("repoName").textContent = dashboardState.workspace.display_name || "Repository";
  byId("branchName").textContent = dashboardState.workspace.git_branch || "no git branch";
  byId("scanTime").textContent = dashboardState.workspace.scanned_at || "not scanned";
  byId("verdictTitle").textContent = dashboardState.verdict.status;
  byId("verdictReason").textContent = dashboardState.verdict.reason;
  byId("nextCommand").textContent = dashboardState.verdict.next_command;
  byId("metricWiki").textContent = dashboardState.inventory.wiki_pages;
  byId("metricSkills").textContent = dashboardState.inventory.skills;
  byId("metricCommands").textContent = dashboardState.inventory.commands;
  byId("metricHooks").textContent = dashboardState.inventory.hooks;
  byId("metricProjects").textContent = dashboardState.inventory.projects;
  byId("metricMaintenance").textContent = dashboardState.inventory.maintenance_items;
}

function updateRail() {
  const rail = byId("sectionRail");
  rail.innerHTML = "";
  for (const item of dashboardState.sections) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = item.id === activeSection ? "active" : "";
    button.innerHTML = `<span class="dot ${item.signal}" aria-label="${signalLabel(item.signal)}"></span><span>${item.title}</span>`;
    button.addEventListener("click", () => {
      activeSection = item.id;
      render();
    });
    rail.appendChild(button);
  }
}

function updateTabs(item) {
  const tabs = byId("tabs");
  tabs.innerHTML = "";
  for (const label of item.tabs || []) {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "tab";
    button.setAttribute("aria-selected", label === "Summary" ? "true" : "false");
    button.textContent = label;
    tabs.appendChild(button);
  }
}

function filteredRows(item) {
  const query = byId("textSearch").value.trim().toLowerCase();
  return (item.rows || []).filter((row) => {
    const filterPass = activeFilter === "all" || row.signal === activeFilter;
    const haystack = `${row.kind} ${row.name} ${row.path} ${row.detail} ${row.action}`.toLowerCase();
    return filterPass && (!query || haystack.includes(query));
  });
}

function updateRows(item) {
  const rows = byId("rows");
  rows.innerHTML = "";
  const visible = filteredRows(item);
  byId("visibleCount").textContent = `${visible.length} rows`;
  for (const row of visible) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="dot ${row.signal}" aria-label="${signalLabel(row.signal)}"></span> ${signalLabel(row.signal)}</td>
      <td><strong>${row.name}</strong><div class="row-detail">${row.detail}</div></td>
      <td><code class="path-chip">${row.path}</code><br><button class="copy-path" type="button">Copy Path</button></td>
      <td>${row.action ? `<button class="copy-command" type="button">Copy Command</button><div class="row-detail">${row.action}</div>` : ""}</td>
    `;
    tr.querySelector(".copy-path").addEventListener("click", () => copyText(row.path));
    const command = tr.querySelector(".copy-command");
    if (command) command.addEventListener("click", () => copyText(row.action));
    rows.appendChild(tr);
  }
}

function render() {
  if (!dashboardState) return;
  updateTop();
  updateRail();
  const item = section();
  byId("sectionTitle").textContent = item.title;
  byId("sectionSummary").textContent = item.summary;
  updateTabs(item);
  updateRows(item);
}

async function loadState(url = "/api/state", options = {}) {
  const response = await fetch(urlFor(url), options);
  dashboardState = await response.json();
  render();
}

byId("copyCommand").addEventListener("click", () => copyText(byId("nextCommand").textContent));
byId("refreshScan").addEventListener("click", () => loadState("/api/refresh", { method: "POST" }));
byId("openSearch").addEventListener("click", () => byId("textSearch").focus());
byId("exportJson").addEventListener("click", () => window.open(urlFor("/api/export"), "_blank", "noopener"));
byId("textSearch").addEventListener("input", render);
document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    render();
  });
});

loadState();
