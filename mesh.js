const STORAGE_KEY = "ceradon-mesh-state-v0.3";
const DEMO_BANNER_KEY = "meshDemoBannerDismissed";

const VALID_ROLES = ["controller", "relay", "sensor", "client", "uxs"];
const VALID_BANDS = ["900", "1.2", "2.4", "5.8", "other"];

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
  center: { lat: 40.7608, lng: -111.8910 },
  zoom: 15
};

let map;
let nodeMarkers = {};
let linkLayers = [];
let coverageCircle = null;
let pendingPlacementRole = null;
let selectedNodeId = null;

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

function showMapError(message) {
  const banner = document.getElementById("map-error");
  if (!banner) return;
  banner.textContent = message;
  banner.hidden = false;
}

function saveToLocalStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(meshState));
    toggleRestoreVisibility();
  } catch (err) {
    console.warn("Unable to save state", err);
  }
}

function restoreFromLocalStorage() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return;
  try {
    const parsed = JSON.parse(stored);
    Object.assign(meshState.environment, parsed.environment || {});
    meshState.nodes = (parsed.nodes || []).map(ensureLatLng);
    syncEnvironmentInputs();
    recomputeMesh(false);
  } catch (err) {
    console.warn("Failed to restore state", err);
  }
}

function toggleRestoreVisibility() {
  const btn = document.getElementById("restore-btn");
  if (!btn) return;
  const stored = localStorage.getItem(STORAGE_KEY);
  btn.style.display = stored ? "block" : "none";
}

function initMap() {
  const mapEl = document.getElementById("mesh-map");
  if (!mapEl || !window.L) {
    showMapError("Map container missing or Leaflet unavailable.");
    return;
  }
  try {
    map = L.map("mesh-map").setView([mapDefaults.center.lat, mapDefaults.center.lng], mapDefaults.zoom);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);
    enableMapPlacement();
  } catch (err) {
    console.error(err);
    showMapError("Leaflet failed to initialize. Try refreshing.");
  }
}

function wireUI() {
  attachEnvironmentHandlers();
  attachNodeButtons();
  attachImportExport();
  populatePresetSelect();
  toggleRestoreVisibility();
}

// Dismissible banner for demo CTA; hides once per device using localStorage.
function initDemoBanner() {
  const banner = document.getElementById("demo-banner");
  if (!banner) return;
  if (localStorage.getItem(DEMO_BANNER_KEY) === "true") {
    banner.classList.add("hidden");
    return;
  }
  const close = document.getElementById("demo-banner-close");
  close?.addEventListener("click", () => {
    banner.classList.add("hidden");
    localStorage.setItem(DEMO_BANNER_KEY, "true");
  });
}

function attachEnvironmentHandlers() {
  const terrain = document.getElementById("terrain-select");
  const ew = document.getElementById("ew-select");
  const band = document.getElementById("band-select");
  const designRadius = document.getElementById("design-radius");
  const reliability = document.getElementById("target-reliability");

  syncEnvironmentInputs();

  terrain?.addEventListener("change", () => {
    meshState.environment.terrain = terrain.value;
    recomputeMesh();
  });
  ew?.addEventListener("change", () => {
    meshState.environment.ewLevel = ew.value;
    recomputeMesh();
  });
  band?.addEventListener("change", () => {
    meshState.environment.primaryBand = band.value;
    recomputeMesh();
  });
  designRadius?.addEventListener("input", () => {
    meshState.environment.designRadiusMeters = Number(designRadius.value) || 300;
    recomputeMesh();
  });
  reliability?.addEventListener("input", () => {
    meshState.environment.targetReliability = Number(reliability.value) || 80;
    renderMeshSummary();
    saveToLocalStorage();
  });
}

function syncEnvironmentInputs() {
  const terrain = document.getElementById("terrain-select");
  const ew = document.getElementById("ew-select");
  const band = document.getElementById("band-select");
  const designRadius = document.getElementById("design-radius");
  const reliability = document.getElementById("target-reliability");

  if (terrain) terrain.value = meshState.environment.terrain;
  if (ew) ew.value = meshState.environment.ewLevel;
  if (band) band.value = meshState.environment.primaryBand;
  if (designRadius) designRadius.value = meshState.environment.designRadiusMeters;
  if (reliability) reliability.value = meshState.environment.targetReliability;
}

