const STORAGE_KEY = "ceradon-mesh-state-v0.1";
const ROLE_DEFAULTS = {
  controller: { baseRange: 400, color: "var(--controller)" },
  relay: { baseRange: 350, color: "var(--relay)" },
  uxs: { baseRange: 600, color: "var(--uxs)" },
  sensor: { baseRange: 250, color: "var(--sensor)" },
  client: { baseRange: 150, color: "var(--client)" }
};

const BAND_FACTOR = {
  "900": 1.3,
  "1.2": 1.1,
  "2.4": 1.0,
  "5.8": 0.8,
  other: 1.0
};

const TERRAIN_MULTIPLIER = {
  Indoor: 0.5,
  "Dense urban": 0.6,
  Urban: 0.7,
  Suburban: 0.85,
  Rural: 1.0,
  Open: 1.2
};

const EW_MULTIPLIER = {
  Low: 1.0,
  Medium: 0.85,
  High: 0.7,
  Severe: 0.5
};

const meshState = {
  environment: {
    terrain: "Urban",
    ewLevel: "Medium",
    primaryBand: "2.4",
    designRadiusMeters: 300,
    targetReliability: 80
  },
  nodes: [],
  links: []
};

let selectedNodeId = null;
let dragInfo = null;

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(meshState));
}

function loadState() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      Object.assign(meshState.environment, parsed.environment || {});
      meshState.nodes = parsed.nodes || [];
      meshState.links = parsed.links || [];
    } catch (e) {
      console.warn("Failed to parse stored mesh", e);
    }
  }
}

