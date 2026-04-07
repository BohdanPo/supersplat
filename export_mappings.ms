-- =============================================================================
-- export_mappings.ms
-- SuperSplat Mapping Exporter for 3ds Max
--
-- Exports selected objects as apartment mapping geometry (mesh-based, not bbox)
-- so each apartment can be highlighted individually in the SuperSplat viewer.
--
-- Usage:
--   1. Select the mapping objects in 3ds Max (one per apartment)
--   2. Run this script via Scripting > Run Script
--   3. Choose output path in the Save File dialog
--   4. Import the resulting .json into SuperSplat via "Import Scene"
--
-- Coordinate system:
--   3ds Max (Z-up)  -->  PlayCanvas / GLB (Y-up)
--   PC.x =  Max.x
--   PC.y =  Max.z   (Max Z becomes PlayCanvas Y)
--   PC.z = -Max.y   (Max Y becomes PlayCanvas -Z)
-- =============================================================================

-- ── Helpers ──────────────────────────────────────────────────────────────────

-- Convert a float to string.
-- MaxScript's "as string" gives ~6 significant digits which is fine for
-- building-scale coordinates. No custom formatting needed.
fn fmtFloat v = (
    v as string
)

-- Join a MaxScript array of strings with a separator.
fn joinArray arr sep = (
    local result = ""
    for i = 1 to arr.count do (
        if i > 1 do result += sep
        result += arr[i]
    )
    result
)

-- Escape double-quotes in a string for JSON embedding.
fn jsonEscape s = (
    local out = ""
    for i = 1 to s.count do (
        if s[i] == "\"" then out += "\\\""
        else out += s[i]
    )
    out
)

-- ── Per-object export ─────────────────────────────────────────────────────────

fn exportObject obj = (
    -- Bake all modifiers (TurboSmooth, ProBoolean, etc.) into a triangle mesh
    local snapped = snapshotAsMesh obj

    local numVerts = snapped.numVerts
    local numFaces = snapped.numFaces

    -- ── Vertices ──────────────────────────────────────────────────────────────
    local vertParts = #()
    local pcMinX = 0.0
    local pcMinY = 0.0
    local pcMinZ = 0.0
    local pcMaxX = 0.0
    local pcMaxY = 0.0
    local pcMaxZ = 0.0
    local bboxInit = false

    for i = 1 to numVerts do (
        local vMax = getVert snapped i

        -- Convert to PlayCanvas space: PC(x, z, -y)
        local pcX = vMax.x
        local pcY = vMax.z
        local pcZ = -(vMax.y)

        append vertParts ((fmtFloat pcX) + "," + (fmtFloat pcY) + "," + (fmtFloat pcZ))

        -- Accumulate bounding box
        if not bboxInit then (
            pcMinX = pcX; pcMinY = pcY; pcMinZ = pcZ
            pcMaxX = pcX; pcMaxY = pcY; pcMaxZ = pcZ
            bboxInit = true
        ) else (
            if pcX < pcMinX do pcMinX = pcX
            if pcY < pcMinY do pcMinY = pcY
            if pcZ < pcMinZ do pcMinZ = pcZ
            if pcX > pcMaxX do pcMaxX = pcX
            if pcY > pcMaxY do pcMaxY = pcY
            if pcZ > pcMaxZ do pcMaxZ = pcZ
        )
    )

    -- ── Indices ───────────────────────────────────────────────────────────────
    local idxParts = #()

    for i = 1 to numFaces do (
        local f = getFace snapped i
        -- f components are 1-based → convert to 0-based
        local a = (f.x as integer) - 1
        local b = (f.y as integer) - 1
        local c = (f.z as integer) - 1
        append idxParts (a as string + "," + b as string + "," + c as string)
    )

    -- Clean up snapshot mesh
    delete snapped

    -- ── Assemble JSON fragment ────────────────────────────────────────────────
    local id = jsonEscape obj.name

    local vertStr = joinArray vertParts ","
    local idxStr  = joinArray idxParts ","

    local bminStr = "[" + (fmtFloat pcMinX) + "," + (fmtFloat pcMinY) + "," + (fmtFloat pcMinZ) + "]"
    local bmaxStr = "[" + (fmtFloat pcMaxX) + "," + (fmtFloat pcMaxY) + "," + (fmtFloat pcMaxZ) + "]"

    local frag = "  {\n"
    frag += "    \"id\": \""     + id + "\",\n"
    frag += "    \"label\": \""  + id + "\",\n"
    frag += "    \"status\": \"available\",\n"
    frag += "    \"mesh\": {\n"
    frag += "      \"vertices\": [" + vertStr + "],\n"
    frag += "      \"indices\": ["  + idxStr  + "]\n"
    frag += "    },\n"
    frag += "    \"bbox\": {\n"
    frag += "      \"min\": " + bminStr + ",\n"
    frag += "      \"max\": " + bmaxStr + "\n"
    frag += "    }\n"
    frag += "  }"

    frag
)

-- ── Main ──────────────────────────────────────────────────────────────────────

fn runExport = (
    local sel = getCurrentSelection()

    if sel.count == 0 then (
        messageBox "No objects selected.\nSelect the mapping objects and run the script again." \
            title:"Export Mappings"
        return undefined
    )

    -- Ask user where to save
    local outPath = getSaveFileName \
        caption:"Save Mappings JSON" \
        types:"Mapping JSON (*.json)|*.json|All Files (*.*)|*.*" \
        filename:"mappings.json"

    if outPath == undefined then (
        return undefined  -- user cancelled
    )

    -- Export each selected geometry object
    local fragments = #()
    local skipped = 0

    for obj in sel do (
        if (superClassOf obj) == GeometryClass then (
            local frag = exportObject obj
            append fragments frag
        ) else (
            skipped += 1
        )
    )

    if fragments.count == 0 then (
        messageBox "None of the selected objects are geometry.\nSelect mesh objects and try again." \
            title:"Export Mappings"
        return undefined
    )

    -- Build final JSON
    local body = joinArray fragments ",\n"
    local json = "{\n"
    json += "  \"version\": \"2.0\",\n"
    json += "  \"mappings\": [\n"
    json += body + "\n"
    json += "  ]\n"
    json += "}"

    -- Write file
    local f = openFile outPath mode:"w"
    if f == undefined then (
        messageBox ("Could not open file for writing:\n" + outPath) \
            title:"Export Mappings"
        return undefined
    )
    format "%" json to:f
    close f

    -- Summary
    local msg = "Exported " + (fragments.count as string) + " mapping(s) to:\n" + outPath
    if skipped > 0 do msg += "\n(" + (skipped as string) + " non-geometry object(s) skipped)"
    messageBox msg title:"Export Mappings — Done"
)

runExport()
