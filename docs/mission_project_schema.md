# MissionProject JSON schema (Ceradon Architect Stack)

Mesh Architect now imports and exports a shared **MissionProject** document used across the Ceradon Architect Stack. The schema is stable for offline use and is resilient to partial payloads (missing kits, platforms without nodes, or placeholder mesh links).

- Root object fields: `schema` ("MissionProject"), `version` (e.g., "1.0"), `origin_tool`, `mission`, `environment`, `nodes`, `platforms`, `mesh_links`, `kits`, `constraints`, and optional `notes`.
- **Stable IDs:** every entity carries an `id` that remains stable when moving between tools. Reuse upstream IDs where possible; Mesh Architect will generate `mesh-xxxxxx` IDs if missing.
- **Origin tags:** `origin_tool` should be one of `node`, `uxs`, `mesh`, `kit`, or `mission` to track provenance.

## Nodes array
Each node represents a radio/compute endpoint.
- Required: `id`, `label`, `role` (`controller` | `relay` | `sensor` | `client` | `uxs`), `band` (`900` | `1.2` | `2.4` | `5.8` | `other`).
- Geo fields: `lat`, `lon`, optional `elevation_m` (ASL) and `height_agl_m` (mast/drone height). Missing coordinates are auto-laid out on import.
- Power: optional `power_w`, `battery_hours`, `battery_type`.
- Mesh: `max_range_m`, `origin_tool`, optional `relay_candidate` flag.
- Roles: include mission intent in `role` (e.g., `controller` vs `relay`).

## Platforms array
Platforms describe air/ground vehicles that can host nodes.
- Fields: `id`, `label`, `type` (e.g., `quad`, `ground_rover`, `balloon`), `band`, `payload_capacity_kg`, `endurance_minutes`, `max_altitude_m`, `lat`, `lon`, `elevation_m`, `origin_tool` (often `uxs`).
- `carried_node_ids` links installed nodes.

## Mesh_links array
Links represent planned connectivity.
- Fields: `id`, `from_id`, `to_id`, `distance_m`, `los` (`LOS` | `NLOS-urban` | `NLOS-foliage/terrain`), `quality` (`good` | `marginal` | `unlikely` | `none`), `assumed_band`, `origin_tool`.
- Placeholder links are allowed (missing `distance_m`); Mesh Architect will recompute distances when coordinates exist.

## Kits array
KitSmith- or Mission-Architect-style logistics entries.
- Fields: `id`, `label`, `contents` (array of `{ item, qty, notes }`), `power_profile` (e.g., `{ battery_type, battery_hours, power_w }`), `origin_tool` (often `kit`).
- Mesh Architect currently exports an empty array but will preserve inbound kits.

## Mission object
Describes the plan.
- Fields: `name`, `summary`, `project_code`, `ao` (area of operations description), `tasks`, `origin_tool` (often `mission`).

## Environment object
- Fields: `terrain`, `ew_level`, `primary_band`, `design_radius_m`, `target_reliability_pct`, `temperature_c`, `winds_mps`, `altitude_band` (e.g., `high-mountain`), `origin_tool`.

## Constraints array
Optional operational constraints.
- Fields: `id`, `type` (`power`, `logistics`, `weather`, `regulatory`), `description`, `severity` (`info` | `caution` | `critical`).

## Graceful degradation
- Missing arrays are treated as empty.
- Entities without coordinates are placed near the map center when imported into Mesh Architect.
- Unknown bands or roles are rejected with a clear error; known values are normalized.
- Additional fields are preserved and round-tripped.