function generateId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 7)}`;
}

function createNode(role) {
  const defaults = ROLE_DEFAULTS[role];
  const count = meshState.nodes.filter(n => n.role === role).length + 1;
  const label = `${role === "client" ? "Client" : role.charAt(0).toUpperCase() + role.slice(1)} ${count}`;
  const band = meshState.environment.primaryBand;
  return {
    id: generateId(role),
    label,
    role,
    band,
    maxRangeMeters: defaults?.baseRange || 200,
    x: Math.random() * 0.6 + 0.2,
    y: Math.random() * 0.6 + 0.2,
    source: "manual"
  };
}

function nodeColor(node) {
  return ROLE_DEFAULTS[node.role]?.color || "var(--client)";
}

function attachEnvironmentHandlers() {
  const terrain = document.getElementById("terrain-select");
  const ew = document.getElementById("ew-select");
  const band = document.getElementById("band-select");
  const designRadius = document.getElementById("design-radius");
  const reliability = document.getElementById("target-reliability");

  terrain.value = meshState.environment.terrain;
  ew.value = meshState.environment.ewLevel;
  band.value = meshState.environment.primaryBand;
  designRadius.value = meshState.environment.designRadiusMeters;
  reliability.value = meshState.environment.targetReliability;

  terrain.addEventListener("change", () => {
    meshState.environment.terrain = terrain.value;
    recompute();
  });
  ew.addEventListener("change", () => {
    meshState.environment.ewLevel = ew.value;
    recompute();
  });
  band.addEventListener("change", () => {
    meshState.environment.primaryBand = band.value;
    recompute();
  });
  designRadius.addEventListener("input", () => {
    meshState.environment.designRadiusMeters = Number(designRadius.value) || 300;
    recompute();
  });
  reliability.addEventListener("input", () => {
    meshState.environment.targetReliability = Number(reliability.value) || 80;
    renderCoverageHints();
    saveState();
  });
}

function attachNodeButtons() {
  document.querySelectorAll(".add-node").forEach(btn => {
    btn.addEventListener("click", () => {
      const role = btn.getAttribute("data-node-role");
      const node = createNode(role);
      meshState.nodes.push(node);
      recompute();
      focusNode(node.id);
    });
  });
}

function clearCanvas() {
  const svg = document.getElementById("mesh-canvas");
  while (svg.firstChild) svg.removeChild(svg.firstChild);
}

function scaleToCanvas(value) {
  return value * 1000;
}

function computeDistanceMeters(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const normalized = Math.sqrt(dx * dx + dy * dy);
  return normalized * meshState.environment.designRadiusMeters * 2;
}

function effectiveRange(node) {
  const bandFactor = BAND_FACTOR[node.band] ?? 1;
  const terrain = TERRAIN_MULTIPLIER[meshState.environment.terrain] ?? 1;
  const ew = EW_MULTIPLIER[meshState.environment.ewLevel] ?? 1;
  return node.maxRangeMeters * bandFactor * terrain * ew;
}

function recomputeLinks() {
  const links = [];
  for (let i = 0; i < meshState.nodes.length; i++) {
    for (let j = i + 1; j < meshState.nodes.length; j++) {
      const a = meshState.nodes[i];
      const b = meshState.nodes[j];
      const distance = computeDistanceMeters(a, b);
      const range = Math.min(effectiveRange(a), effectiveRange(b));
      let quality = "none";
      if (distance <= 0.4 * range) quality = "good";
      else if (distance <= 0.8 * range) quality = "marginal";
      else if (distance <= 1.2 * range) quality = "fragile";

      links.push({
        fromId: a.id,
        toId: b.id,
        distanceMeters: Math.round(distance),
        quality
      });
    }
  }
  meshState.links = links;
}

function renderLinks(svg) {
  meshState.links.forEach(link => {
    const from = meshState.nodes.find(n => n.id === link.fromId);
    const to = meshState.nodes.find(n => n.id === link.toId);
    if (!from || !to) return;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", scaleToCanvas(from.x));
    line.setAttribute("y1", scaleToCanvas(from.y));
    line.setAttribute("x2", scaleToCanvas(to.x));
    line.setAttribute("y2", scaleToCanvas(to.y));
    line.setAttribute("class", "link-line");
    const stroke = link.quality === "good" ? "var(--good)" : link.quality === "marginal" ? "var(--marginal)" : link.quality === "fragile" ? "var(--fragile)" : "var(--none)";
    line.setAttribute("stroke", stroke);
    line.setAttribute("stroke-dasharray", link.quality === "none" ? "6 6" : "");
    svg.appendChild(line);
  });
}

function renderNodes(svg) {
  meshState.nodes.forEach(node => {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("data-node-id", node.id);

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", scaleToCanvas(node.x));
    circle.setAttribute("cy", scaleToCanvas(node.y));
    circle.setAttribute("r", 16);
    circle.setAttribute("fill", nodeColor(node));
    circle.setAttribute("class", "node-circle");
    circle.addEventListener("mousedown", startDrag);
    circle.addEventListener("click", () => focusNode(node.id));

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", scaleToCanvas(node.x));
    label.setAttribute("y", scaleToCanvas(node.y) - 22);
    label.setAttribute("class", "node-label");
    label.textContent = `${node.label} (${node.band} GHz)`;

    group.appendChild(circle);
    group.appendChild(label);
    svg.appendChild(group);
  });
}

function renderLinkSummary() {
  const tbody = document.getElementById("link-summary-body");
  tbody.innerHTML = "";
  meshState.links.forEach(link => {
    const tr = document.createElement("tr");
    const from = meshState.nodes.find(n => n.id === link.fromId);
    const to = meshState.nodes.find(n => n.id === link.toId);
    const cells = [from?.label || link.fromId, to?.label || link.toId, link.distanceMeters, link.quality];
    cells.forEach(value => {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function renderRecommendations() {
  const p = document.getElementById("recommendations");
  const relayCount = meshState.nodes.filter(n => n.role === "relay" || n.role === "uxs").length;
  const controllers = meshState.nodes.filter(n => n.role === "controller").length;
  const fragile = meshState.links.filter(l => l.quality === "fragile").length;
  const none = meshState.links.filter(l => l.quality === "none").length;

  let text = `Relays: ${relayCount}. Controllers/Gateways: ${controllers}. `;
  if (none > 0) {
    text += "Disconnected nodes detected; add relays to span the gap.";
  } else if (fragile > meshState.links.length * 0.3) {
    text += "Outer edges show fragile links; consider another relay or higher band gain.";
  } else {
    text += "Coverage appears adequate for the central area; monitor perimeter spacing.";
  }
  p.textContent = text;
}

function renderCoverageHints() {
  const list = document.getElementById("coverage-hints");
  list.innerHTML = "";
  const target = meshState.environment.targetReliability;
  const hintItems = [];

  meshState.nodes.forEach(node => {
    const links = meshState.links.filter(l => l.fromId === node.id || l.toId === node.id);
    const goodLinks = links.filter(l => l.quality === "good");
    if (links.length === 0 || goodLinks.length === 0) {
      hintItems.push(`${node.label} has no strong links; reposition or add relays.`);
    }
  });

  const marginalShare = meshState.links.filter(l => l.quality === "marginal").length / (meshState.links.length || 1);
  if (marginalShare > (100 - target) / 100) {
    hintItems.push("Average link quality is below the desired reliability; tighten spacing or adjust terrain assumptions.");
  }

  if (hintItems.length === 0) hintItems.push("No major blind spots detected at current layout.");

  hintItems.forEach(text => {
    const li = document.createElement("li");
    li.textContent = text;
    list.appendChild(li);
  });
}

function renderNodeDetails() {
  const container = document.getElementById("node-detail-content");
  if (!selectedNodeId) {
    container.textContent = "Select a node to edit its details.";
    return;
  }
  const node = meshState.nodes.find(n => n.id === selectedNodeId);
  if (!node) return;

  container.innerHTML = "";
  const labelInput = document.createElement("input");
  labelInput.value = node.label;
  const roleSelect = document.createElement("select");
  ["controller", "relay", "uxs", "sensor", "client"].forEach(role => {
    const option = document.createElement("option");
    option.value = role;
    option.textContent = role;
    if (role === node.role) option.selected = true;
    roleSelect.appendChild(option);
  });

  const bandSelect = document.createElement("select");
  ["900", "1.2", "2.4", "5.8", "other"].forEach(b => {
    const option = document.createElement("option");
    option.value = b;
    option.textContent = b === "other" ? "Other" : `${b} GHz`;
    if (b === node.band) option.selected = true;
    bandSelect.appendChild(option);
  });

  const rangeInput = document.createElement("input");
  rangeInput.type = "number";
  rangeInput.value = node.maxRangeMeters;
  rangeInput.min = 50;
  rangeInput.step = 10;

  [labelInput, roleSelect, bandSelect, rangeInput].forEach(el => {
    el.addEventListener("input", () => {
      node.label = labelInput.value;
      node.role = roleSelect.value;
      node.band = bandSelect.value;
      node.maxRangeMeters = Number(rangeInput.value) || node.maxRangeMeters;
      recompute();
    });
  });

  container.appendChild(createLabeledField("Label", labelInput));
  container.appendChild(createLabeledField("Role", roleSelect));
  container.appendChild(createLabeledField("Band", bandSelect));
  container.appendChild(createLabeledField("Max range (m)", rangeInput));
}

function createLabeledField(label, element) {
  const wrapper = document.createElement("div");
  const lab = document.createElement("label");
  lab.textContent = label;
  wrapper.appendChild(lab);
  wrapper.appendChild(element);
  return wrapper;
}

function focusNode(nodeId) {
  selectedNodeId = nodeId;
  renderNodeDetails();
}

function startDrag(evt) {
  const svg = document.getElementById("mesh-canvas");
  const rect = svg.getBoundingClientRect();
  const nodeId = evt.target.parentNode.getAttribute("data-node-id");
  dragInfo = { nodeId, offsetX: rect.left, offsetY: rect.top, width: rect.width, height: rect.height };
  document.addEventListener("mousemove", onDrag);
  document.addEventListener("mouseup", endDrag);
}

function onDrag(evt) {
  if (!dragInfo) return;
  const { nodeId, offsetX, offsetY, width, height } = dragInfo;
  const node = meshState.nodes.find(n => n.id === nodeId);
  if (!node) return;
  const x = (evt.clientX - offsetX) / width;
  const y = (evt.clientY - offsetY) / height;
  node.x = Math.max(0.05, Math.min(0.95, x));
  node.y = Math.max(0.05, Math.min(0.95, y));
  recompute(false);
}

function endDrag() {
  dragInfo = null;
  document.removeEventListener("mousemove", onDrag);
  document.removeEventListener("mouseup", endDrag);
  saveState();
}

function recompute(save = true) {
  recomputeLinks();
  render();
  if (save) saveState();
}

function render() {
  clearCanvas();
  const svg = document.getElementById("mesh-canvas");
  renderLinks(svg);
  renderNodes(svg);
  renderLinkSummary();
  renderRecommendations();
  renderCoverageHints();
  renderNodeDetails();
}

function exportMesh() {
  const payload = {
    meshVersion: "0.1",
    environment: meshState.environment,
    nodes: meshState.nodes,
    links: meshState.links
  };
  const area = document.getElementById("json-area");
  area.value = JSON.stringify(payload, null, 2);
}

function downloadMesh() {
  const blob = new Blob([JSON.stringify({
    meshVersion: "0.1",
    environment: meshState.environment,
    nodes: meshState.nodes,
    links: meshState.links
  }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "ceradon-mesh.json";
  a.click();
  URL.revokeObjectURL(url);
}

function layoutNodes(nodes) {
  const count = nodes.length;
  const radius = 0.35;
  nodes.forEach((node, idx) => {
    const angle = (idx / count) * 2 * Math.PI;
    node.x = 0.5 + radius * Math.cos(angle);
    node.y = 0.5 + radius * Math.sin(angle);
  });
}

function importJson() {
  const text = document.getElementById("json-area").value;
  if (!text.trim()) return;
  try {
    const parsed = JSON.parse(text);
    if (parsed.meshVersion) {
      meshState.environment = { ...meshState.environment, ...(parsed.environment || {}) };
      meshState.nodes = (parsed.nodes || []).map(n => ({ ...n, x: n.x ?? Math.random(), y: n.y ?? Math.random() }));
    } else if (parsed.source === "NodeArchitect") {
      meshState.nodes = (parsed.nodes || []).map(n => ({
        id: n.id || generateId("node"),
        label: n.label || n.id || "Node",
        role: n.role || "sensor",
        band: String(n.band || meshState.environment.primaryBand),
        maxRangeMeters: n.approxRangeMeters || ROLE_DEFAULTS[n.role]?.baseRange || 200,
        x: Math.random() * 0.8 + 0.1,
        y: Math.random() * 0.8 + 0.1,
        source: "nodeArchitect"
      }));
    } else if (parsed.source === "UxSArchitect") {
      meshState.nodes = (parsed.uxsPlatforms || []).map(n => ({
        id: n.id || generateId("uxs"),
        label: n.label || n.id || "UxS",
        role: n.role || "uxs",
        band: String(n.band || meshState.environment.primaryBand),
        maxRangeMeters: n.maxRangeMeters || ROLE_DEFAULTS[n.role]?.baseRange || 400,
        x: Math.random() * 0.8 + 0.1,
        y: Math.random() * 0.8 + 0.1,
        source: "uxsArchitect",
        attachedPlatformId: n.attachedPlatformId
      }));
    }
    if (meshState.nodes.length) layoutNodes(meshState.nodes);
    recompute();
  } catch (e) {
    alert("Invalid JSON provided.");
  }
}

function loadDemo() {
  if (!window.demoScenario) return;
  meshState.environment = { ...meshState.environment, ...demoScenario.environment };
  meshState.nodes = demoScenario.nodes.map(n => ({
    ...n,
    x: Math.random() * 0.8 + 0.1,
    y: Math.random() * 0.8 + 0.1,
    source: "demo"
  }));
  layoutNodes(meshState.nodes);
  recompute();
}

function attachImportExport() {
  document.getElementById("export-btn").addEventListener("click", exportMesh);
  document.getElementById("download-btn").addEventListener("click", downloadMesh);
  document.getElementById("import-btn").addEventListener("click", importJson);
  document.getElementById("load-demo-btn").addEventListener("click", loadDemo);
}

function init() {
  loadState();
  attachEnvironmentHandlers();
  attachNodeButtons();
  attachImportExport();
  if (!meshState.nodes.length) saveState();
  recompute(false);
}

document.addEventListener("DOMContentLoaded", init);
