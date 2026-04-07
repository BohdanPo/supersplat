import {
    BLEND_NORMAL,
    CULLFACE_NONE,
    PRIMITIVE_TRIANGLES,
    BoundingBox,
    Color,
    Entity,
    Mesh,
    MeshInstance,
    Quat,
    StandardMaterial,
    Vec3
} from 'playcanvas';

import { Element, ElementType } from './element';
import { Serializer } from './serializer';
import { Transform as TransformData } from './transform';

// Status-based base colors (RGB, matching UI_NAMING_CONVENTIONS color scheme)
const STATUS_COLORS: Record<UnitStatus, [number, number, number]> = {
    available: [0, 0.8, 0.2],      // green
    reserved:  [0.98, 0.57, 0.24], // orange
    sold:      [0.61, 0.64, 0.69]  // gray
};

// Alpha values per highlight state
const STATE_ALPHA: Record<HighlightState, number> = {
    default:  0.0,  // invisible — only appears on hover/select
    hover:    0.25,
    selected: 0.45
};

type UnitStatus = 'available' | 'reserved' | 'sold';
type HighlightState = 'default' | 'hover' | 'selected';

interface UnitBBox {
    min: [number, number, number];
    max: [number, number, number];
}

// v2.0: custom mesh geometry from MaxScript exporter
interface UnitMesh {
    vertices: number[];  // flat [x,y,z, x,y,z, ...] in PlayCanvas space
    indices: number[];   // flat [i,j,k, ...] 0-based triangle list
}

interface UnitData {
    id: string;
    label: string;
    status: UnitStatus;
    bbox: UnitBBox;
    mesh?: UnitMesh;   // v2.0: polygon shape; absent in v1.0 (falls back to box)
    floor?: number;
    area?: number;
    rooms?: number;
}

// v1.0 legacy format — units array
interface UnitsJSON_v1 {
    version: string;
    units: UnitData[];
}

// v2.0 format — mappings array with mesh geometry
interface MappingsJSON {
    version: string;
    mappings: UnitData[];
}

// Union type accepted by UnitManager.load()
type UnitLoadData = UnitsJSON_v1 | MappingsJSON;

class Unit extends Element {
    data: UnitData;

    entity: Entity = null;
    material: StandardMaterial = null;

    // Axis-aligned bounding box in world space — used for CPU raycasting
    worldBBox: BoundingBox = null;

    // Local bbox center + half-extents in entity-local space (for move() sync)
    private _bboxCenter: Vec3 = new Vec3();
    private _bboxHalfExtents: Vec3 = new Vec3();

    private _highlightState: HighlightState = 'default';

    constructor(data: UnitData) {
        super(ElementType.unit);
        this.data = data;
    }

    add() {
        if (this.data.mesh) {
            console.log(`[Unit] addMesh '${this.data.id}': ${this.data.mesh.vertices.length / 3} verts, ${this.data.mesh.indices.length / 3} tris`);
            try {
                this.addMesh();
            } catch (e) {
                console.error(`[Unit] addMesh '${this.data.id}' failed:`, e);
            }
        } else {
            this.addBox();
        }
    }

    // v2.0: build a PlayCanvas Mesh from the exported vertex/index arrays
    private addMesh() {
        const device = this.scene.app.graphicsDevice;

        const mesh = new Mesh(device);
        mesh.setPositions(this.data.mesh.vertices);
        mesh.setIndices(this.data.mesh.indices);
        mesh.update(PRIMITIVE_TRIANGLES);

        const mat = this.createMaterial();
        const meshInstance = new MeshInstance(mesh, mat);
        this.material = mat;

        this.entity = new Entity(`mapping-${this.data.id}`);
        this.entity.addComponent('render', {
            meshInstances: [meshInstance],
            layers: [this.scene.gizmoLayer.id]
        });

        this.buildBBoxFromData();
        this.scene.contentRoot.addChild(this.entity);
        this.scene.boundDirty = true;
        this.applyColor();
    }

