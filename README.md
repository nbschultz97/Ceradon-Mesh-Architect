# Ceradon Mesh Architect v0.1

Ceradon Mesh Architect is a lightweight, static single-page planner for multi-node RF meshes. It provides a browser-based canvas to place controllers, relays, sensors, and UxS platforms, estimating link quality under different terrain and EW conditions. Outputs include link summaries, relay recommendations, coverage hints, and JSON import/export ready for future integration with the Ceradon Node Architect and UxS Architect tools.

## Run the app
- Open `index.html` locally in a modern browser; no build step or backend required.
- Or visit the GitHub Pages deployment: https://nbschultz97.github.io/Ceradon-Mesh-Architect/

## Basic usage
1. Set the environment: terrain, EW/interference level, and primary band.
2. Define coverage goals: design radius and target reliability.
3. Add nodes using the catalog buttons; drag them on the canvas to adjust layout.
4. Review link quality, relay/gateway recommendations, and coverage hints in the right panel.
5. Export the mesh JSON for sharing, or import Node Architect / UxS Architect JSON as inputs.
6. Load the demo scenario for a quick starting point.

## Import and export
- **Export current mesh JSON** populates a JSON block containing the environment, nodes, and computed links. You can also download it as `ceradon-mesh.json`.
- **Import** accepts:
  - Full mesh JSON (environment, nodes, optional links)
  - Node Architect JSON (`source: "NodeArchitect"` with `nodes`) 
  - UxS Architect JSON (`source: "UxSArchitect"` with `uxsPlatforms`)
- On import, the app auto-lays out nodes and recomputes links using the current environment settings.

## Notes
- All logic runs in-browser with localStorage persistence to keep your last session.
- Node defaults are heuristic and intended for early planning; future versions will refine propagation, add map layers, and deepen Node/UxS Architect integration.