function clearPlacementHighlight() {
  document.querySelectorAll(".add-node").forEach(btn => btn.classList.remove("active"));
}

function setPendingPlacement(role) {
  pendingPlacementRole = role;
  clearPlacementHighlight();
  const hint = document.getElementById("placement-hint");
  if (!role) {
    if (hint) hint.textContent = "";
    return;
  }
  const btn = document.querySelector(`.add-node[data-node-role="${role}"]`);
  btn?.classList.add("active");
  if (hint) hint.textContent = `Placement ready: click on the map to drop a ${role}.`;
}

function attachNodeButtons() {
  document.querySelectorAll(".add-node").forEach(btn => {
    btn.addEventListener("click", () => {
      setPendingPlacement(btn.getAttribute("data-node-role"));
    });
  });
}

function enableMapPlacement() {
  if (!map) return;
  map.on("click", e => {
    if (!pendingPlacementRole) return;
    addNodeAtLatLng(pendingPlacementRole, e.latlng.lat, e.latlng.lng);
    setPendingPlacement(null);
  });
}

function generateDefaultLabel(role) {
  const count = meshState.nodes.filter(n => n.role === role).length + 1;
  const name = role === "uxs" ? "UxS" : role.charAt(0).toUpperCase() + role.slice(1);
  return `${name} ${count}`;
}

function defaultRangeForRole(role) {
  return ROLE_DEFAULTS[role]?.baseRange || 200;
}

