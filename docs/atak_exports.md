# ATAK / tactical app export stubs

Mesh Architect can export the active plan into formats that TAK Server or lightweight tactical companions can ingest offline. Exports are derived from the MissionProject view of the mesh state.

## GeoJSON
- **Points:** one feature per node with `id`, `name`, `role`, `band`, `maxRangeMeters`, `elevationMeters`, `heightAboveGroundMeters`, `origin_tool`, and `mission_project` metadata (`project`, `environment`). Coordinates include altitude when available.
- **Lines:** one feature per computed link with `from`, `to`, `distanceMeters`, `los`, `quality`, and `assumed_band`.
- Example usage: drop the `.geojson` into TAK Server or any offline GIS viewer.

## CoT-style JSON snapshot
Mesh Architect now emits a lightweight CoT-inspired JSON file instead of XML:
```json
{
  "type": "cot-snapshot",
  "generated": "2024-01-01T00:00:00Z",
  "project": "WHITEFROST Demo",
  "environment": {"terrain": "Alpine", "ew_level": "Medium", "primary_band": "2.4"},
  "units": [
    {"uid": "controller-1", "callsign": "Gateway", "role": "controller", "band": "2.4", "lat": 44.4, "lon": -121.7, "hae": 0}
  ]
}
```
- Fields map directly to node metadata; `hae` uses `elevationMeters + heightAboveGroundMeters` when available.
- Designed to be easy to parse on edge devices or fed into a CoT bridge service.

## KML
KML export remains available for compatibility; placemarks include role/band/range and links are styled by quality (good/marginal/unlikely).

## Notes
- Exports are static snapshots; re-run after adjusting node positions or environment.
- External dependencies are limited to local file download; no network calls are made during export.
