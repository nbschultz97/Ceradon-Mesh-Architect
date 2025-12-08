const STORAGE_KEY = "ceradon-mesh-state-v0.2";
const ROLE_DEFAULTS = {
  controller: { baseRange: 450, color: "var(--controller)" },
  relay: { baseRange: 380, color: "var(--relay)" },
  uxs: { baseRange: 650, color: "var(--uxs)" },
  sensor: { baseRange: 260, color: "var(--sensor)" },
  client: { baseRange: 180, color: "var(--client)" }
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

const mapDefaults = {
  center: { lat: 40.76078, lng: -111.89105 },
  zoom: 17
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
let map;
let linkLayers = [];
let markerMap = new Map();
let coverageCircle = null;
let placementRole = null;

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(meshState));
}

function loadState() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      Object.assign(meshState.environment, parsed.environment || {});
      meshState.nodes = (parsed.nodes || []).map(ensureLatLng);
      meshState.links = parsed.links || [];
    } catch (e) {
      console.warn("Failed to parse stored mesh", e);
    }
  }
}

function restoreLastSession() {
  loadState();
  recompute(false);
}

function generateId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 7)}`;
}

function createNode(role, latlng) {
  const defaults = ROLE_DEFAULTS[role];
  const count = meshState.nodes.filter(n => n.role === role).length + 1;
  const label = `${role === "client" ? "Client" : role.charAt(0).toUpperCase() + role.slice(1)} ${count}`;
  const band = meshState.environment.primaryBand;
  const base = latlng || offsetFromCenter();
  return {
    id: generateId(role),
    label,
    role,
    band,
    maxRangeMeters: defaults?.baseRange || 200,
    lat: base.lat,
    lng: base.lng,
    altitudeMeters: role === "uxs" ? 100 : undefined,
    source: "manual"
  };
}

function offsetFromCenter() {
  const center = map?.getCenter() || L.latLng(mapDefaults.center);
  const latOffset = (Math.random() - 0.5) * 0.002;
  const lngOffset = (Math.random() - 0.5) * 0.002;
  return { lat: center.lat + latOffset, lng: center.lng + lngOffset };
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
    renderOutputs();
    saveState();
  });
}

function attachNodeButtons() {
  document.querySelectorAll(".add-node").forEach(btn => {
    btn.addEventListener("click", () => {
      placementRole = btn.getAttribute("data-node-role");
      document.getElementById("placement-hint").textContent = `Click on the map to place a ${placementRole}.`;
    });
  });
}

function attachMapHandlers() {
  map = L.map("mesh-map").setView([mapDefaults.center.lat, mapDefaults.center.lng], mapDefaults.zoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  map.on("click", evt => {
    if (!placementRole) return;
    const node = createNode(placementRole, evt.latlng);
    placementRole = null;
    document.getElementById("placement-hint").textContent = "";
    meshState.nodes.push(node);
    recompute();
    focusNode(node.id);
  });
}

function markerIcon(role, selected) {
  return L.divIcon({
    className: `node-marker node-${role}${selected ? " selected" : ""}`,
    iconSize: [18, 18]
  });
}

function clearMarkers() {
  markerMap.forEach(marker => marker.remove());
  markerMap.clear();
}

function computeDistanceMeters(a, b) {
  if (!map) return 0;
  return Math.round(map.distance([a.lat, a.lng], [b.lat, b.lng]));
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
        distanceMeters: distance,
        quality
      });
    }
  }
  meshState.links = links;
}

function renderCoverageCircle() {
  const primary = meshState.nodes.find(n => n.role === "controller");
  if (!map) return;
  if (coverageCircle) coverageCircle.remove();
  if (!primary) return;
  coverageCircle = L.circle([primary.lat, primary.lng], {
    radius: meshState.environment.designRadiusMeters,
    color: "#3a7bd5",
    fillColor: "#3a7bd5",
    fillOpacity: 0.12,
    weight: 1.2
  }).addTo(map);
}

function renderLinks() {
  linkLayers.forEach(line => line.remove());
  linkLayers = [];
  meshState.links.forEach(link => {
    const from = meshState.nodes.find(n => n.id === link.fromId);
    const to = meshState.nodes.find(n => n.id === link.toId);
    if (!from || !to) return;
    if (link.quality === "none") return;
    const color = link.quality === "good" ? "#3ac177" : link.quality === "marginal" ? "#f2c14e" : "#f07f3c";
    const weight = link.quality === "fragile" ? 2 : 3;
    const poly = L.polyline(
      [
        [from.lat, from.lng],
        [to.lat, to.lng]
      ],
      {
        color,
        weight,
        opacity: 0.9
      }
    ).addTo(map);
    linkLayers.push(poly);
  });
}

function renderNodes() {
  clearMarkers();
  meshState.nodes.forEach(node => {
    const marker = L.marker([node.lat, node.lng], {
      draggable: true,
      icon: markerIcon(node.role, node.id === selectedNodeId)
    }).addTo(map);

    marker.on("click", () => focusNode(node.id));
    marker.on("dragend", e => {
      const pos = e.target.getLatLng();
      node.lat = pos.lat;
      node.lng = pos.lng;
      recompute();
    });

    marker.bindPopup(`<strong>${node.label}</strong><br/>${node.role} • ${node.band} GHz`);
    markerMap.set(node.id, marker);
  });
}

function renderLinkSummary() {
  const tbody = document.getElementById("link-summary-body");
  tbody.innerHTML = "";
  const qualityRank = { none: 3, fragile: 2, marginal: 1, good: 0 };
  const sorted = [...meshState.links].sort((a, b) => {
    const qa = qualityRank[a.quality];
    const qb = qualityRank[b.quality];
    if (qa === qb) return b.distanceMeters - a.distanceMeters;
    return qb - qa;
  });

  sorted.forEach(link => {
    const tr = document.createElement("tr");
    const from = meshState.nodes.find(n => n.id === link.fromId);
    const to = meshState.nodes.find(n => n.id === link.toId);
    const cells = [from?.label || link.fromId, to?.label || link.toId, Math.round(link.distanceMeters), link.quality];
    cells.forEach((value, idx) => {
      const td = document.createElement("td");
      if (idx === 3) {
        td.textContent = value;
        td.className = `quality-${value}`;
      } else {
        td.textContent = value;
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function renderRecommendations() {
  const p = document.getElementById("recommendations");
  const relayCount = meshState.nodes.filter(n => n.role === "relay" || n.role === "uxs").length;
  const controllers = meshState.nodes.filter(n => n.role === "controller").length;
  const marginalOrBetter = meshState.links.filter(l => l.quality === "good" || l.quality === "marginal");
  const isolated = meshState.links.filter(l => l.quality !== "good" && l.quality !== "marginal").length;
  let text = `Relays: ${relayCount}. Controllers/Gateways: ${controllers}. `;
  if (meshState.environment.ewLevel === "High" || meshState.environment.ewLevel === "Severe") {
    text += "High EW: prioritize redundancy and frequency diversity. ";
  }
  if (!marginalOrBetter.length && meshState.nodes.length > 1) {
    text += "Isolated nodes detected. Add a relay to stitch the mesh.";
  } else if (isolated > meshState.links.length * 0.3) {
    text += "Large coverage gaps; add perimeter relays or tighten spacing.";
  } else {
    text += "Core mesh is stable; evaluate edge clients for resiliency.";
  }
  p.textContent = text;
}

function renderCoverageHints() {
  const list = document.getElementById("coverage-hints");
  list.innerHTML = "";
  const target = meshState.environment.targetReliability / 100;
  const hints = [];

  meshState.nodes.forEach(node => {
    const links = meshState.links.filter(l => l.fromId === node.id || l.toId === node.id);
    const good = links.filter(l => l.quality === "good" || l.quality === "marginal");
    if (links.length === 0 || good.length === 0) {
      hints.push(`${node.label} is isolated; add a relay within ~${Math.round(node.maxRangeMeters * 0.5)} m.`);
    }
  });

  const avgRatio = meshState.links.reduce((sum, l) => {
    const a = meshState.nodes.find(n => n.id === l.fromId);
    const b = meshState.nodes.find(n => n.id === l.toId);
    const range = Math.min(effectiveRange(a || {}), effectiveRange(b || {})) || 1;
    return sum + l.distanceMeters / range;
  }, 0) / (meshState.links.length || 1);

  if (avgRatio > 0.8) {
    hints.push("Most links are near range limits; tighten spacing or add relays.");
  }

  if (!hints.length) hints.push("No major blind spots detected at current layout.");

  hints.forEach(text => {
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

  const altitudeInput = document.createElement("input");
  altitudeInput.type = "number";
  altitudeInput.value = node.altitudeMeters ?? "";
  altitudeInput.placeholder = "Optional (meters)";
  altitudeInput.step = 10;

  [labelInput, roleSelect, bandSelect, rangeInput, altitudeInput].forEach(el => {
    el.addEventListener("input", () => {
      node.label = labelInput.value;
      node.role = roleSelect.value;
      node.band = bandSelect.value;
      node.maxRangeMeters = Number(rangeInput.value) || node.maxRangeMeters;
      node.altitudeMeters = altitudeInput.value ? Number(altitudeInput.value) : undefined;
      const marker = markerMap.get(node.id);
      if (marker) marker.setIcon(markerIcon(node.role, node.id === selectedNodeId));
      recompute();
    });
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.textContent = "Delete selected node";
  deleteBtn.addEventListener("click", () => {
    meshState.nodes = meshState.nodes.filter(n => n.id !== node.id);
    selectedNodeId = null;
    recompute();
  });

  container.appendChild(createLabeledField("Label", labelInput));
  container.appendChild(createLabeledField("Role", roleSelect));
  container.appendChild(createLabeledField("Band", bandSelect));
  container.appendChild(createLabeledField("Max range (m)", rangeInput));
  container.appendChild(createLabeledField("Altitude (m, optional)", altitudeInput));
  container.appendChild(deleteBtn);
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
  markerMap.forEach((marker, id) => {
    const node = meshState.nodes.find(n => n.id === id);
    marker.setIcon(markerIcon(node?.role || "client", id === selectedNodeId));
  });
  renderNodeDetails();
}

function recompute(save = true) {
  recomputeLinks();
  render();
  if (save) saveState();
}

function renderMeshSummary() {
  const summaryText = document.getElementById("mesh-health");
  const counts = document.getElementById("mesh-counts");
  const totals = meshState.nodes.reduce((acc, node) => {
    acc[node.role] = (acc[node.role] || 0) + 1;
    return acc;
  }, {});
  const qualityCounts = meshState.links.reduce(
    (acc, link) => {
      acc[link.quality] = (acc[link.quality] || 0) + 1;
      return acc;
    },
    { good: 0, marginal: 0, fragile: 0, none: 0 }
  );
  const totalLinks = meshState.links.length || 1;
  const goodShare = (qualityCounts.good + qualityCounts.marginal) / totalLinks;
  const health = goodShare >= 0.7 ? "Robust" : goodShare >= 0.4 ? "Marginal" : "Fragile";
  summaryText.textContent = meshState.nodes.length ? `Network is ${health} under current assumptions.` : "Network is waiting for nodes.";
  counts.textContent = `Ctrl ${totals.controller || 0} • Relays ${totals.relay || 0} • UxS ${totals.uxs || 0} • Sensors ${totals.sensor || 0} • Clients ${totals.client || 0} | Links G:${qualityCounts.good} M:${qualityCounts.marginal} F:${qualityCounts.fragile}`;
}

function renderOutputs() {
  renderLinkSummary();
  renderRecommendations();
  renderCoverageHints();
  renderNodeDetails();
  renderMeshSummary();
}

function render() {
  renderLinks();
  renderNodes();
  renderCoverageCircle();
  renderOutputs();
}

function exportMesh() {
  const payload = {
    meshVersion: "0.2",
    environment: meshState.environment,
    nodes: meshState.nodes,
    links: meshState.links
  };
  const area = document.getElementById("json-area");
  area.value = JSON.stringify(payload, null, 2);
}

function downloadMesh() {
  const now = new Date();
  const filename = `mesh-architect-export-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}.json`;
  const blob = new Blob([JSON.stringify({
    meshVersion: "0.2",
    environment: meshState.environment,
    nodes: meshState.nodes,
    links: meshState.links
  }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function importJson(text) {
  if (!text.trim()) return;
  try {
    const parsed = JSON.parse(text);
    if (parsed.meshVersion) {
      meshState.environment = { ...meshState.environment, ...(parsed.environment || {}) };
      meshState.nodes = (parsed.nodes || []).map(ensureLatLng);
    } else if (parsed.source === "NodeArchitect") {
      meshState.nodes = (parsed.nodes || []).map(n => ensureLatLng({
        id: n.id || generateId("node"),
        label: n.label || n.id || "Node",
        role: n.role || "sensor",
        band: String(n.band || meshState.environment.primaryBand),
        maxRangeMeters: n.approxRangeMeters || ROLE_DEFAULTS[n.role]?.baseRange || 200,
        x: n.x,
        y: n.y,
        source: "nodeArchitect"
      }));
    } else if (parsed.source === "UxSArchitect") {
      meshState.nodes = (parsed.uxsPlatforms || []).map(n => ensureLatLng({
        id: n.id || generateId("uxs"),
        label: n.label || n.id || "UxS",
        role: n.role || "uxs",
        band: String(n.band || meshState.environment.primaryBand),
        maxRangeMeters: n.maxRangeMeters || ROLE_DEFAULTS[n.role]?.baseRange || 400,
        x: n.x,
        y: n.y,
        source: "uxsArchitect",
        attachedPlatformId: n.attachedPlatformId
      }));
    }
    recompute();
  } catch (e) {
    alert("Invalid JSON provided.");
  }
}

function handleImport() {
  const text = document.getElementById("json-area").value;
  importJson(text);
}

function handleFileImport(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    importJson(e.target.result);
  };
  reader.onerror = () => alert("Failed to read file");
  reader.readAsText(file);
}

function layoutNodes(nodes) {
  const count = nodes.length || 1;
  const center = map?.getCenter() || mapDefaults.center;
  const radiusLat = 0.0015;
  nodes.forEach((node, idx) => {
    if (node.lat && node.lng) return;
    const angle = (idx / count) * 2 * Math.PI;
    node.lat = center.lat + radiusLat * Math.cos(angle);
    node.lng = center.lng + radiusLat * Math.sin(angle);
  });
}

function ensureLatLng(node) {
  if (node.lat != null && node.lng != null) return node;
  const center = map?.getCenter() || mapDefaults.center;
  const span = 0.002;
  const mappedLat = center.lat + ((node.y ?? Math.random()) - 0.5) * span;
  const mappedLng = center.lng + ((node.x ?? Math.random()) - 0.5) * span;
  return { ...node, lat: mappedLat, lng: mappedLng };
}

function loadDemo() {
  const presetSelect = document.getElementById("preset-select");
  const selected = presetSelect.value;
  const scenario = presetScenarios.find(s => s.id === selected);
  if (!scenario) {
    meshState.nodes = [];
    selectedNodeId = null;
    recompute();
    return;
  }
  meshState.environment = { ...meshState.environment, ...scenario.environment };
  const { center } = scenario.environment;
  if (center) {
    map.setView([center.lat, center.lng], center.zoom || mapDefaults.zoom);
  }
  meshState.nodes = scenario.nodes.map(n => ({ ...n, source: "demo" }));
  layoutNodes(meshState.nodes);
  selectedNodeId = null;
  recompute();
}

function attachImportExport() {
  document.getElementById("export-btn").addEventListener("click", exportMesh);
  document.getElementById("download-btn").addEventListener("click", downloadMesh);
  document.getElementById("import-btn").addEventListener("click", handleImport);
  document.getElementById("load-demo-btn").addEventListener("click", loadDemo);
  document.getElementById("file-input").addEventListener("change", handleFileImport);
  document.getElementById("reset-btn").addEventListener("click", () => {
    meshState.nodes = [];
    selectedNodeId = null;
    recompute();
  });
  document.getElementById("restore-btn").addEventListener("click", restoreLastSession);
}

function populatePresetSelect() {
  const select = document.getElementById("preset-select");
  presetScenarios.forEach(scenario => {
    const opt = document.createElement("option");
    opt.value = scenario.id;
    opt.textContent = scenario.label;
    select.appendChild(opt);
  });
}

function init() {
  attachMapHandlers();
  loadState();
  attachEnvironmentHandlers();
  attachNodeButtons();
  populatePresetSelect();
  attachImportExport();
  if (!meshState.nodes.length) saveState();
  layoutNodes(meshState.nodes);
  recompute(false);
}

document.addEventListener("DOMContentLoaded", init);
