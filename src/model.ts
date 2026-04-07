import {
    Asset,
    BoundingBox,
    Entity,
    Quat,
    StandardMaterial,
    Vec3
} from 'playcanvas';

import { Element, ElementType } from './element';
import { Serializer } from './serializer';
import { Transform as TransformData } from './transform';

class Model extends Element {
    asset: Asset;
    entity: Entity = null;
    private _name: string;
    private _visible: boolean = true;

    // Raw binary data of the GLB file — populated on import so the project can be saved
    rawData: ArrayBuffer | null = null;

    constructor(name: string, asset: Asset) {
        super(ElementType.model);
        this._name = name;
        this.asset = asset;
    }

    get name() {
        return this._name;
    }

    add() {
        return new Promise<void>((resolve, reject) => {
            const { asset, scene } = this;

            const onLoad = () => {
                try {
                    // Instantiate the GLB/GLTF as an entity hierarchy
                    // asset.resource is typed as 'object' in PlayCanvas types — cast needed
                    this.entity = (asset.resource as any).instantiateRenderEntity();
                    this.entity.name = this._name;

                    // Make all materials unlit so they render correctly with no lights
                    this.makeMaterialsUnlit(this.entity);

                    // Add to scene, render in worldLayer so it sits with the scene geometry
                    // (behind splats, which is usually correct for reference meshes)
                    this.setLayersRecursive(this.entity, [scene.worldLayer.id]);

                    scene.contentRoot.addChild(this.entity);
                    scene.boundDirty = true;
                    resolve();
                } catch (e) {
                    reject(e);
                }
            };

            if (asset.resource) {
                onLoad();
            } else {
                asset.once('load', onLoad);
                asset.once('error', (err: string) => reject(new Error(err)));
                scene.app.assets.add(asset);
                scene.app.assets.load(asset);
            }
        });
    }

    remove() {
        if (this.entity) {
            this.scene.contentRoot.removeChild(this.entity);
            this.scene.boundDirty = true;
        }
    }

    destroy() {
        // Save scene ref before super.destroy() nulls it out
        const app = this.scene?.app;
        // super.destroy() calls scene.remove(this) which fires scene.elementRemoved
        super.destroy();
        if (this.entity) {
            this.entity.destroy();
            this.entity = null;
        }
        if (this.asset && app) {
            app.assets.remove(this.asset);
            this.asset.unload();
        }
    }

    serialize(serializer: Serializer) {
        serializer.pack(this._name);
    }

    move(position?: Vec3, rotation?: Quat, scale?: Vec3) {
        if (!this.entity) return;
        if (position) this.entity.setLocalPosition(position);
        if (rotation) this.entity.setLocalRotation(rotation);
        if (scale) this.entity.setLocalScale(scale);
        if (this.scene) this.scene.forceRender = true;
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

    get visible(): boolean {
        return this._visible;
    }

    set visible(value: boolean) {
        this._visible = value;
        if (this.entity) {
            this.entity.enabled = value;
            if (this.scene) this.scene.forceRender = true;
        }
    }

    // worldBound participates in scene bounds — unlike units, a reference model SHOULD
    // influence clipping planes so it remains visible
    get worldBound(): BoundingBox | null {
        if (!this.entity) return null;

        let combined: BoundingBox | null = null;
        const renderComponents = this.entity.findComponents('render') as any[];
        for (const rc of renderComponents) {
            for (const mi of rc.meshInstances) {
                if (combined) {
                    combined.add(mi.aabb);
                } else {
                    combined = new BoundingBox();
                    combined.copy(mi.aabb);
                }
            }
        }
        return combined;
    }

    // Walk all RenderComponents and make their materials render without lighting.
    // When useLighting=false, PlayCanvas renders only the emissive channel, so we
    // copy diffuse → emissive (and diffuseMap → emissiveMap) so the model is visible.
    private makeMaterialsUnlit(entity: Entity) {
        const renders = entity.findComponents('render') as any[];
        for (const rc of renders) {
            for (const mi of rc.meshInstances) {
                const mat = mi.material as StandardMaterial;
                if (mat) {
                    // Copy diffuse color/map into emissive so the mesh isn't black
                    if (mat.diffuse) mat.emissive.copy(mat.diffuse);
                    if ((mat as any).diffuseMap && !(mat as any).emissiveMap) {
                        (mat as any).emissiveMap = (mat as any).diffuseMap;
                    }
                    mat.useLighting = false;
                    mat.update();
                }
            }
        }
    }

    private setLayersRecursive(entity: Entity, layerIds: number[]) {
        const rc = entity.findComponents('render') as any[];
        for (const r of rc) {
            r.layers = layerIds;
        }
    }
}

export { Model };