function addNodeAtLatLng(role, lat, lng) {
  const id = `node-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const node = {
    id,
    label: generateDefaultLabel(role),
    role,
    band: meshState.environment.primaryBand || "2.4",
    maxRangeMeters: defaultRangeForRole(role),
    lat,
    lng,
    source: "manual"
  };
  meshState.nodes.push(node);
  renderNodeMarker(node);
  recomputeMesh();
  saveToLocalStorage();
}

function markerIcon(role, selected) {
  return L.divIcon({
    className: `node-marker node-${role}${selected ? " selected" : ""}`,
    iconSize: [18, 18]
  });
}

function renderNodeMarker(node) {
  if (!map) return;
  const marker = L.marker([node.lat, node.lng], { draggable: true, icon: markerIcon(node.role, node.id === selectedNodeId) })
    .addTo(map)
    .bindPopup(`<strong>${node.label}</strong><br/>${node.role} • ${node.band} GHz`);

  marker.on("click", () => focusNode(node.id));
  marker.on("dragend", evt => {
    const pos = evt.target.getLatLng();
    node.lat = pos.lat;
    node.lng = pos.lng;
    recomputeMesh();
  });

  nodeMarkers[node.id] = marker;
}

function clearMarkers() {
  Object.values(nodeMarkers).forEach(marker => marker.remove());
  nodeMarkers = {};
}

function updateNodeMarkers() {
  const existingIds = new Set(meshState.nodes.map(n => n.id));
  Object.keys(nodeMarkers).forEach(id => {
    if (!existingIds.has(id)) {
      nodeMarkers[id].remove();
      delete nodeMarkers[id];
    }
  });

  meshState.nodes.forEach(node => {
    const marker = nodeMarkers[node.id];
    if (marker) {
      marker.setLatLng([node.lat, node.lng]);
      marker.setIcon(markerIcon(node.role, node.id === selectedNodeId));
    } else {
      renderNodeMarker(node);
    }
  });
}

function computeDistanceMeters(a, b) {
  if (map && map.distance) return Math.round(map.distance([a.lat, a.lng], [b.lat, b.lng]));
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
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

      links.push({ fromId: a.id, toId: b.id, distanceMeters: distance, quality });
    }
  }
  meshState.links = links;
}

function renderLinks() {
  linkLayers.forEach(line => line.remove());
  linkLayers = [];
  meshState.links.forEach(link => {
    const from = meshState.nodes.find(n => n.id === link.fromId);
    const to = meshState.nodes.find(n => n.id === link.toId);
    if (!from || !to || link.quality === "none" || !map) return;
    const color = link.quality === "good" ? "#3ac177" : link.quality === "marginal" ? "#f2c14e" : "#f07f3c";
    const weight = link.quality === "fragile" ? 2 : 3;
    const poly = L.polyline(
      [
        [from.lat, from.lng],
        [to.lat, to.lng]
      ],
      { color, weight, opacity: 0.9 }
    ).addTo(map);
    linkLayers.push(poly);
  });
}

function updateCoverageCircle() {
  if (!map) return;
  if (coverageCircle) {
    map.removeLayer(coverageCircle);
    coverageCircle = null;
  }
  const controller = meshState.nodes.find(n => n.role === "controller");
  if (!controller) return;
  coverageCircle = L.circle([controller.lat, controller.lng], {
    radius: meshState.environment.designRadiusMeters,
    color: "#888",
    weight: 1,
    dashArray: "4,4",
    fillOpacity: 0.05
  }).addTo(map);
}

function renderLinkSummary() {
  const tbody = document.getElementById("link-summary-body");
  if (!tbody) return;
  tbody.innerHTML = "";
  const qualityRank = { fragile: 3, marginal: 2, good: 1, none: 0 };
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
      td.textContent = value;
      if (idx === 3) td.className = `quality-${value}`;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function renderRecommendations() {
  const p = document.getElementById("recommendations");
  if (!p) return;
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
  if (!list) return;
  list.innerHTML = "";
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

  if (avgRatio > 0.8) hints.push("Most links are near range limits; tighten spacing or add relays.");
  if (!hints.length) hints.push("No major blind spots detected at current layout.");

  hints.forEach(text => {
    const li = document.createElement("li");
    li.textContent = text;
    list.appendChild(li);
  });
}

function renderNodeDetails() {
  const container = document.getElementById("node-detail-content");
  if (!container) return;
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
      const marker = nodeMarkers[node.id];
      if (marker) marker.setIcon(markerIcon(node.role, node.id === selectedNodeId));
      recomputeMesh();
    });
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.textContent = "Delete selected node";
  deleteBtn.addEventListener("click", () => {
    meshState.nodes = meshState.nodes.filter(n => n.id !== node.id);
    selectedNodeId = null;
    recomputeMesh();
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
  Object.entries(nodeMarkers).forEach(([id, marker]) => {
    const node = meshState.nodes.find(n => n.id === id);
    marker.setIcon(markerIcon(node?.role || "client", id === selectedNodeId));
  });
  renderNodeDetails();
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
  if (summaryText)
    summaryText.textContent = meshState.nodes.length ? `Network is ${health} under current assumptions.` : "Network is waiting for nodes.";
  if (counts)
    counts.textContent = `Nodes ${meshState.nodes.length} (Ctrl ${totals.controller || 0} • Relays ${totals.relay || 0} • UxS ${totals.uxs || 0} • Sensors ${totals.sensor || 0} • Clients ${totals.client || 0}) | Links ${meshState.links.length} (Good ${qualityCounts.good} • Marginal ${qualityCounts.marginal} • Fragile ${qualityCounts.fragile})`;
}

function renderOutputs() {
  renderLinkSummary();
  renderRecommendations();
  renderCoverageHints();
  renderNodeDetails();
  renderMeshSummary();
}

function renderAll() {
  updateNodeMarkers();
  renderLinks();
  updateCoverageCircle();
  renderOutputs();
}

function recomputeMesh(save = true) {
  recomputeLinks();
  renderAll();
  if (save) saveToLocalStorage();
}

function exportMeshToText() {
  const payload = {
    meshVersion: "0.3",
    environment: meshState.environment,
    nodes: meshState.nodes,
    links: meshState.links
  };
  const area = document.getElementById("json-area");
  if (area) area.value = JSON.stringify(payload, null, 2);
  setImportStatus("Mesh copied to text area for review.", "muted");
}

function downloadJson() {
  const now = new Date();
  const filename = `mesh-architect-export-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}.json`;
  const blob = new Blob(
    [
      JSON.stringify(
        {
          meshVersion: "0.3",
          environment: meshState.environment,
          nodes: meshState.nodes,
          links: meshState.links
        },
        null,
        2
      )
    ],
    { type: "application/json" }
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function setImportStatus(message, tone = "muted") {
  const status = document.getElementById("import-status");
  if (!status) return;
  status.textContent = message;
  status.style.color = tone === "error" ? "#ffb3b3" : "var(--muted)";
}

function normalizeRole(role) {
  const normalized = String(role || "").toLowerCase();
  if (!VALID_ROLES.includes(normalized)) {
    throw new Error(`Unsupported role: ${role}`);
  }
  return normalized;
}

function normalizeBand(band) {
  const str = String(band ?? meshState.environment.primaryBand ?? "2.4");
  if (!VALID_BANDS.includes(str)) {
    throw new Error(`Unsupported band: ${band}`);
  }
  return str;
}

function getImportMode() {
  const checked = document.querySelector('input[name="import-mode"]:checked');
  return checked?.value === "append" ? "append" : "replace";
}

function importNodeArchitect(json) {
  if (json.source !== "NodeArchitect" || !Array.isArray(json.nodes)) {
    throw new Error("Expected NodeArchitect JSON with a nodes array.");
  }
  const nodes = json.nodes.map((n, idx) => {
    const role = normalizeRole(n.role || "sensor");
    const band = normalizeBand(n.band);
    return {
      id: n.id || generateId("node"),
      label: n.label || n.id || `Node ${idx + 1}`,
      role,
      band,
      maxRangeMeters: n.maxRangeMeters || ROLE_DEFAULTS[role]?.baseRange || 200,
      lat: n.lat ?? null,
      lng: n.lng ?? null,
      source: "nodeArchitect",
      notes: n.notes
    };
  });
  return { nodes };
}

function importUxSArchitect(json) {
  if (json.source !== "UxSArchitect" || !Array.isArray(json.uxsPlatforms)) {
    throw new Error("Expected UxSArchitect JSON with a uxsPlatforms array.");
  }
  const nodes = json.uxsPlatforms.map((n, idx) => {
    const band = normalizeBand(n.band);
    return {
      id: n.id || generateId("uxs"),
      label: n.label || n.id || `UxS ${idx + 1}`,
      role: "uxs",
      band,
      maxRangeMeters: n.maxRangeMeters || ROLE_DEFAULTS.uxs.baseRange,
      lat: n.lat ?? null,
      lng: n.lng ?? null,
      carriedNodeIds: n.carriedNodeIds || [],
      source: "uxsArchitect",
      notes: n.notes
    };
  });
  return { nodes };
}

function importMeshArchitect(json) {
  if (!json.meshVersion && !Array.isArray(json.nodes)) {
    throw new Error("Expected Mesh Architect JSON with meshVersion or nodes.");
  }
  const nodes = (json.nodes || []).map(node => ({
    id: node.id || generateId("node"),
    label: node.label || node.id || "Node",
    role: normalizeRole(node.role || "sensor"),
    band: normalizeBand(node.band),
    maxRangeMeters: node.maxRangeMeters || defaultRangeForRole(node.role || "sensor"),
    lat: node.lat ?? null,
    lng: node.lng ?? null,
    x: node.x,
    y: node.y,
    source: node.source || "meshImport"
  }));
  return { nodes, environment: json.environment };
}

function applyImportResult(result, mode = "replace") {
  const nodes = (result.nodes || []).map(ensureLatLng);
  const environment = result.environment;
  if (mode === "append") {
    meshState.nodes = meshState.nodes.concat(nodes);
  } else {
    meshState.nodes = nodes;
  }
  if (environment) {
    meshState.environment = { ...meshState.environment, ...environment };
    syncEnvironmentInputs();
  }
  layoutNodes(meshState.nodes);
  selectedNodeId = null;
  recomputeMesh();
  fitMapToNodes();
  setImportStatus(mode === "append" ? "Imported and appended nodes." : "Imported mesh successfully.");
}

function handleParsedImport(parsed) {
  const mode = getImportMode();
  try {
    if (parsed.source === "NodeArchitect") {
      applyImportResult(importNodeArchitect(parsed), mode);
    } else if (parsed.source === "UxSArchitect") {
      applyImportResult(importUxSArchitect(parsed), mode);
    } else if (parsed.meshVersion || parsed.environment || parsed.nodes) {
      applyImportResult(importMeshArchitect(parsed), mode);
    } else {
      throw new Error("Unsupported JSON payload. Provide Node, UxS, or Mesh Architect JSON.");
    }
  } catch (e) {
    console.warn("Invalid JSON", e);
    setImportStatus(e.message || "Invalid JSON provided. Please verify the format.", "error");
  }
}

function handleImport() {
  const text = document.getElementById("json-area")?.value || "";
  if (!text.trim()) return setImportStatus("Paste JSON to import.", "error");
  try {
    const parsed = JSON.parse(text);
    handleParsedImport(parsed);
  } catch (err) {
    setImportStatus("Invalid JSON provided. Please verify the format.", "error");
  }
}

function handleFileImport(event, importer) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const parsed = JSON.parse(e.target.result || "");
      if (importer) {
        applyImportResult(importer(parsed), getImportMode());
      } else {
        handleParsedImport(parsed);
      }
    } catch (err) {
      console.warn("Failed import", err);
      setImportStatus(err.message || "Invalid JSON provided.", "error");
    }
  };
  reader.onerror = () => setImportStatus("Failed to read file", "error");
  reader.readAsText(file);
}

function generateId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

// Autoplace nodes missing coordinates around the current map center in a compact grid.
function layoutNodes(nodes) {
  const missing = nodes.filter(n => n.lat == null || n.lng == null);
  if (!missing.length) return;
  const center = map?.getCenter() || mapDefaults.center;
  const grid = Math.ceil(Math.sqrt(missing.length));
  const spacing = 0.0012;
  missing.forEach((node, idx) => {
    const row = Math.floor(idx / grid);
    const col = idx % grid;
    const offset = (grid - 1) / 2;
    node.lat = center.lat + (row - offset) * spacing;
    node.lng = center.lng + (col - offset) * spacing;
  });
}

function ensureLatLng(node) {
  if (node.lat != null && node.lng != null) return node;
  if (node.x != null || node.y != null) {
    const bounds = map?.getBounds();
    if (bounds) {
      const lat = bounds.getSouth() + (node.y ?? 0.5) * (bounds.getNorth() - bounds.getSouth());
      const lng = bounds.getWest() + (node.x ?? 0.5) * (bounds.getEast() - bounds.getWest());
      return { ...node, lat, lng };
    }
    const center = mapDefaults.center;
    const span = 0.002;
    const mappedLat = center.lat + ((node.y ?? 0.5) - 0.5) * span;
    const mappedLng = center.lng + ((node.x ?? 0.5) - 0.5) * span;
    return { ...node, lat: mappedLat, lng: mappedLng };
  }
  return { ...node, lat: null, lng: null };
}

function loadDemo() {
  const presetSelect = document.getElementById("preset-select");
  const selected = presetSelect?.value;
  const scenario = presetScenarios.find(s => s.id === selected);
  if (!scenario) {
    meshState.nodes = [];
    selectedNodeId = null;
    recomputeMesh();
    return;
  }
  meshState.environment = { ...meshState.environment, ...scenario.environment };
  meshState.nodes = scenario.nodes.map(n => ({ ...n, source: "demo" }));
  syncEnvironmentInputs();
  if (map && scenario.environment.center) {
    map.setView([scenario.environment.center.lat, scenario.environment.center.lng], scenario.environment.center.zoom || mapDefaults.zoom);
  }
  layoutNodes(meshState.nodes);
  selectedNodeId = null;
  recomputeMesh();
  fitMapToNodes();
}

function fitMapToNodes() {
  if (!map || !meshState.nodes.length) return;
  const latlngs = meshState.nodes.map(n => [n.lat, n.lng]);
  const bounds = L.latLngBounds(latlngs);
  map.fitBounds(bounds.pad(0.2));
}

function attachImportExport() {
  document.getElementById("export-btn")?.addEventListener("click", exportMeshToText);
  document.getElementById("download-btn")?.addEventListener("click", downloadJson);
  document.getElementById("import-btn")?.addEventListener("click", handleImport);
  document.getElementById("load-demo-btn")?.addEventListener("click", loadDemo);
  document.getElementById("node-file-input")?.addEventListener("change", e => handleFileImport(e, importNodeArchitect));
  document.getElementById("uxs-file-input")?.addEventListener("change", e => handleFileImport(e, importUxSArchitect));
  document.getElementById("mesh-file-input")?.addEventListener("change", e => handleFileImport(e, importMeshArchitect));
  document.getElementById("reset-btn")?.addEventListener("click", () => {
    meshState.nodes = [];
    selectedNodeId = null;
    recomputeMesh();
  });
  document.getElementById("restore-btn")?.addEventListener("click", restoreFromLocalStorage);
  document.getElementById("export-kml-btn")?.addEventListener("click", exportMeshToKml);
  document.getElementById("export-cot-btn")?.addEventListener("click", exportMeshToCot);
}

function populatePresetSelect() {
  const select = document.getElementById("preset-select");
  if (!select) return;
  if (select.children.length === 1) {
    presetScenarios.forEach(scenario => {
      const opt = document.createElement("option");
      opt.value = scenario.id;
      opt.textContent = scenario.label;
      select.appendChild(opt);
    });
  }
}

function downloadTextFile(filename, text, type = "text/plain") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportMeshToKml() {
  const now = new Date();
  const filename = `mesh-architect-atak-overlay-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}.kml`;
  const roleStyles = Object.keys(ROLE_DEFAULTS)
    .map(role => `    <Style id="${role}">
      <IconStyle>
        <color>${role === "controller" ? "ff4c82ff" : role === "relay" ? "fff0a500" : role === "uxs" ? "fff38ba8" : role === "sensor" ? "ff55c57a" : "ffb7b7b7"}</color>
        <scale>1.2</scale>
      </IconStyle>
      <LabelStyle><scale>0.9</scale></LabelStyle>
    </Style>`)
    .join("\n");

  const linkStyles = `    <Style id="link-good"><LineStyle><color>ff77c33a</color><width>3</width></LineStyle></Style>
    <Style id="link-marginal"><LineStyle><color>ff4ec1f2</color><width>3</width></LineStyle></Style>
    <Style id="link-fragile"><LineStyle><color>ff3c7ff0</color><width>2</width></LineStyle></Style>`;

  const nodePlacemarks = meshState.nodes
    .map(
      node => `    <Placemark>
      <name>${node.label}</name>
      <description>${node.role} • ${node.band} GHz • ${node.maxRangeMeters} m</description>
      <styleUrl>#${node.role}</styleUrl>
      <Point><coordinates>${node.lng},${node.lat},0</coordinates></Point>
    </Placemark>`
    )
    .join("\n");

  const linkPlacemarks = meshState.links
    .filter(l => l.quality !== "none")
    .map(link => {
      const from = meshState.nodes.find(n => n.id === link.fromId);
      const to = meshState.nodes.find(n => n.id === link.toId);
      if (!from || !to) return "";
      return `    <Placemark>
      <name>${from.label} -> ${to.label} (${link.quality})</name>
      <styleUrl>#link-${link.quality}</styleUrl>
      <LineString><coordinates>${from.lng},${from.lat},0 ${to.lng},${to.lat},0</coordinates></LineString>
    </Placemark>`;
    })
    .join("\n");

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
${roleStyles}
${linkStyles}
${nodePlacemarks}
${linkPlacemarks}
  </Document>
</kml>`;

  downloadTextFile(filename, kml, "application/vnd.google-earth.kml+xml");
}

function exportMeshToCot() {
  const now = new Date();
  const isoNow = now.toISOString();
  const stale = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  const filename = `mesh-architect-atak-cot-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}.xml`;
  const events = meshState.nodes
    .map(
      node => `<event version="2.0" type="a-f-G-U-C" uid="${node.id}" time="${isoNow}" start="${isoNow}" stale="${stale}">
  <point lat="${node.lat}" lon="${node.lng}" hae="0" ce="9999999" le="9999999" />
  <detail>
    <contact callsign="${node.label}" />
    <remarks>${node.role}, ${node.band} GHz, range ${node.maxRangeMeters} m</remarks>
  </detail>
</event>`
    )
    .join("\n");

  const xml = `<cot>
${events}
</cot>`;
  downloadTextFile(filename, xml, "text/xml");
}

function fitDesignToInputs() {
  renderMeshSummary();
}

function init() {
  initMap();
  wireUI();
  initDemoBanner();
  fitDesignToInputs();
  restoreFromLocalStorage();
  layoutNodes(meshState.nodes);
  recomputeMesh(false);
  fitMapToNodes();
}

document.addEventListener("DOMContentLoaded", init);
