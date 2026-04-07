# SuperSplat — Interactive Apartment Selector Plan

## Context

Building a 3D interactive apartment unit selector using the SuperSplat Gaussian-splat viewer fork. The goal is a dual-mode application:
- **Editor mode** (`/`): full SuperSplat interface for authoring scenes
- **Viewer mode** (`/?mode=viewer`): clean 3D viewport + apartment list sidebar, suitable for embedding in a website

---

## Phase 1 — Unit Highlights (bbox) ✅

- Unit JSON format v1.0: `{ version, units: [{ id, label, status, bbox }] }`
- `Unit` element renders a semi-transparent colored box per status (green/orange/gray)
- Hover + click selection with highlight states (default / hover / selected)
- `UnitManager` handles CPU raycasting via `BoundingBox.intersectsRay()`
- Events: `unit.select`, `unit.hovered`, `unit.selected`, `unit.filter`

---

## Phase 2 — GLB Import + Scene Manager integration ✅

- `Model` element: imports `.glb` / `.gltf` files, unlit rendering (diffuse → emissive copy)
- All element types (Splat, Model, Unit group) appear in Scene Manager list
- Selection, Transform panel, hide/show, delete — work for all types
- Camera Focus / Frame Selection works for all element types
- UI forced to English (removed `navigator` from i18next detection)

---

## Phase 2.5 — Mapping Export System (MaxScript + mesh-based highlights) ✅

### MaxScript exporter (`export_mappings.ms`)
- Exports selected objects from 3ds Max as `mappings.json` format v2.0
- **Coordinate system conversion** (3ds Max Z-up → PlayCanvas Y-up):
  - `PC.x =  Max.x`
  - `PC.y =  Max.z`  (Max Z becomes PlayCanvas Y)
  - `PC.z = -Max.y`  (Max Y becomes PlayCanvas −Z)
- Uses `snapshotAsMesh` to bake all modifiers (TurboSmooth, ProBoolean, etc.) into triangles
- Float export: `v as string` — native MaxScript float-to-string (~6 significant digits, no printf bugs)
- Custom `joinArray arr sep` helper — MaxScript does not have `implode`
- Save File dialog, skips non-geometry objects, summary messageBox at the end
- Only exports currently selected objects

### JSON format v2.0
```json
{
  "version": "2.0",
  "mappings": [
    {
      "id": "BNR 01 TYPE A",
      "label": "BNR 01 TYPE A",
      "status": "available",
      "mesh": {
        "vertices": [x1,y1,z1, x2,y2,z2, ...],
        "indices": [0,1,2, 0,2,3, ...]
      },
      "bbox": { "min": [x,y,z], "max": [x,y,z] }
    }
  ]
}
```
- `mesh` is actual polygon geometry from Max — supports L/T/U/arbitrary shapes, not just boxes
- `bbox` is computed from the mesh vertices in PlayCanvas space (used for O(1) raycasting pre-filter)

### Engine-side changes
- `Unit.addMesh()` builds a `PlayCanvas.Mesh` from the exported vertex/index arrays
- `Unit.worldBound` returns `worldBBox` so units participate in `fitClippingPlanes()`
- `addMesh()` / `addBox()` / `move()` all set `scene.boundDirty = true`
- Backward-compatible: v1.0 `units` array still works (falls back to box rendering)
- Multiple imports are **additive** — same ID overwrites, new IDs accumulate
- `UnitManager.getWorldBound()` — aggregate BoundingBox of all loaded units
- Clicking "Unit Highlights (N)" row in Scene Manager frames all units in viewport

---

## Phase 2.6 — Project Save/Load (.ssproj) ✅

The `.ssproj` format is a ZIP archive. Extended to include custom data:

### `document.json` additions
```json
{
  "version": 1,
  "splats": [...],
  "models": [
    {
      "index": 0,
      "name": "Building",
      "visible": true,
      "position": [x,y,z],
      "rotation": [x,y,z,w],
      "scale": [x,y,z]
    }
  ],
  "unitsData": {
    "version": "2.0",
    "mappings": [...]
  }
}
```

