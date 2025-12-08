# Ceradon Mesh Architect v0.3

Mesh Architect is a lightweight, static single-page RF mesh planner. It sits between heavyweight propagation suites (HTZ Warfare / CloudRF-class) and “tape antennas on rucks and try it” field experiments. Drop controllers, relays, sensors, clients, and small UxS on a Leaflet map, drag them into place, and check link robustness under terrain and EW assumptions. The tone is intentionally sober: no guaranteed coverage claims, no classified networks, and nothing tied to specific programs of record.

Key context:
- Terrain and EW/interference sliders exist because link budgets move with clutter and hostile emitters; you can see margins shrink as assumptions tighten.
- TAK/ATAK is the dominant geospatial SA platform. KML/CoT/GeoJSON exports help move this plan into the TAK Server ecosystem without custom glue.
- Small UxS and COTS radios in contested RF are fickle. Mesh Architect helps you test spacing and relay depth before walking outside with a kit bag.

## Run the app
- Open `index.html` locally in a modern browser; no build step or backend required.
- Or visit the GitHub Pages deployment: https://nbschultz97.github.io/Ceradon-Mesh-Architect/

## Where Mesh Architect fits in the Ceradon Architect Stack
- **Node Architect:** defines nodes (compute + radios + antennas + power).
- **UxS Architect:** defines platforms (air/ground) that can carry those nodes.
- **Mesh Architect:** uses those building blocks on a real AO map to check RF connectivity under terrain + EW pressure.
- **KitSmith / Mission Architect:** turns architectures into kit lists and mission cards.

## Basic usage
1. Set environment sliders: terrain, EW/interference level, and primary band.
2. Define coverage goals: design radius and desired link reliability.
3. Choose a preset Area of Operations (AO) in **Quick Demo** and click **Load demo scenario**, or pick **None** for a blank map.
4. Add nodes using the catalog buttons, then click the map to place each node. Drag markers to reposition; popups show labels/roles.
5. Review link quality lines on-map plus the **Link Summary** (sorted worst first), recommendations, coverage hints, and mesh snapshot (node/role counts and link health).
6. Export the mesh JSON for sharing, or import Node Architect / UxS Architect / saved Mesh Architect JSON. Import defaults to replace; you can switch to append.

## Import and export
- **Export current mesh JSON** populates a JSON block containing the environment, nodes (with `lat`/`lng`), and computed links. You can also download a timestamped file (`mesh-architect-export-YYYYMMDD-HHMM.json`).
- **Import** options (paste JSON or load a `.json` file):
  - **Node Architect JSON**
    ```json
    {
      "source": "NodeArchitect",
      "nodes": [
        {
          "id": "NA-001",
          "label": "FPV Relay Node",
          "role": "relay",
          "band": "5.8",
          "maxRangeMeters": 300,
          "notes": "Optional free-text"
        }
      ]
    }
    ```
    - `role` maps to Mesh Architect roles: `controller` | `relay` | `sensor` | `client` | `uxs`.
    - `band` is one of `900` | `1.2` | `2.4` | `5.8` | `other`.
    - `maxRangeMeters` overrides the role default. `lat`/`lng` are optional; missing values are auto-laid out around the current map center.
  - **UxS Architect JSON**
    ```json
    {
      "source": "UxSArchitect",
      "uxsPlatforms": [
        {
          "id": "UXS-01",
          "label": "Quad Trainer",
          "role": "uxs",
          "band": "2.4",
          "maxRangeMeters": 500,
          "carriedNodeIds": ["NA-001"],
          "notes": "Optional free-text"
        }
      ]
    }
    ```
    - Each `uxsPlatform` becomes a Mesh Architect node with role `uxs`.
    - `carriedNodeIds` are stored for future linking; lat/lng are optional and will be placed near the map center if absent.
  - **Mesh Architect JSON**
    ```json
    {
      "meshVersion": "0.3",
      "environment": { "terrain": "Urban", "ewLevel": "Medium", "primaryBand": "2.4" },
      "nodes": [
        { "id": "controller-1", "label": "Gateway", "role": "controller", "band": "2.4", "lat": 40.76, "lng": -111.89 },
        { "id": "relay-1", "label": "Relay", "role": "relay", "band": "2.4", "x": 0.2, "y": 0.7 }
      ],
      "links": []
    }
    ```
    - `meshVersion`, `environment`, `nodes`, and optional `links` are accepted.
    - Nodes with `x`/`y` instead of `lat`/`lng` are mapped into the visible bounds; missing coordinates are auto-laid out.
- On import, the app auto-lays out any nodes missing coordinates, centers/fits the map, and recomputes links with the current environment settings. Choose **Replace current mesh** or **Append to current mesh** before importing.
- You can also restore the last saved session from localStorage.

## Demo flows
- **Preset AO dropdown** provides Urban, Rural valley, and Forward operating site scenarios with tuned environment assumptions and node placements.
- **Coverage circle** highlights the design radius around the first controller/gateway.
- **Map interactions**: click a catalog button then click the map to place a node; drag markers to refine positions; click a marker to edit details or delete.
