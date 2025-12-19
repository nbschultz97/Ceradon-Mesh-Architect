const APP_VERSION = "Mesh Architect v0.3.1";
const MISSIONPROJECT_SCHEMA_VERSION = "2.0.0";
const STORAGE_KEY = "ceradon-mesh-state-v0.3";
const DEMO_BANNER_KEY = "meshDemoBannerDismissed";

const CHANGE_LOG = [
  {
    version: "v0.3.1",
    date: "2024-05-20",
    changes: [
      "Added visible app + MissionProject schema badges and shared change log.",
      "Aligned MissionProject exports to schemaVersion 2.0.0 with preserved extras.",
      "Improved mobile responsiveness and neutralized demo guidance."
    ]
  },
  {
    version: "v0.3",
    date: "2024-05-01",
    changes: [
      "Initial public Mesh Architect demo with MissionProject exchange and WHITEFROST preset.",
      "TAK/GeoJSON/CoT exports and quick demo presets."
    ]
  }
];

const VALID_ROLES = ["controller", "relay", "sensor", "client", "uxs"];
const VALID_BANDS = ["900", "1.2", "2.4", "5.8", "other"];

const ROLE_DEFAULTS = {
  controller: { baseRange: 450, color: "var(--controller)" },
  relay: { baseRange: 380, color: "var(--relay)" },
  uxs: { baseRange: 650, color: "var(--uxs)" },
  sensor: { baseRange: 260, color: "var(--sensor)" },
  client: { baseRange: 180, color: "var(--client)" }
};

const LOS_OPTIONS = ["LOS", "NLOS-urban", "NLOS-foliage/terrain"];
const LOS_PENALTY_DB = {
  LOS: 0,
  "NLOS-urban": 18,
  "NLOS-foliage/terrain": 12
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
  center: { lat: 39.8283, lng: -98.5795 },
  zoom: 6
};

let map;
let tileLayer;
let fallbackLayer;
let useFallbackCanvas = false;
let fallbackBounds = null;
let tileFallbackTried = false;
let nodeMarkers = {};
let linkLayers = [];
let coverageCircle = null;
let pendingPlacementRole = null;
let selectedNodeId = null;
let lastMissionProjectJson = null;

const meshState = {
  environment: {
    terrain: "Urban",
    ewLevel: "Medium",
    primaryBand: "2.4",
    designRadiusMeters: 300,
    targetReliability: 80
  },
  mission: {
    name: "Mesh Architect Plan",
    project_code: "MESH-GHOST-347",
    origin_tool: "mesh"
  },
  nodes: [],
  links: [],
  meshLinks: [],
  kits: [],
  constraints: [],
  missionProjectExtras: {},
  environmentExtras: {},
  meshExtras: {},
  missionExtras: {},
  schemaVersion: MISSIONPROJECT_SCHEMA_VERSION
};

function showMapError(message = "Basemap unavailable. Switched to simplified offline view.") {
  const banner = document.getElementById("map-error");
  if (!banner) return;
  banner.textContent = message;
  banner.hidden = false;
}

function showTileWarning(message) {
  const banner = document.getElementById("tile-warning");
  if (!banner) return;
  banner.textContent = message;
  banner.hidden = false;
}

function activateFallbackCanvas(reason) {
  useFallbackCanvas = true;
  showMapError(reason || "Basemap unavailable. Using simplified offline view.");
  const mapEl = document.getElementById("mesh-map");
  const canvas = document.getElementById("fallback-canvas");
  if (mapEl) mapEl.style.display = "none";
  if (canvas) {
    canvas.hidden = false;
    initFallbackCanvas(canvas);
  }
}

function initFallbackCanvas(canvas) {
  if (!canvas) return;
  const container = document.getElementById("canvas-container");
  const resizeCanvas = () => {
    canvas.width = container?.clientWidth || 600;
    canvas.height = Math.max(container?.clientHeight || 0, 420);
    renderCanvasGraph();
  };

  let draggingNodeId = null;

  const toPoint = evt => {
    const rect = canvas.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  };

  canvas.addEventListener("click", evt => {
    const point = toPoint(evt);
    if (pendingPlacementRole) {
      const latlng = pointToLatLng(point.x, point.y);
      addNodeAtLatLng(pendingPlacementRole, latlng.lat, latlng.lng);
      setPendingPlacement(null);
      renderCanvasGraph();
      return;
    }
    const nearest = findNearestNode(point.x, point.y);
    if (nearest) {
      focusNode(nearest.id);
      renderCanvasGraph();
    }
  });

  canvas.addEventListener("mousedown", evt => {
    const point = toPoint(evt);
    const nearest = findNearestNode(point.x, point.y);
    if (nearest && nearest.distance < 16) {
      draggingNodeId = nearest.id;
    }
  });

  canvas.addEventListener("mousemove", evt => {
    if (!draggingNodeId) return;
    const node = meshState.nodes.find(n => n.id === draggingNodeId);
    if (!node) return;
    const point = toPoint(evt);
    const latlng = pointToLatLng(point.x, point.y);
    node.lat = latlng.lat;
    node.lng = latlng.lng;
    node.unplaced = false;
    renderCanvasGraph();
  });

  canvas.addEventListener("mouseup", () => {
    if (draggingNodeId) {
      draggingNodeId = null;
      recomputeMesh();
    }
  });

  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();
}

function computeFallbackBounds() {
  if (!meshState.nodes.length) {
    const center = map?.getCenter?.() || mapDefaults.center;
    const span = 0.003;
    return { minLat: center.lat - span, maxLat: center.lat + span, minLng: center.lng - span, maxLng: center.lng + span };
  }
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  meshState.nodes.forEach(n => {
    minLat = Math.min(minLat, n.lat ?? 0);
    maxLat = Math.max(maxLat, n.lat ?? 0);
    minLng = Math.min(minLng, n.lng ?? 0);
    maxLng = Math.max(maxLng, n.lng ?? 0);
  });
  if (minLat === maxLat) {
    minLat -= 0.0008;
    maxLat += 0.0008;
  }
  if (minLng === maxLng) {
    minLng -= 0.0008;
    maxLng += 0.0008;
  }
  return { minLat, maxLat, minLng, maxLng };
}

function latLngToPoint(lat, lng) {
  fallbackBounds = fallbackBounds || computeFallbackBounds();
  const { minLat, maxLat, minLng, maxLng } = fallbackBounds;
  const width = document.getElementById("fallback-canvas")?.width || 1;
  const height = document.getElementById("fallback-canvas")?.height || 1;
  const x = ((lng - minLng) / (maxLng - minLng)) * width;
  const y = height - ((lat - minLat) / (maxLat - minLat)) * height;
  return { x, y };
}

function pointToLatLng(x, y) {
  fallbackBounds = fallbackBounds || computeFallbackBounds();
  const { minLat, maxLat, minLng, maxLng } = fallbackBounds;
  const canvas = document.getElementById("fallback-canvas");
  const width = canvas?.width || 1;
  const height = canvas?.height || 1;
  const lng = minLng + (x / width) * (maxLng - minLng);
  const lat = minLat + (1 - y / height) * (maxLat - minLat);
  return { lat, lng };
}

function findNearestNode(x, y) {
  let nearest = null;
  let best = Infinity;
  meshState.nodes.forEach(n => {
    if (n.lat == null || n.lng == null) return;
    const pt = latLngToPoint(n.lat, n.lng);
    const dist = Math.hypot(pt.x - x, pt.y - y);
    if (dist < best) {
      best = dist;
      nearest = { id: n.id, distance: dist };
    }
  });
  return nearest;
}

