# Ceradon Mesh Architect v0.2

Ceradon Mesh Architect is a lightweight, static single-page planner for multi-node RF meshes. Version 0.2 swaps the abstract canvas for a Leaflet map so you can drop controllers, relays, sensors, clients, and UxS on real geography, drag them in place, and see live link quality overlays. Outputs include link summaries, relay recommendations, coverage hints, and JSON import/export ready for future integration with the Ceradon Node Architect and UxS Architect tools.

## Run the app
- Open `index.html` locally in a modern browser; no build step or backend required.
- Or visit the GitHub Pages deployment: https://nbschultz97.github.io/Ceradon-Mesh-Architect/

## Basic usage
1. Set the environment: terrain, EW/interference level, and primary band.
2. Define coverage goals: design radius and target reliability.
3. Choose a preset Area of Operations (AO) in **Quick Demo** and click **Load demo scenario**, or pick **None** for a blank map.
4. Add nodes using the catalog buttons, then click the map to place each node. Drag markers to reposition; popups show labels/roles.
5. Review link quality lines on-map plus the **Link Summary** table, recommendations, and coverage hints in the right panel. The mesh summary card reports node counts and network robustness.
6. Export the mesh JSON for sharing, or import Node Architect / UxS Architect / saved Mesh Architect JSON as inputs.

## Import and export
- **Export current mesh JSON** populates a JSON block containing the environment, nodes (with `lat`/`lng`), and computed links. You can also download a timestamped file (`mesh-architect-export-YYYYMMDD-HHMM.json`).
- **Import** accepts:
  - Full mesh JSON (environment, nodes, optional links) including older x/y-only layouts (they map into the visible map bounds).
  - Node Architect JSON (`source: "NodeArchitect"` with `nodes`)
  - UxS Architect JSON (`source: "UxSArchitect"` with `uxsPlatforms`)
- On import, the app auto-lays out nodes, centers the map, and recomputes links using the current environment settings.
- You can paste JSON, pick a `.json` file, or restore the last saved session from localStorage.

## Demo flows
- **Preset AO dropdown** provides Urban, Rural valley, and Forward operating site scenarios with tuned environment assumptions and node placements.
- **Coverage circle** highlights the design radius around the first controller/gateway.
- **Map interactions**: click a catalog button then click the map to place a node; drag markers to refine positions; click a marker to edit details or delete.