### ZIP contents
- `document.json` — all metadata including models list and units JSON
- `splat_0.ply`, `splat_1.ply`, ... — Gaussian splat data (existing format)
- `model_0.glb`, `model_1.glb`, ... — raw GLB binary for each imported model

### How it works
- **Save**: `Model.rawData` (ArrayBuffer stored on import) is written to `model_N.glb`
- **Load**: bytes read from zip → blob URL → PlayCanvas Asset → Model entity, transform restored
- **Clear**: `scene.clear()` also destroys Model elements; `resetScene()` calls `unitManager.clearAll()`
- **Limitation**: models loaded from remote URL (not file drop) have no `rawData` — logged as warning

---

## Phase 3 — Editor / Viewer mode split ✅

- Mode controlled by URL parameter: `?mode=viewer` vs default editor mode
- **Viewer mode** hides all editor-specific UI: menus, toolbars, scene panel, status bar, timeline, data panel
- **Editor mode** is fully unchanged — complete SuperSplat interface
- Detected in `main.ts` via `url.searchParams.get('mode')`, passed to `EditorUI(events, mode)`

---

## Phase 4 — Viewer right panel (apartment list) ✅

- **70/30 split**: 3D viewport (left, flex) + apartment list panel (right, 30%)
- **`ViewerPanel`** component (`src/ui/viewer-panel.ts`):
  - Header row: "Apartments" label + "Open" button (fires `doc.open` to load `.ssproj`)
  - Populates from `units.loaded` event — shows all unit IDs as scrollable list
  - Click item → `unit.select` event (toggles selection, deselects on second click)
  - `unit.selected` event → highlights row in orange + scrolls into view
- Custom dark scrollbar matching the theme
- CSS: `#editor-container.viewer-mode` sets flex layout for 70/30 split

---

## Phase 5 — Advanced Viewer UI (TODO)

Replace the simple apartment list with rich UI from the 2D unit selector project:
- Floor filter tabs
- Status filter (available / reserved / sold)
- Unit detail cards (area, rooms, price)
- Responsive layout for mobile
- The 2D selector project lives in a sibling directory — Claude can read files from any path on the machine

---

## How to run

**Editor mode** (full SuperSplat interface):
```
http://localhost:3000/
```

**Viewer mode** (apartment selector):
```
http://localhost:3000/?mode=viewer
```

In viewer mode, click **Open** in the top-right panel to load a `.ssproj` project file.
Drag-and-drop also works anywhere on the canvas.

---

## Key files

| File | Purpose |
|------|---------|
| `src/unit.ts` | Unit element: mesh/box rendering, highlight states, worldBBox for raycasting |
| `src/unit-manager.ts` | Loads units, pointer events, hover/select state machine, serialize/clear |
| `src/model.ts` | GLB model element: unlit rendering, rawData for project save |
| `src/file-handler.ts` | Detects + imports PLY / GLB / JSON; stores rawData on GLB load |
| `src/doc.ts` | Project save/load (.ssproj ZIP): extended to include models + units |
| `src/scene.ts` | `clear()` extended to also destroy Model elements |
| `src/ui/viewer-panel.ts` | Right panel: Open button + scrollable apartment list |
| `src/ui/editor.ts` | Top-level UI: editor vs viewer mode switching |
| `src/main.ts` | App bootstrap: reads `?mode=viewer` URL param |
| `export_mappings.ms` | 3ds Max MaxScript: exports selected mesh objects as mappings.json v2.0 |

---

## MaxScript critical notes

- **`v as string`** — correct float-to-string (NOT `formattedPrint` or `format "%.6f" to:StringStream`)
- **`joinArray arr sep`** — custom helper because MaxScript has no `implode`
- **`snapshotAsMesh obj`** — bakes all modifiers (TurboSmooth, ProBoolean) before export
- **Triangle winding** — doesn't matter because materials use `CULLFACE_NONE` (double-sided)
- **Mesh size** — typical apartment: 12–24 verts, 20–44 tris. 100 apartments ≈ 5000 verts ≈ 1MB JSON
