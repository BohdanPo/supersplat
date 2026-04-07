import { BoundingBox, Ray, Vec3 } from 'playcanvas';

import { Events } from './events';
import { Scene } from './scene';
import { Unit, UnitData, UnitLoadData } from './unit';

class UnitManager {
    private scene: Scene;
    private events: Events;

    private units: Map<string, Unit> = new Map();
    private hoveredId: string | null = null;
    private selectedId: string | null = null;

    private ray = new Ray();

    constructor(scene: Scene, events: Events) {
        this.scene = scene;
        this.events = events;

        scene.canvas.addEventListener('pointermove', this.onPointerMove);
        scene.canvas.addEventListener('pointerdown', this.onPointerDown);

        // Allow external selection (e.g. from the React panel)
        events.on('unit.select', (id: string | null) => {
            this.setSelected(id);
        });

        // Allow external filter (e.g. from the React panel)
        events.on('unit.filter', (ids: string[]) => {
            this.filterUnits(ids);
        });
    }

    async load(data: UnitLoadData): Promise<void> {
        // Support both v1.0 (units array) and v2.0 (mappings array)
        const entries: UnitData[] = (data as any).mappings ?? (data as any).units ?? [];

        console.log(`[UnitManager] Loading ${entries.length} unit(s) (format v${data.version})`);

        for (const unitData of entries) {
            // If a unit with this ID already exists, replace it
            const existing = this.units.get(unitData.id);
            if (existing) {
                this.scene.remove(existing);
                existing.destroy();
            }
            const unit = new Unit(unitData);
            await this.scene.add(unit);
            this.units.set(unitData.id, unit);
        }

        // Report all current unit IDs (cumulative across multiple imports)
        this.events.fire('units.loaded', Array.from(this.units.keys()));

        const bound = this.getWorldBound();
        if (bound) {
            const c = bound.center, h = bound.halfExtents;
            console.log(`[UnitManager] Aggregate bbox: center=(${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)}) halfExtents=(${h.x.toFixed(2)}, ${h.y.toFixed(2)}, ${h.z.toFixed(2)}) size=(${(h.x * 2).toFixed(2)} x ${(h.y * 2).toFixed(2)} x ${(h.z * 2).toFixed(2)})`);
        }

        this.scene.forceRender = true;
    }

    filterUnits(ids: string[]): void {
        const idSet = new Set(ids);
        for (const [id, unit] of this.units) {
            unit.visible = idSet.has(id);
        }
        // If hovered/selected unit is now hidden, clear those states
        if (this.hoveredId && !idSet.has(this.hoveredId)) {
            this.setHovered(null);
        }
        if (this.selectedId && !idSet.has(this.selectedId)) {
            this.setSelected(null);
        }
        this.events.fire('unit.filtered', ids);
        this.scene.forceRender = true;
    }

    showAll(): void {
        for (const unit of this.units.values()) {
            unit.visible = true;
        }
        this.scene.forceRender = true;
    }

    getUnit(id: string): Unit | undefined {
        return this.units.get(id);
    }

    getUnitsData(): UnitData[] {
        return Array.from(this.units.values()).map(u => u.data);
    }

    // Remove all units and reset state without destroying the manager itself
    clearAll(): void {
        for (const unit of this.units.values()) {
            this.scene.remove(unit);
            unit.destroy();
        }
        this.units.clear();
        this.hoveredId = null;
        this.selectedId = null;
        this.events.fire('units.loaded', []);
    }

    // Serialize current unit data for project save
    serializeData(): { version: string, mappings: UnitData[] } | null {
        if (this.units.size === 0) return null;
        return {
            version: '2.0',
            mappings: Array.from(this.units.values()).map(u => u.data)
        };
    }

    getWorldBound(): BoundingBox | null {
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        let hasAny = false;

        for (const unit of this.units.values()) {
            const bbox = unit.worldBBox;
            if (!bbox) continue;
            hasAny = true;
            const { x: cx, y: cy, z: cz } = bbox.center;
            const { x: hx, y: hy, z: hz } = bbox.halfExtents;
            if (cx - hx < minX) minX = cx - hx;
            if (cy - hy < minY) minY = cy - hy;
            if (cz - hz < minZ) minZ = cz - hz;
            if (cx + hx > maxX) maxX = cx + hx;
            if (cy + hy > maxY) maxY = cy + hy;
            if (cz + hz > maxZ) maxZ = cz + hz;
        }

        if (!hasAny) return null;

        return new BoundingBox(
            new Vec3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2),
            new Vec3((maxX - minX) / 2, (maxY - minY) / 2, (maxZ - minZ) / 2)
        );
    }

    destroy() {
        this.scene.canvas.removeEventListener('pointermove', this.onPointerMove);
        this.scene.canvas.removeEventListener('pointerdown', this.onPointerDown);
        for (const unit of this.units.values()) {
            this.scene.remove(unit);
            unit.destroy();
        }
        this.units.clear();
    }

    private onPointerMove = (e: PointerEvent) => {
        // Only process primary pointer (ignore multi-touch secondary pointers)
        if (e.pointerType === 'touch' && !e.isPrimary) return;

        this.scene.camera.getRay(e.offsetX, e.offsetY, this.ray);

        let hitId: string | null = null;
        for (const [id, unit] of this.units) {
            if (!unit.visible) continue;
            if (unit.worldBBox?.intersectsRay(this.ray)) {
                hitId = id;
                break;
            }
        }

        if (hitId !== this.hoveredId) {
            this.setHovered(hitId);
        }
    };

    private onPointerDown = (e: PointerEvent) => {
        // Only primary mouse button or primary touch
        if (e.button !== 0 && e.pointerType !== 'touch') return;
        if (e.pointerType === 'touch' && !e.isPrimary) return;

        // Select whatever is currently hovered
        if (this.hoveredId !== null) {
            this.setSelected(this.hoveredId === this.selectedId ? null : this.hoveredId);
        }
    };

    private setHovered(id: string | null) {
        // Clear previous hover (unless it's also selected)
        if (this.hoveredId !== null && this.hoveredId !== this.selectedId) {
            const prev = this.units.get(this.hoveredId);
            if (prev) prev.highlightState = 'default';
        }

        this.hoveredId = id;

        // Apply hover state (unless it's already selected — selected takes priority)
        if (id !== null && id !== this.selectedId) {
            const next = this.units.get(id);
            if (next) next.highlightState = 'hover';
        }

        this.events.fire('unit.hovered', id);
        this.scene.forceRender = true;
    }

    private setSelected(id: string | null) {
        // Clear previous selection
        if (this.selectedId !== null) {
            const prev = this.units.get(this.selectedId);
            if (prev) {
                // If it's still being hovered revert to hover, otherwise default
                prev.highlightState = (this.selectedId === this.hoveredId) ? 'hover' : 'default';
            }
        }

        this.selectedId = id;

        if (id !== null) {
            const next = this.units.get(id);
            if (next) next.highlightState = 'selected';
        }

        this.events.fire('unit.selected', id);
        this.scene.forceRender = true;
    }
}

export { UnitManager };
