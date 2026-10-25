# Blender construction adapter

`build_scene.py` reads the canonical JSON scene and builds fixed architecture plus the approved movable objects. It produces `brannan.glb`, `brannan.blend`, `reference.png`, and `build-report.json`. Movable furniture appears in the saved Blender scene and reference render but is deliberately omitted from GLB so the browser can edit furniture without rebuilding the home or displaying duplicate pieces.

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.0/blender.exe' --background --python blender/build_scene.py -- --scene shared/brannan.json --out public/generated
```

Use `--skip-render` for a quick geometry rebuild. The default reference render uses the `living` camera toward the kitchen and stairs, broadly corresponding to source `photo-1`; it includes every movable object supplied in the scene. Camera registration is approximate, not a calibrated photogrammetry solution.

Interior cameras use an explicit 67.3-degree vertical field of view in both Blender and the browser. Blender's vertical sensor fit keeps that angle stable across output aspect ratios; horizontal framing can still differ when the browser viewport has a different aspect ratio.

## Approved furniture and the final visual critique

Pass the accepted photo-derived or user-edited objects in `scene.objects` with `movable: true` before building. The builder preserves each object's stable ID, source basis, center position, dimensions, rotation, and finish. It constructs recognizable sofas, chairs, desks, tables, rugs, shelves, and plants; other kinds receive a dimensioned body. It does not itself infer an object from a photograph or approve an asset.

Furniture meshes are parented under the corresponding canonical object transform in `.blend`. At rotation zero, chair and sofa backs face canonical +Y, matching the browser convention. The final render therefore contains the accepted furniture arrangement and can be supplied to the visual critic together with source images. A new render should be requested after accepted furniture changes; a previously rendered image is not evidence of the current scene.

`build-report.json` reports `furnitureCount`, `furnitureIds`, `furnitureMeshCount`, `furnitureIncludedInBlend`, and `furnitureIncludedInRender`. `movableFurnitureExported` remains false. The browser's dynamic furniture layer stays the only visible furniture layer when loading `brannan.glb`.

## Coordinate and semantic contract

- Source units: metres, floor XY, Z up. All object and stair positions are bounding-box centers.
- Wall openings use center distance from wall start. Geometry creates real openings from wall segments; no boolean dependency is required.
- Blender's glTF exporter produces standard Y-up GLB, corresponding to Three.js `(x, z, -y)`. Do not rotate the exported scene a second time.
- Each exported mesh carries `sceneId`, `role`, `basis`, and `fixed` extras. Several meshes can share one semantic sceneId.
- Hide meshes with `role === 'ceiling'` for the dollhouse view. They can be restored in first-person views. Walls and trim are independently tagged for optional cutaway views.
- Geometry-derived checks use canonical JSON, not decorative mesh triangles.

## Sources and assumptions

The event-created Brannan fixture traces the listing's floor plan and uses labelled living-room, kitchen, and bathroom dimensions to establish approximate scale. The original plan says it is based on a Matterport scan. Lower-floor room topology is preserved. The exterior window, kitchen placement, and staircase are source-backed.

Four selected listing photographs inform the reddish timber floor, exposed concrete ceiling, dark cherry cabinets, white counters, brushed metal appliances, and metal staircase. They are remote evidence references, not repository assets. Every mesh and material in the export is generated procedurally.

The starter refrigerator was revised to an estimated 0.86 m width along the east wall after visual comparison showed the earlier 0.44 m placeholder was too narrow. Its adjacent cooking counter preserves the south-counter join. Concrete uses a small, deterministic generated aggregate texture embedded in GLB; the entry door and floor palette are also photo-informed appearance details. Lighting is controlled for legibility and is not a reconstruction of measured illumination. The closed entry door is decorative geometry: route checks begin inside the foyer and do not certify passage through that leaf or its swing.

Ceiling height, wall thickness, stair rise/run, openings' vertical dimensions, appliance dimensions, material shades, and detailed cabinet divisions are estimates. This is a useful editable reconstruction, not a surveyed or code-certified model. Upstairs is outside the MVP. The source's 1,379 sq ft total and the listing's 1,420 sq ft remain an explicitly recorded disagreement.

## Optional installed Blender MCP transport

`start_mcp.py` starts the already-installed add-on for one Blender session, without saving preferences. The add-on requires the regular Blender timer loop; launching with `--background` does not keep that loop active after startup.

`bridge.py --health` checks the installed add-on's localhost socket. `bridge.py --scene ... --out ... --transport auto` runs the same deterministic builder over that socket when connected and otherwise uses an isolated Blender CLI process. `--transport mcp` requires a successful real MCP add-on connection. The build report records the actual transport.

The startup script marks only its task-owned session in Blender's driver namespace. Before any scene mutation, the bridge reads this marker through a trusted, read-only probe. An unmarked listener is never modified: automatic transport uses an isolated CLI process, and explicit MCP transport returns an error. The marker is checked again immediately before construction and inside the builder before clearing a session.

The socket is the existing Blender MCP add-on's local transport. The bridge does not claim to implement a separate MCP server. It sends only the repository builder, not arbitrary model-authored Python. Session rebuilding preserves the add-on by using `--keep-session`.