function renderCanvasGraph() {
  if (!useFallbackCanvas) return;
  const canvas = document.getElementById("fallback-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  fallbackBounds = computeFallbackBounds();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#0c1017";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "#1f2a36";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = (canvas.height / 4) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  meshState.links.forEach(link => {
    const from = meshState.nodes.find(n => n.id === link.fromId);
    const to = meshState.nodes.find(n => n.id === link.toId);
    if (!from || !to) return;
    const a = latLngToPoint(from.lat, from.lng);
    const b = latLngToPoint(to.lat, to.lng);
    const color = link.linkMarginDb >= 10 ? "#3ac177" : link.linkMarginDb >= 2 ? "#f2c14e" : "#f07f3c";
    ctx.strokeStyle = color;
    ctx.lineWidth = link.quality === "unlikely" ? 2 : 3;
    ctx.setLineDash(link.quality === "unlikely" ? [6, 4] : []);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
  });

  const controller = meshState.nodes.find(n => n.role === "controller");
  if (controller) {
    const centerPt = latLngToPoint(controller.lat, controller.lng);
    const meterToDeg = 1 / 111000;
    const radiusLat = meshState.environment.designRadiusMeters * meterToDeg;
    const edge = latLngToPoint(controller.lat + radiusLat, controller.lng);
    const radiusPx = Math.abs(edge.y - centerPt.y);
    ctx.strokeStyle = "#888";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(centerPt.x, centerPt.y, radiusPx, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  meshState.nodes.forEach(node => {
    if (node.lat == null || node.lng == null) return;
    const { x, y } = latLngToPoint(node.lat, node.lng);
    ctx.fillStyle = node.id === selectedNodeId ? "#ffffff" : ROLE_DEFAULTS[node.role]?.color || "#b7b7b7";
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "12px system-ui";
    ctx.fillStyle = "#d8d8db";
    ctx.textAlign = "center";
    ctx.fillText(node.label, x, y - 12);
  });
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
    if (parsed.mission) meshState.mission = { ...meshState.mission, ...parsed.mission };
    meshState.nodes = (parsed.nodes || []).map(ensureLatLng);
    meshState.meshLinks = parsed.meshLinks || [];
    meshState.kits = parsed.kits || [];
    meshState.constraints = parsed.constraints || [];
    syncEnvironmentInputs();
    recomputeMesh(false);
    if (parsed.schema === "MissionProject" || parsed.mission) updateIntegrationStatus(true, meshState.mission?.name);
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
    activateFallbackCanvas("Basemap unavailable. Using simplified offline view.");
    return;
  }
  try {
    map = L.map("mesh-map").setView([mapDefaults.center.lat, mapDefaults.center.lng], mapDefaults.zoom);
    tileLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    });
    tileLayer.on("tileerror", () => handleTileFailure());
    tileLayer.addTo(map);
    enableMapPlacement();
  } catch (err) {
    console.error(err);
    activateFallbackCanvas("Basemap unavailable. Using simplified offline view.");
  }
}

function handleTileFailure() {
  if (useFallbackCanvas) return;
  if (!tileFallbackTried && map) {
    tileFallbackTried = true;
    showTileWarning("Primary tiles failed. Falling back to alternate basemap.");
    try {
      fallbackLayer = L.tileLayer("https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors"
      });
      fallbackLayer.on("tileerror", () => handleTileFailure());
      if (tileLayer) tileLayer.remove();
      fallbackLayer.addTo(map);
      return;
    } catch (err) {
      console.warn("Fallback tile layer failed", err);
    }
  }
  showTileWarning("Basemap unavailable. Using simplified offline view.");
  activateFallbackCanvas();
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
    source: "manual",
    unplaced: false
  };
  meshState.nodes.push(node);
  renderNodeMarker(node);
  recomputeMesh();
  saveToLocalStorage();
}

function markerIcon(role, selected, unplaced = false) {
  return L.divIcon({
    className: `node-marker node-${role}${selected ? " selected" : ""}${unplaced ? " unplaced" : ""}`,
    iconSize: [18, 18]
  });
}

function renderNodeMarker(node) {
  if (!map || useFallbackCanvas) return;
  const marker = L.marker([node.lat, node.lng], { draggable: true, icon: markerIcon(node.role, node.id === selectedNodeId, node.unplaced) })
    .addTo(map)
    .bindPopup(`<strong>${node.label}</strong><br/>${node.role} • ${node.band} GHz`);

  marker.on("click", () => focusNode(node.id));
  marker.on("dragend", evt => {
    const pos = evt.target.getLatLng();
    node.lat = pos.lat;
    node.lng = pos.lng;
    node.unplaced = false;
    recomputeMesh();
  });

  nodeMarkers[node.id] = marker;
}

function clearMarkers() {
  Object.values(nodeMarkers).forEach(marker => marker.remove());
  nodeMarkers = {};
}