    // v1.0 fallback: simple axis-aligned box (backward compatible)
    private addBox() {
        const { bbox } = this.data;

        const cx = (bbox.min[0] + bbox.max[0]) / 2;
        const cy = (bbox.min[1] + bbox.max[1]) / 2;
        const cz = (bbox.min[2] + bbox.max[2]) / 2;
        const sx = bbox.max[0] - bbox.min[0];
        const sy = bbox.max[1] - bbox.min[1];
        const sz = bbox.max[2] - bbox.min[2];

        this.entity = new Entity(`unit-${this.data.id}`);
        this.entity.addComponent('render', {
            type: 'box',
            layers: [this.scene.gizmoLayer.id]
        });

        const mat = this.createMaterial();
        this.entity.render.meshInstances[0].material = mat;
        this.material = mat;

        this.entity.setLocalPosition(cx, cy, cz);
        this.entity.setLocalScale(sx, sy, sz);

        this.buildBBoxFromData();
        this.scene.contentRoot.addChild(this.entity);
        this.scene.boundDirty = true;
        this.applyColor();
    }

    // Build the shared material for both paths
    private createMaterial(): StandardMaterial {
        const mat = new StandardMaterial();
        mat.useLighting = false;
        mat.blendType = BLEND_NORMAL;
        mat.depthWrite = false;
        mat.cull = CULLFACE_NONE; // visible even when camera is inside
        mat.update();
        return mat;
    }

    // Store bbox center/half-extents from data.bbox (already in PlayCanvas space)
    // and build the initial worldBBox (entity at origin).
    private buildBBoxFromData() {
        const { bbox } = this.data;
        const cx = (bbox.min[0] + bbox.max[0]) / 2;
        const cy = (bbox.min[1] + bbox.max[1]) / 2;
        const cz = (bbox.min[2] + bbox.max[2]) / 2;
        const hx = (bbox.max[0] - bbox.min[0]) / 2;
        const hy = (bbox.max[1] - bbox.min[1]) / 2;
        const hz = (bbox.max[2] - bbox.min[2]) / 2;

        this._bboxCenter.set(cx, cy, cz);
        this._bboxHalfExtents.set(hx, hy, hz);

        this.updateWorldBBox();
    }

    // Recompute worldBBox from current entity position + stored local bbox
    private updateWorldBBox() {
        if (!this.entity) return;
        const p = this.entity.getLocalPosition();
        this.worldBBox = new BoundingBox(
            new Vec3(
                this._bboxCenter.x + p.x,
                this._bboxCenter.y + p.y,
                this._bboxCenter.z + p.z
            ),
            this._bboxHalfExtents.clone()
        );
    }

    remove() {
        if (this.entity) {
            this.scene.contentRoot.removeChild(this.entity);
        }
    }

    destroy() {
        // super.destroy() calls scene.remove(this) which fires scene.elementRemoved
        super.destroy();
        if (this.entity) {
            this.entity.destroy();
            this.entity = null;
        }
    }

    serialize(serializer: Serializer) {
        serializer.pack(this.data.id);
        serializer.pack(this._highlightState);
    }

    move(position?: Vec3, rotation?: Quat, scale?: Vec3) {
        if (!this.entity) return;
        if (position) this.entity.setLocalPosition(position);
        if (rotation) this.entity.setLocalRotation(rotation);
        if (scale) this.entity.setLocalScale(scale);
        this.updateWorldBBox();
        if (this.scene) {
            this.scene.boundDirty = true;
            this.scene.forceRender = true;
        }
    }

    getPivot(_mode: 'center' | 'boundCenter', _selection: boolean, result: TransformData) {
        if (this.entity) {
            result.set(
                this.entity.getLocalPosition(),
                this.entity.getLocalRotation(),
                this.entity.getLocalScale()
            );
        }
    }

    get worldBound(): BoundingBox | null {
        return this.worldBBox;
    }

    get highlightState(): HighlightState {
        return this._highlightState;
    }

    set highlightState(state: HighlightState) {
        if (this._highlightState === state) return;
        this._highlightState = state;
        this.applyColor();
        if (this.scene) this.scene.forceRender = true;
    }

    get visible(): boolean {
        return this.entity?.enabled ?? false;
    }

    set visible(value: boolean) {
        if (this.entity) {
            this.entity.enabled = value;
            if (this.scene) this.scene.forceRender = true;
        }
    }

    private applyColor() {
        if (!this.material) return;

        const [r, g, b] = STATUS_COLORS[this.data.status] ?? STATUS_COLORS.available;
        const a = STATE_ALPHA[this._highlightState];

        this.material.emissive = new Color(r, g, b);
        this.material.opacity = a;
        this.material.update();
    }
}

export { Unit, UnitData, UnitMesh, UnitsJSON_v1, MappingsJSON, UnitLoadData, UnitStatus, HighlightState };