function updateNodeMarkers() {
  if (useFallbackCanvas) return;
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
      marker.setIcon(markerIcon(node.role, node.id === selectedNodeId, node.unplaced));
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

function defaultLosForTerrain(terrain) {
  if (terrain === "Dense urban" || terrain === "Indoor") return "NLOS-urban";
  if (terrain === "Urban") return "NLOS-urban";
  if (terrain === "Suburban") return "NLOS-foliage/terrain";
  return "LOS";
}

function freeSpacePathLoss(distanceMeters, freqMHz) {
  const km = Math.max(distanceMeters, 1) / 1000;
  const mhz = Math.max(freqMHz, 1);
  return 32.44 + 20 * Math.log10(km) + 20 * Math.log10(mhz);
}

function losEstimateFromHeights(distanceMeters, a, b) {
  if (a == null || b == null) return null;
  const horizonKm = 3.57 * (Math.sqrt(Math.max(a, 0)) + Math.sqrt(Math.max(b, 0)));
  return distanceMeters / 1000 <= horizonKm;
}

function effectiveRange(node) {
  const bandFactor = BAND_FACTOR[node.band] ?? 1;
  const terrain = TERRAIN_MULTIPLIER[meshState.environment.terrain] ?? 1;
  const ew = EW_MULTIPLIER[meshState.environment.ewLevel] ?? 1;
  return node.maxRangeMeters * bandFactor * terrain * ew;
}

function estimateLinkMetrics(a, b, distanceMeters, losType) {
  const freq = Number(a.band) || Number(b.band) || Number(meshState.environment.primaryBand) || 2.4;
  const freqMHz = freq * 1000;
  const penalty = LOS_PENALTY_DB[losType] ?? LOS_PENALTY_DB[defaultLosForTerrain(meshState.environment.terrain)];
  const effectiveRangeMeters = Math.max(10, Math.min(effectiveRange(a), effectiveRange(b)));
  const lossAtRange = freeSpacePathLoss(effectiveRangeMeters, freqMHz);
  const lossAtDistance = freeSpacePathLoss(distanceMeters, freqMHz) + penalty;
  const marginDb = lossAtRange - lossAtDistance;
  let quality = "unlikely";
  if (marginDb >= 8) quality = "good";
  else if (marginDb >= -6) quality = "marginal";
  return { quality, marginDb };
}

function linkKey(a, b) {
  return [a, b].sort().join("::");
}

function recomputeLinks() {
  const existing = new Map(meshState.links.map(l => [linkKey(l.fromId, l.toId), l]));
  const links = [];
  for (let i = 0; i < meshState.nodes.length; i++) {
    for (let j = i + 1; j < meshState.nodes.length; j++) {
      const a = meshState.nodes[i];
      const b = meshState.nodes[j];
      const key = linkKey(a.id, b.id);
      const prior = existing.get(key) || {};
      const measuredDistance = computeDistanceMeters(a, b);
      const distanceMeters = prior.distanceOverrideMeters ?? measuredDistance;
      const losType = prior.los || defaultLosForTerrain(meshState.environment.terrain);
      const elevationA = (a.elevationMeters ?? a.altitudeMeters ?? 0) + (a.heightAboveGroundMeters ?? 0);
      const elevationB = (b.elevationMeters ?? b.altitudeMeters ?? 0) + (b.heightAboveGroundMeters ?? 0);
      const losHint = losEstimateFromHeights(measuredDistance, elevationA, elevationB);
      const { quality, marginDb } = estimateLinkMetrics(a, b, distanceMeters, losType);

      links.push({
        fromId: a.id,
        toId: b.id,
        distanceMeters,
        measuredDistanceMeters: measuredDistance,
        distanceOverrideMeters: prior.distanceOverrideMeters,
        los: losType,
        losEstimate: losHint,
        quality,
        linkMarginDb: marginDb
      });
    }
  }
  meshState.links = links;
}

function meshQualityLabel(quality) {
  if (quality === "unlikely") return "poor";
  return quality || "unknown";
}

function syncMeshLinksFromState() {
  const envTag = `${meshState.environment.terrain || "unknown"}-${meshState.environment.ewLevel || "EW"}`;
  const extrasIndex = new Map(
    (meshState.meshLinks || []).map(l => [l.id || `${l.from_id || ""}-${l.to_id || ""}`, l.extras || {}])
  );
  meshState.meshLinks = meshState.links.map(link => {
    const id = link.id || `${link.fromId}-${link.toId}`;
    const extras = extrasIndex.get(id) || {};
    return {
      ...extras,
      id,
      from_id: link.fromId,
      to_id: link.toId,
      band: meshState.environment.primaryBand,
      estimated_range: Math.round(link.distanceOverrideMeters || link.distanceMeters || 0),
      estimated_link_quality: meshQualityLabel(link.quality),
      estimated_link_quality_label: meshQualityLabel(link.quality),
      environment_tag: envTag,
      link_margin_db: Math.round(link.linkMarginDb || 0),
      distance_m: Math.round(link.distanceOverrideMeters || link.distanceMeters || 0)
    };
  });
}

function renderLinks() {
  if (useFallbackCanvas) return;
  linkLayers.forEach(line => line.remove());
  linkLayers = [];
  meshState.links.forEach(link => {
    const from = meshState.nodes.find(n => n.id === link.fromId);
    const to = meshState.nodes.find(n => n.id === link.toId);
    if (!from || !to || !map) return;
    const color = link.linkMarginDb >= 10 ? "#3ac177" : link.linkMarginDb >= 2 ? "#f2c14e" : "#f07f3c";
    const weight = link.quality === "unlikely" ? 2 : 3;
    const dashArray = link.quality === "unlikely" ? "6,4" : undefined;
    const poly = L.polyline(
      [
        [from.lat, from.lng],
        [to.lat, to.lng]
      ],
      { color, weight, opacity: 0.85, dashArray }
    )
      .addTo(map)
      .bindTooltip(`${Math.round(link.linkMarginDb || 0)} dB`, { permanent: false, direction: "center", className: "link-tooltip" });
    linkLayers.push(poly);
  });
}

function updateCoverageCircle() {
  if (!map || useFallbackCanvas) return;
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
  const qualityRank = { unlikely: 1, marginal: 2, good: 3 };
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
    const distanceInput = document.createElement("input");
    distanceInput.type = "number";
    distanceInput.min = 1;
    distanceInput.step = 10;
    distanceInput.value = Math.round(link.distanceMeters);
    distanceInput.addEventListener("change", () => {
      link.distanceOverrideMeters = Number(distanceInput.value) || link.distanceMeters;
      recomputeMesh();
    });

    const losSelect = document.createElement("select");
    LOS_OPTIONS.forEach(option => {
      const opt = document.createElement("option");
      opt.value = option;
      opt.textContent = option;
      if (option === link.los) opt.selected = true;
      losSelect.appendChild(opt);
    });
    losSelect.addEventListener("change", () => {
      link.los = losSelect.value;
      recomputeMesh();
    });

    const losHint = document.createElement("div");
    losHint.className = "muted";
    if (link.losEstimate != null) {
      losHint.textContent = link.losEstimate ? "Horizon suggests LOS" : "Likely terrain/clutter masking";
    } else {
      losHint.textContent = `Measured ${Math.round(link.measuredDistanceMeters)} m`;
    }

    const cells = [
      from?.label || link.fromId,
      to?.label || link.toId,
      distanceInput,
      losSelect,
      link.quality,
      Math.round(link.linkMarginDb || 0),
      losHint
    ];
    cells.forEach((value, idx) => {
      const td = document.createElement("td");
      if (value instanceof HTMLElement) {
        td.appendChild(value);
      } else {
        td.textContent = value;
      }
      if (idx === 4) td.className = `quality-${link.quality}`;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function renderRecommendations() {
  const p = document.getElementById("recommendations");
  if (!p) return;
  const relayCount = meshState.nodes.filter(n => n.role === "relay" || n.role === "uxs").length;
  const relayCandidates = meshState.nodes.filter(n => n.relayCandidate).length;
  const airborneRelays = meshState.nodes.filter(n => n.isAirborne || n.role === "uxs").length;
  const controllers = meshState.nodes.filter(n => n.role === "controller").length;
  const marginalOrBetter = meshState.links.filter(l => l.quality === "good" || l.quality === "marginal");
  const isolated = meshState.links.filter(l => l.quality !== "good" && l.quality !== "marginal").length;
  let text = `Relays: ${relayCount} (candidates ${relayCandidates}${airborneRelays ? `, airborne ${airborneRelays}` : ""}). Controllers/Gateways: ${controllers}. `;
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

  const elevationInput = document.createElement("input");
  elevationInput.type = "number";
  elevationInput.value = node.elevationMeters ?? node.altitudeMeters ?? "";
  elevationInput.placeholder = "Elevation ASL (m) optional";
  elevationInput.step = 10;

  const mastInput = document.createElement("input");
  mastInput.type = "number";
  mastInput.value = node.heightAboveGroundMeters ?? "";
  mastInput.placeholder = "Height above ground (m)";
  mastInput.step = 5;

  [labelInput, roleSelect, bandSelect, rangeInput, elevationInput, mastInput].forEach(el => {
    el.addEventListener("input", () => {
      node.label = labelInput.value;
      node.role = roleSelect.value;
      node.band = bandSelect.value;
      node.maxRangeMeters = Number(rangeInput.value) || node.maxRangeMeters;
      node.elevationMeters = elevationInput.value ? Number(elevationInput.value) : undefined;
      node.heightAboveGroundMeters = mastInput.value ? Number(mastInput.value) : undefined;
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
  container.appendChild(createLabeledField("Elevation (m ASL, optional)", elevationInput));
  container.appendChild(createLabeledField("Height above ground (m, optional)", mastInput));
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
    marker.setIcon(markerIcon(node?.role || "client", id === selectedNodeId, node?.unplaced));
  });
  renderNodeDetails();
}

function computeRiskTag() {
  const terrainPenalty = 1 / (TERRAIN_MULTIPLIER[meshState.environment.terrain] || 1);
  const ewPenalty = 1 / (EW_MULTIPLIER[meshState.environment.ewLevel] || 1);
  const score = terrainPenalty * ewPenalty;
  if (score < 1.3) return "OK";
  if (score < 1.7) return "Watch";
  return "Issue";
}

function renderMeshSummary() {
  const summaryText = document.getElementById("mesh-health");
  const counts = document.getElementById("mesh-counts");
  const linkMicro = document.getElementById("mesh-link-micro-summary");
  const bands = new Set([meshState.environment.primaryBand, ...meshState.nodes.map(n => n.band).filter(Boolean)]);
  const risk = computeRiskTag();
  const totals = meshState.nodes.reduce((acc, node) => {
    acc[node.role] = (acc[node.role] || 0) + 1;
    return acc;
  }, {});
  const qualityCounts = meshState.links.reduce(
    (acc, link) => {
      acc[link.quality] = (acc[link.quality] || 0) + 1;
      return acc;
    },
    { good: 0, marginal: 0, unlikely: 0 }
  );
  const totalLinks = meshState.links.length || 1;
  const goodShare = (qualityCounts.good + qualityCounts.marginal) / totalLinks;
  const health = goodShare >= 0.7 ? "Robust" : goodShare >= 0.4 ? "Marginal" : "Fragile";
  if (summaryText)
    summaryText.textContent = meshState.nodes.length
      ? `Network is ${health} under current assumptions. EW/Terrain risk: ${risk}.`
      : "Network is waiting for nodes.";
  if (counts)
    counts.textContent = `Nodes ${meshState.nodes.length} (Ctrl ${totals.controller || 0} • Relays ${totals.relay || 0} • UxS ${
      totals.uxs || 0
    } • Sensors ${totals.sensor || 0} • Clients ${totals.client || 0}) | Bands ${Array.from(bands).filter(Boolean).join(", ") ||
      "n/a"} | Links ${meshState.links.length} (Good ${qualityCounts.good} • Marginal ${qualityCounts.marginal} • Unlikely ${
      qualityCounts.unlikely
    })`;
  if (linkMicro) {
    linkMicro.innerHTML = "";
    const meshLinks = meshState.meshLinks?.length ? meshState.meshLinks : meshState.links;
    meshLinks.slice(0, 6).forEach(link => {
      const li = document.createElement("li");
      const from = meshState.nodes.find(n => n.id === (link.from_id || link.fromId));
      const to = meshState.nodes.find(n => n.id === (link.to_id || link.toId));
      const distance = Math.round(link.distance_m || link.distanceMeters || link.estimated_range || 0);
      const label = meshQualityLabel(link.estimated_link_quality || link.quality);
      li.textContent = `${from?.label || link.from_id || link.fromId} → ${to?.label || link.to_id || link.toId}: ${distance} m • ${label}`;
      linkMicro.appendChild(li);
    });
    if (!linkMicro.children.length) {
      const li = document.createElement("li");
      li.textContent = "Links will appear once nodes are placed.";
      linkMicro.appendChild(li);
    }
  }

  renderOriginSummary();
}

function renderOriginSummary() {
  const container = document.getElementById("origin-summary");
  if (!container) return;
  if (!meshState.nodes.length) {
    container.textContent = "Origin summary will appear after import or placement.";
    return;
  }

  const friendlyOrigins = {
    mesh: "Mesh Architect",
    node: "Node Architect",
    nodearchitect: "Node Architect",
    uxs: "UxS Architect",
    uxsarchitect: "UxS Architect",
    mission: "Mission Architect",
    demo: "Demo preset",
    whitefrost: "WHITEFROST preset"
  };

  const counts = meshState.nodes.reduce((acc, node) => {
    const originKey = String(node.origin_tool || node.source || "unknown").toLowerCase();
    acc[originKey] = (acc[originKey] || 0) + 1;
    return acc;
  }, {});

  const summaryParts = Object.entries(counts).map(([origin, total]) => {
    const label = friendlyOrigins[origin] || origin.charAt(0).toUpperCase() + origin.slice(1);
    return `${label}: ${total}`;
  });

  container.textContent = `Nodes by origin_tool — ${summaryParts.join(", ")}`;
}

function analyzeMeshRobustness() {
  const viableLinks = meshState.links.filter(l => l.quality === "good" || l.quality === "marginal" || l.quality === "unlikely");
  const idIndex = new Map(meshState.nodes.map((n, idx) => [n.id, idx]));
  const adj = meshState.nodes.map(() => []);
  viableLinks.forEach(link => {
    const u = idIndex.get(link.fromId);
    const v = idIndex.get(link.toId);
    if (u == null || v == null) return;
    adj[u].push({ v, link });
    adj[v].push({ v: u, link });
  });

  const disc = Array(meshState.nodes.length).fill(-1);
  const low = Array(meshState.nodes.length).fill(-1);
  const parent = Array(meshState.nodes.length).fill(-1);
  const articulation = new Set();
  const criticalBridges = [];
  let time = 0;

  function dfs(u) {
    disc[u] = low[u] = ++time;
    let children = 0;
    adj[u].forEach(({ v, link }) => {
      if (disc[v] === -1) {
        children++;
        parent[v] = u;
        dfs(v);
        low[u] = Math.min(low[u], low[v]);
        if (parent[u] === -1 && children > 1) articulation.add(u);
        if (parent[u] !== -1 && low[v] >= disc[u]) articulation.add(u);
        if (low[v] > disc[u]) criticalBridges.push(link);
      } else if (v !== parent[u]) {
        low[u] = Math.min(low[u], disc[v]);
      }
    });
  }

  meshState.nodes.forEach((_, idx) => {
    if (disc[idx] === -1) dfs(idx);
  });

  const spofNodes = Array.from(articulation).map(idx => meshState.nodes[idx]);
  const criticalCounts = criticalBridges.reduce(
    (acc, l) => {
      acc[l.quality] = (acc[l.quality] || 0) + 1;
      return acc;
    },
    { good: 0, marginal: 0, unlikely: 0 }
  );

  return { spofNodes, criticalBridges, criticalCounts };
}

function renderMeshHealthPanel() {
  const { spofNodes, criticalBridges, criticalCounts } = analyzeMeshRobustness();
  const healthSummary = document.getElementById("mesh-health-summary");
  const counts = document.getElementById("mesh-critical-counts");
  const spofList = document.getElementById("mesh-spof-list");
  const critList = document.getElementById("mesh-critical-links");
  if (healthSummary)
    healthSummary.textContent = `Nodes ${meshState.nodes.length} | Links ${meshState.links.length} | Critical links flagged ${criticalBridges.length}`;
  if (counts)
    counts.textContent = `Critical links by quality – Good ${criticalCounts.good || 0}, Marginal ${criticalCounts.marginal || 0}, Unlikely ${criticalCounts.unlikely || 0}`;
  if (spofList) {
    spofList.innerHTML = "";
    if (!spofNodes.length) {
      const li = document.createElement("li");
      li.textContent = "None detected on current good/marginal graph.";
      spofList.appendChild(li);
    } else {
      spofNodes.forEach(n => {
        const li = document.createElement("li");
        li.textContent = `${n.label} (${n.role})`;
        spofList.appendChild(li);
      });
    }
  }
  if (critList) {
    critList.innerHTML = "";
    if (!criticalBridges.length) {
      const li = document.createElement("li");
      li.textContent = "No critical links in marginal/unlikely state.";
      critList.appendChild(li);
    } else {
      criticalBridges
        .filter(l => l.quality === "marginal" || l.quality === "unlikely")
        .forEach(link => {
          const from = meshState.nodes.find(n => n.id === link.fromId);
          const to = meshState.nodes.find(n => n.id === link.toId);
          const li = document.createElement("li");
          li.textContent = `${from?.label || link.fromId} ↔ ${to?.label || link.toId} (${link.quality})`;
          critList.appendChild(li);
        });
      if (!critList.children.length) {
        const li = document.createElement("li");
        li.textContent = "Critical links exist but are currently Good.";
        critList.appendChild(li);
      }
    }
  }
}

function renderOutputs() {
  renderLinkSummary();
  renderRecommendations();
  renderCoverageHints();
  renderNodeDetails();
  renderMeshSummary();
  renderMeshHealthPanel();
}

function renderAll() {
  if (useFallbackCanvas) {
    renderCanvasGraph();
  } else {
    updateNodeMarkers();
    renderLinks();
    updateCoverageCircle();
  }
  renderOutputs();
}

function recomputeMesh(save = true) {
  recomputeLinks();
  syncMeshLinksFromState();
  renderAll();
  if (save) saveToLocalStorage();
}

function buildMissionProjectPayload() {
  const schemaVersion = meshState.schemaVersion || MISSIONPROJECT_SCHEMA_VERSION;
  const version = meshState.version || schemaVersion;
  const baseTopLevel = { ...meshState.missionProjectExtras };
  const environment = {
    ...meshState.environmentExtras,
    terrain: meshState.environment.terrain,
    ew_level: meshState.environment.ewLevel,
    primary_band: meshState.environment.primaryBand,
    design_radius_m: meshState.environment.designRadiusMeters,
    target_reliability_pct: meshState.environment.targetReliability,
    temperature_c: meshState.environment.temperatureC,
    winds_mps: meshState.environment.windsMps,
    altitude_band: meshState.environment.altitudeBand,
    origin_tool: "mesh"
  };

  const nodes = meshState.nodes.map(node => ({
    ...(node.extras || {}),
    id: node.id || generateId("node"),
    label: node.label,
    role: node.role,
    band: node.band,
    lat: node.lat,
    lon: node.lng,
    elevation_m: node.elevationMeters,
    height_agl_m: node.heightAboveGroundMeters,
    max_range_m: node.maxRangeMeters,
    power_w: node.power_w ?? node.powerW,
    battery_hours: node.batteryHours,
    origin_tool: node.origin_tool || node.source || "mesh",
    relay_candidate: node.relayCandidate,
    carried_node_ids: node.carriedNodeIds || []
  }));

  const platforms = meshState.nodes
    .filter(n => n.role === "uxs")
    .map(p => ({
      ...(p.platformExtras || {}),
      id: `${p.id}-platform`,
      label: p.label,
      type: "uxs",
      band: p.band,
      endurance_minutes: p.batteryHours ? Math.round(p.batteryHours * 60) : undefined,
      max_altitude_m: p.heightAboveGroundMeters ? Math.round(p.heightAboveGroundMeters + (p.elevationMeters || 0)) : undefined,
      lat: p.lat,
      lon: p.lng,
      elevation_m: p.elevationMeters,
      origin_tool: p.origin_tool || "mesh",
      carried_node_ids: p.carriedNodeIds || []
    }));

  const links = (meshState.meshLinks?.length ? meshState.meshLinks : meshState.links.map(link => ({
    ...(link.extras || {}),
    id: link.id || `${link.fromId}-${link.toId}`,
    from_id: link.fromId,
    to_id: link.toId,
    distance_m: Math.round(link.distanceOverrideMeters || link.distanceMeters || 0),
    los: link.los,
    estimated_link_quality: meshQualityLabel(link.quality),
    estimated_link_quality_label: meshQualityLabel(link.quality),
    link_margin_db: Math.round(link.linkMarginDb ?? 0),
    estimated_range: Math.round(link.distanceOverrideMeters || link.distanceMeters || 0),
    band: meshState.environment.primaryBand,
    environment_tag: `${meshState.environment.terrain || "unknown"}-${meshState.environment.ewLevel || "EW"}`,
    origin_tool: link.origin_tool || "mesh"
  })));

  return {
    ...baseTopLevel,
    schema: "MissionProject",
    schemaVersion,
    version,
    origin_tool: "mesh",
    mission: { ...meshState.missionExtras, ...meshState.mission },
    environment,
    mesh: {
      rf_bands: Array.from(new Set([meshState.environment.primaryBand, ...meshState.nodes.map(n => n.band).filter(Boolean)])),
      ew_profile: meshState.environment.ewLevel,
      terrain: meshState.environment.terrain,
      design_radius_m: meshState.environment.designRadiusMeters,
      target_reliability_pct: meshState.environment.targetReliability,
      ...meshState.meshExtras
    },
    nodes,
    platforms,
    mesh_links: links,
    kits: meshState.kits || [],
    constraints: meshState.constraints || [],
    notes: meshState.notes
  };
}

function exportMeshToText() {
  const payload = buildMissionProjectPayload();
  const area = document.getElementById("json-area");
  if (area) area.value = JSON.stringify(payload, null, 2);
  setImportStatus("MissionProject JSON copied to text area for review.", "muted");
}

function downloadJson() {
  const now = new Date();
  const filename = `mission-project-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}.json`;
  const blob = new Blob([JSON.stringify(buildMissionProjectPayload(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function setImportStatus(message, tone = "muted") {
  const status = document.getElementById("import-status");
  const banner = document.getElementById("import-error-banner");
  if (!status) return;
  status.textContent = message;
  status.style.color = tone === "error" ? "#ffb3b3" : "var(--muted)";
  status.classList.toggle("error", tone === "error");
  if (banner) {
    if (tone === "error") {
      banner.textContent = message;
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
  }
}

function renderVersionBadges() {
  const headerApp = document.getElementById("app-version-badge");
  const headerSchema = document.getElementById("schema-version-badge");
  const footerApp = document.getElementById("footer-app-version");
  const footerSchema = document.getElementById("footer-schema-version");
  const schemaLabel = `MissionProject schema ${meshState.schemaVersion || MISSIONPROJECT_SCHEMA_VERSION}`;
  [
    [headerApp, APP_VERSION],
    [headerSchema, schemaLabel],
    [footerApp, APP_VERSION],
    [footerSchema, schemaLabel]
  ].forEach(([el, text]) => {
    if (el) el.textContent = text;
  });
}

function renderChangeLog() {
  const container = document.getElementById("change-log-list");
  if (!container) return;
  container.innerHTML = "";
  CHANGE_LOG.forEach(entry => {
    const wrapper = document.createElement("div");
    wrapper.className = "change-log-entry";
    const header = document.createElement("div");
    header.innerHTML = `<strong>${entry.version}</strong> — <span class="muted">${entry.date}</span>`;
    wrapper.appendChild(header);
    if (entry.changes?.length) {
      const list = document.createElement("ul");
      entry.changes.forEach(item => {
        const li = document.createElement("li");
        li.textContent = item;
        list.appendChild(li);
      });
      wrapper.appendChild(list);
    }
    container.appendChild(wrapper);
  });
}

function updateIntegrationStatus(loaded, name, schemaVersion = meshState.schemaVersion) {
  const status = document.getElementById("integration-status");
  const schemaLabel = document.getElementById("integration-schema-version");
  if (status) {
    status.textContent = loaded
      ? `MissionProject loaded: ${name || "Unnamed project"}`
      : "No MissionProject loaded.";
    status.classList.toggle("muted", !loaded);
  }
  if (schemaLabel) {
    if (loaded) {
      schemaLabel.textContent = `Schema version: ${schemaVersion || MISSIONPROJECT_SCHEMA_VERSION}`;
      schemaLabel.classList.remove("muted");
    } else {
      schemaLabel.textContent =
        "Use the Architect Stack hub or Mission Architect to create a MissionProject JSON, then import it here.";
      schemaLabel.classList.add("muted");
    }
  }
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
    const relayCandidate = role === "relay" || (typeof n.weight === "number" && n.weight >= 2);
    return {
      id: n.id || generateId("node"),
      label: n.label || n.id || `Node ${idx + 1}`,
      role,
      band,
      maxRangeMeters: n.maxRangeMeters || ROLE_DEFAULTS[role]?.baseRange || 200,
      lat: n.lat ?? null,
      lng: n.lng ?? null,
      elevationMeters: n.elevationMeters ?? n.altitudeMeters,
      heightAboveGroundMeters: n.heightAboveGroundMeters ?? n.mastHeightMeters,
      source: "nodeArchitect",
      origin_tool: "node",
      notes: n.notes,
      relayCandidate
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
      origin_tool: "uxs",
      notes: n.notes,
      elevationMeters: n.elevationMeters ?? n.altitudeMeters,
      heightAboveGroundMeters: n.heightAboveGroundMeters ?? n.mastHeightMeters ?? 50,
      isAirborne: true
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
    elevationMeters: node.elevationMeters ?? node.altitudeMeters,
    heightAboveGroundMeters: node.heightAboveGroundMeters ?? node.mastHeightMeters,
    source: node.source || "meshImport",
    origin_tool: node.origin_tool || node.source || "mesh",
    relayCandidate: node.relayCandidate,
    isAirborne: node.isAirborne
  }));
  return { nodes, environment: json.environment };
}

function importMissionProject(json) {
  if (json.schema !== "MissionProject") {
    throw new Error("Expected MissionProject schema JSON.");
  }
  const version = json.version || json.schemaVersion;
  if (version && parseFloat(version) < 1.0) {
    throw new Error(`Unsupported MissionProject schema version ${version}. Expected 1.0 or newer.`);
  }
  const schemaVersion = json.schemaVersion || version || MISSIONPROJECT_SCHEMA_VERSION;
  json.schemaVersion = schemaVersion;
  meshState.version = version || schemaVersion;
  meshState.schemaVersion = schemaVersion;

  const knownEnvKeys = new Set(["terrain", "ew_level", "primary_band", "design_radius_m", "target_reliability_pct", "temperature_c", "winds_mps", "altitude_band", "origin_tool"]);
  const environmentExtras = {};
  Object.entries(json.environment || {}).forEach(([k, v]) => {
    if (!knownEnvKeys.has(k)) environmentExtras[k] = v;
  });
  meshState.environmentExtras = environmentExtras;
  meshState.meshExtras = json.mesh ? { ...json.mesh } : meshState.meshExtras || {};
  const missionExtras = {};
  const knownMissionKeys = new Set(["name", "summary", "project_code", "ao", "tasks", "origin_tool"]);
  Object.entries(json.mission || {}).forEach(([k, v]) => {
    if (!knownMissionKeys.has(k)) missionExtras[k] = v;
  });
  meshState.missionExtras = missionExtras;
  const knownTopKeys = new Set(["schema", "schemaVersion", "version", "origin_tool", "mission", "environment", "mesh", "nodes", "platforms", "mesh_links", "kits", "constraints", "notes"]);
  meshState.missionProjectExtras = Object.fromEntries(Object.entries(json).filter(([k]) => !knownTopKeys.has(k)));
  const knownNodeKeys = new Set([
    "id",
    "label",
    "name",
    "role",
    "band",
    "lat",
    "lon",
    "lng",
    "latitude",
    "longitude",
    "elevation_m",
    "elevationMeters",
    "height_agl_m",
    "heightAboveGroundMeters",
    "max_range_m",
    "maxRangeMeters",
    "battery_hours",
    "batteryHours",
    "power_w",
    "powerW",
    "origin_tool",
    "relay_candidate",
    "relayCandidate",
    "carried_node_ids",
    "carriedNodeIds",
    "source"
  ]);
  const nodes = (json.nodes || []).map(node => {
    const extras = Object.fromEntries(Object.entries(node).filter(([k]) => !knownNodeKeys.has(k)));
    return {
      id: node.id || generateId("node"),
      label: node.label || node.name || node.id || "Node",
      role: normalizeRole(node.role || "sensor"),
      band: normalizeBand(node.band),
      maxRangeMeters: node.max_range_m || node.maxRangeMeters || defaultRangeForRole(node.role || "sensor"),
      lat: node.lat ?? node.latitude ?? null,
      lng: node.lon ?? node.lng ?? node.longitude ?? null,
      elevationMeters: node.elevation_m ?? node.elevationMeters,
      heightAboveGroundMeters: node.height_agl_m ?? node.heightAboveGroundMeters,
      batteryHours: node.battery_hours ?? node.batteryHours,
      power_w: node.power_w ?? node.powerW,
      origin_tool: node.origin_tool || node.source || json.origin_tool || "mesh",
      relayCandidate: node.relay_candidate ?? node.relayCandidate,
      carriedNodeIds: node.carried_node_ids || node.carriedNodeIds || [],
      extras
    };
  });

  const knownPlatformKeys = new Set([
    "id",
    "label",
    "name",
    "type",
    "band",
    "lat",
    "lon",
    "lng",
    "latitude",
    "longitude",
    "elevation_m",
    "elevationMeters",
    "max_altitude_m",
    "heightAboveGroundMeters",
    "height_agl_m",
    "origin_tool",
    "carried_node_ids",
    "carriedNodeIds",
    "isAirborne",
    "endurance_minutes",
    "battery_hours"
  ]);

  const platformNodes = (json.platforms || []).map((p, idx) => {
    const extras = Object.fromEntries(Object.entries(p).filter(([k]) => !knownPlatformKeys.has(k)));
    return {
      id: p.id || generateId("uxs"),
      label: p.label || p.name || `Platform ${idx + 1}`,
      role: "uxs",
      band: normalizeBand(p.band || json.environment?.primary_band),
      maxRangeMeters: ROLE_DEFAULTS.uxs.baseRange,
      lat: p.lat ?? p.latitude ?? null,
      lng: p.lon ?? p.lng ?? p.longitude ?? null,
      elevationMeters: p.elevation_m ?? p.elevationMeters,
      heightAboveGroundMeters: p.max_altitude_m ?? p.heightAboveGroundMeters ?? p.height_agl_m,
      origin_tool: p.origin_tool || "uxs",
      carriedNodeIds: p.carried_node_ids || [],
      isAirborne: true,
      platformExtras: extras
    };
  });

  const knownLinkKeys = new Set([
    "id",
    "from_id",
    "to_id",
    "distance_m",
    "los",
    "estimated_link_quality",
    "estimated_link_quality_label",
    "link_margin_db",
    "estimated_range",
    "assumed_band",
    "band",
    "environment_tag",
    "origin_tool",
    "quality"
  ]);

  const links = (json.mesh_links || []).map(l => {
    const extras = Object.fromEntries(Object.entries(l).filter(([k]) => !knownLinkKeys.has(k)));
    return {
      id: l.id || `${l.from_id || ""}-${l.to_id || ""}`,
      fromId: l.from_id,
      toId: l.to_id,
      distanceMeters: l.distance_m,
      distanceOverrideMeters: l.distance_m,
      los: l.los || "LOS",
      quality: l.estimated_link_quality || l.quality || "none",
      linkMarginDb: l.link_margin_db,
      assumedBand: l.assumed_band || l.band || json.environment?.primary_band,
      origin_tool: l.origin_tool || json.origin_tool || "mesh",
      extras
    };
  });

  const meshLinks = (json.mesh_links || []).map(l => {
    const extras = Object.fromEntries(Object.entries(l).filter(([k]) => !knownLinkKeys.has(k)));
    return {
      id: l.id || `${l.from_id || ""}-${l.to_id || ""}`,
      from_id: l.from_id,
      to_id: l.to_id,
      band: l.band || json.environment?.primary_band,
      estimated_range: l.estimated_range || l.distance_m,
      estimated_link_quality: l.estimated_link_quality || l.quality || "unknown",
      estimated_link_quality_label: l.estimated_link_quality_label || l.quality || "unknown",
      environment_tag: l.environment_tag,
      link_margin_db: l.link_margin_db,
      extras
    };
  });

  const environment = {
    terrain: json.environment?.terrain || json.environment?.terrainType || meshState.environment.terrain,
    ewLevel: json.environment?.ew_level || json.environment?.ewLevel || meshState.environment.ewLevel,
    primaryBand: json.environment?.primary_band || json.environment?.primaryBand || meshState.environment.primaryBand,
    designRadiusMeters: json.environment?.design_radius_m || meshState.environment.designRadiusMeters,
    targetReliability: json.environment?.target_reliability_pct || meshState.environment.targetReliability,
    temperatureC: json.environment?.temperature_c,
    windsMps: json.environment?.winds_mps,
    altitudeBand: json.environment?.altitude_band
  };

  return {
    nodes: nodes.concat(platformNodes),
    environment,
    links,
    meshLinks,
    mission: json.mission || meshState.mission,
    kits: json.kits || [],
    constraints: json.constraints || []
  };
}

function applyImportResult(result, mode = "replace", sourceType = "unknown") {
  const nodes = (result.nodes || []).map(ensureLatLng);
  const environment = result.environment;
  const links = result.links || [];
  const meshLinks = result.meshLinks || [];
  const mission = result.mission;
  const kits = result.kits;
  const constraints = result.constraints;
  if (mode === "append") {
    meshState.nodes = meshState.nodes.concat(nodes);
  } else {
    meshState.nodes = nodes;
  }
  meshState.links = links;
  meshState.meshLinks = meshLinks;
  if (environment) {
    meshState.environment = { ...meshState.environment, ...environment };
    syncEnvironmentInputs();
  }
  if (mission) meshState.mission = { ...meshState.mission, ...mission };
  if (kits) meshState.kits = kits;
  if (constraints) meshState.constraints = constraints;
  layoutNodes(meshState.nodes);
  selectedNodeId = null;
  recomputeMesh();
  fitMapToNodes();
  setImportStatus(mode === "append" ? "Imported and appended nodes." : "Imported mesh successfully.");
  renderScenarioBrief(mission?.name || "");
  renderVersionBadges();
  if (sourceType === "mission") updateIntegrationStatus(true, mission?.name || meshState.mission?.name, meshState.schemaVersion);
}

function handleParsedImport(parsed) {
  const mode = getImportMode();
  try {
    if (parsed.source === "NodeArchitect") {
      applyImportResult(importNodeArchitect(parsed), mode, "node");
    } else if (parsed.source === "UxSArchitect") {
      applyImportResult(importUxSArchitect(parsed), mode, "uxs");
    } else if (parsed.schema === "MissionProject") {
      lastMissionProjectJson = parsed;
      applyImportResult(importMissionProject(parsed), mode, "mission");
    } else if (parsed.meshVersion || parsed.environment || parsed.nodes) {
      applyImportResult(importMeshArchitect(parsed), mode, "mesh");
    } else {
      throw new Error("Unsupported JSON payload. Provide MissionProject, Node, UxS, or Mesh Architect JSON.");
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

function handleMissionImport() {
  const text = document.getElementById("json-area")?.value || "";
  if (!text.trim()) return setImportStatus("Paste MissionProject JSON to import.", "error");
  try {
    const parsed = JSON.parse(text);
    if (parsed.schema !== "MissionProject") {
      throw new Error("Expected MissionProject JSON with schema set.");
    }
    lastMissionProjectJson = parsed;
    applyImportResult(importMissionProject(parsed), getImportMode(), "mission");
  } catch (err) {
    setImportStatus(err.message || "Invalid MissionProject JSON provided.", "error");
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
        if (importer === importMissionProject) lastMissionProjectJson = parsed;
        applyImportResult(importer(parsed), getImportMode(), importer === importMissionProject ? "mission" : "file");
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
    node.unplaced = true;
  });
}

function ensureLatLng(node) {
  if (node.lat != null && node.lng != null) return node;
  if (node.x != null || node.y != null) {
    const bounds = map?.getBounds();
    if (bounds) {
      const lat = bounds.getSouth() + (node.y ?? 0.5) * (bounds.getNorth() - bounds.getSouth());
      const lng = bounds.getWest() + (node.x ?? 0.5) * (bounds.getEast() - bounds.getWest());
      return { ...node, lat, lng, unplaced: true };
    }
    const center = mapDefaults.center;
    const span = 0.002;
    const mappedLat = center.lat + ((node.y ?? 0.5) - 0.5) * span;
    const mappedLng = center.lng + ((node.x ?? 0.5) - 0.5) * span;
    return { ...node, lat: mappedLat, lng: mappedLng, unplaced: true };
  }
  return { ...node, lat: null, lng: null, unplaced: true };
}

function loadDemo() {
  const presetSelect = document.getElementById("preset-select");
  const selected = presetSelect?.value;
  const scenario = presetScenarios.find(s => s.id === selected);
  if (!scenario) {
    const center = map?.getCenter?.() || mapDefaults.center;
    meshState.environment = {
      ...meshState.environment,
      terrain: "Suburban",
      ewLevel: "Medium",
      primaryBand: "2.4",
      designRadiusMeters: 360,
      targetReliability: 80
    };
    meshState.nodes = [
      { id: generateId("base"), label: "Base Node", role: "controller", band: "2.4", maxRangeMeters: 420, lat: center.lat, lng: center.lng },
      { id: generateId("relay"), label: "Relay", role: "relay", band: "2.4", maxRangeMeters: 360, lat: center.lat + 0.0006, lng: center.lng + 0.0009 },
      { id: generateId("forward"), label: "Forward Node", role: "client", band: "2.4", maxRangeMeters: 260, lat: center.lat - 0.0005, lng: center.lng + 0.0006 },
      { id: generateId("sensor"), label: "Sensor", role: "sensor", band: "2.4", maxRangeMeters: 260, lat: center.lat + 0.0004, lng: center.lng - 0.0007 }
    ];
    meshState.mission = { ...meshState.mission, name: "Demo mesh scenario", project_code: "DEMO-GENERIC", origin_tool: "demo" };
    meshState.constraints = [];
    meshState.kits = [];
    meshState.schemaVersion = MISSIONPROJECT_SCHEMA_VERSION;
    meshState.version = meshState.schemaVersion;
  } else {
    meshState.environment = { ...meshState.environment, ...scenario.environment };
    meshState.constraints = scenario.constraints || [];
    meshState.kits = scenario.kits || [];
    meshState.mission = {
      name: scenario.label,
      project_code: scenario.id?.toUpperCase?.() || "DEMO",
      origin_tool: "demo"
    };
    meshState.nodes = scenario.nodes.map(n => ({ ...n, source: "demo", origin_tool: "mesh" }));
    meshState.schemaVersion = scenario.schemaVersion || MISSIONPROJECT_SCHEMA_VERSION;
    meshState.version = meshState.schemaVersion;
  }
  syncEnvironmentInputs();
  if (map && scenario?.environment?.center) {
    map.setView([scenario.environment.center.lat, scenario.environment.center.lng], scenario.environment.center.zoom || mapDefaults.zoom);
  }
  layoutNodes(meshState.nodes);
  selectedNodeId = null;
  recomputeMesh();
  fitMapToNodes();
  renderScenarioBrief(selected || "");
  renderVersionBadges();
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
  document.getElementById("import-mission-btn")?.addEventListener("click", handleMissionImport);
  document.getElementById("panel-export-mission-btn")?.addEventListener("click", downloadJson);
  document.getElementById("load-demo-btn")?.addEventListener("click", loadDemo);
  document.getElementById("mission-file-input")?.addEventListener("change", e => handleFileImport(e, importMissionProject));
  document.getElementById("node-file-input")?.addEventListener("change", e => handleFileImport(e, importNodeArchitect));
  document.getElementById("uxs-file-input")?.addEventListener("change", e => handleFileImport(e, importUxSArchitect));
  document.getElementById("mesh-file-input")?.addEventListener("change", e => handleFileImport(e, importMeshArchitect));
  document.getElementById("integration-mission-file")?.addEventListener("change", e => handleFileImport(e, importMissionProject));
  document.getElementById("reimport-mission-btn")?.addEventListener("click", () => {
    if (lastMissionProjectJson) {
      applyImportResult(importMissionProject(lastMissionProjectJson), getImportMode(), "mission");
    } else {
      setImportStatus("No MissionProject cached. Load a file first.", "error");
    }
  });
  document.getElementById("reset-btn")?.addEventListener("click", () => {
    meshState.nodes = [];
    selectedNodeId = null;
    recomputeMesh();
  });
  document.getElementById("restore-btn")?.addEventListener("click", restoreFromLocalStorage);
  document.getElementById("export-kml-btn")?.addEventListener("click", exportMeshToKml);
  document.getElementById("export-geojson-btn")?.addEventListener("click", exportMeshToGeoJson);
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
    <Style id="link-unlikely"><LineStyle><color>ff3c7ff0</color><width>2</width></LineStyle></Style>`;

  const nodePlacemarks = meshState.nodes
    .map(
      node => `    <Placemark>
      <name>${node.label}</name>
      <description>${node.role} • ${node.band} GHz • ${node.maxRangeMeters} m${node.elevationMeters ? ` • Elev ${node.elevationMeters} m` : ""}${node.heightAboveGroundMeters ? ` • Height ${node.heightAboveGroundMeters} m AGL` : ""}</description>
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
      <description>Distance ${Math.round(link.distanceMeters)} m • LOS ${link.los}</description>
      <styleUrl>#link-${link.quality}</styleUrl>
      <LineString><coordinates>${from.lng},${from.lat},0 ${to.lng},${to.lat},0</coordinates></LineString>
    </Placemark>`;
    })
    .join("\n");

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
  <name>${meshState.mission?.name || "Mesh Architect export"}</name>
  <description>Project ${meshState.mission?.project_code || "n/a"} • Terrain ${meshState.environment.terrain} • EW ${meshState.environment.ewLevel}</description>
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
  const payload = {
    type: "cot-snapshot",
    generated: now.toISOString(),
    project: meshState.mission?.name,
    project_code: meshState.mission?.project_code,
    environment: {
      terrain: meshState.environment.terrain,
      ew_level: meshState.environment.ewLevel,
      primary_band: meshState.environment.primaryBand
    },
    units: meshState.nodes.map(node => ({
      uid: node.id,
      callsign: node.label,
      role: node.role,
      band: node.band,
      lat: node.lat,
      lon: node.lng,
      hae: (node.elevationMeters || 0) + (node.heightAboveGroundMeters || 0),
      remarks: `${node.maxRangeMeters || ROLE_DEFAULTS[node.role]?.baseRange || 0} m range`
    })),
    links: meshState.links.map(link => ({
      from_id: link.fromId,
      to_id: link.toId,
      quality: link.quality,
      link_margin_db: Math.round(link.linkMarginDb || 0),
      band: meshState.environment.primaryBand,
      environment_tag: `${meshState.environment.terrain || "unknown"}-${meshState.environment.ewLevel || "EW"}`
    }))
  };

  const filename = `mesh-architect-atak-cot-${now
    .toISOString()
    .slice(0, 16)
    .replace(/[:T]/g, "-")}.json`;
  downloadTextFile(filename, JSON.stringify(payload, null, 2), "application/json");
}

function exportMeshToGeoJson() {
  const features = [];
  const metadata = {
    mission: meshState.mission?.name,
    project_code: meshState.mission?.project_code,
    environment: {
      terrain: meshState.environment.terrain,
      ew_level: meshState.environment.ewLevel,
      primary_band: meshState.environment.primaryBand
    }
  };
  meshState.nodes.forEach(node => {
    if (node.lat == null || node.lng == null) return;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [node.lng, node.lat, node.heightAboveGroundMeters ?? 0] },
      properties: {
        id: node.id,
        name: node.label,
        role: node.role,
        band: node.band,
        estimated_link_quality: "n/a",
        environment_tag: `${meshState.environment.terrain || "unknown"}-${meshState.environment.ewLevel || "EW"}`,
        maxRangeMeters: node.maxRangeMeters,
        elevationMeters: node.elevationMeters,
        heightAboveGroundMeters: node.heightAboveGroundMeters,
        source: node.source,
        origin_tool: node.origin_tool || node.source || "mesh",
        mission_project: { name: meshState.mission?.name, project_code: meshState.mission?.project_code }
      }
    });
  });

  meshState.links.forEach(link => {
    const from = meshState.nodes.find(n => n.id === link.fromId);
    const to = meshState.nodes.find(n => n.id === link.toId);
    if (!from || !to) return;
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [from.lng, from.lat, from.heightAboveGroundMeters ?? 0],
          [to.lng, to.lat, to.heightAboveGroundMeters ?? 0]
        ]
      },
      properties: {
        id: link.id || `${link.fromId}-${link.toId}`,
        from: from.label,
        to: to.label,
        band: meshState.environment.primaryBand,
        distanceMeters: Math.round(link.distanceMeters),
        los: link.los,
        estimated_link_quality: meshQualityLabel(link.quality),
        link_margin_db: Math.round(link.linkMarginDb || 0),
        environment_tag: `${meshState.environment.terrain || "unknown"}-${meshState.environment.ewLevel || "EW"}`
      }
    });
  });

  const geo = { type: "FeatureCollection", properties: metadata, features };
  const now = new Date();
  const filename = `mesh-architect-geojson-${now.toISOString().slice(0, 16).replace(/[:T]/g, "-")}.geojson`;
  downloadTextFile(filename, JSON.stringify(geo, null, 2), "application/geo+json");
}

function fitDesignToInputs() {
  renderMeshSummary();
}

function renderScenarioBrief(presetId) {
  const card = document.getElementById("scenario-brief-card");
  const textEl = document.getElementById("scenario-brief-text");
  if (!card || !textEl) return;
  const label = (presetId || meshState.mission?.name || "").toString().toLowerCase();
  const isWhitefrost = label.includes("whitefrost");
  if (!isWhitefrost) {
    card.hidden = true;
    textEl.textContent = "";
    return;
  }

  card.hidden = false;
  textEl.textContent =
    "Ridgeline-focused mesh with cold-weather sustainment and contested EW; favor warmed controllers, ridgeline relays, and LOS-preserving routes.";
}

function init() {
  renderVersionBadges();
  renderChangeLog();
  initMap();
  wireUI();
  initDemoBanner();
  updateIntegrationStatus(false);
  fitDesignToInputs();
  restoreFromLocalStorage();
  layoutNodes(meshState.nodes);
  recomputeMesh(false);
  fitMapToNodes();
}

document.addEventListener("DOMContentLoaded", init);
