import { BoundingBox, Quat, Vec3 } from 'playcanvas';

import { Scene } from './scene';
import { Serializer } from './serializer';
import { Transform } from './transform';

enum ElementType {
    camera = 'camera',
    model = 'model',
    splat = 'splat',
    shadow = 'shadow',
    debug = 'debug',
    unit = 'unit',
    other = 'other'
}

const ElementTypeList = [
    ElementType.camera,
    ElementType.model,
    ElementType.splat,
    ElementType.shadow,
    ElementType.debug,
    ElementType.unit,
    ElementType.other
];

let nextUid = 1;

class Element {
    type: ElementType;
    scene: Scene = null;
    uid: number;

    constructor(type: ElementType) {
        this.type = type;
        this.uid = nextUid++;
    }

    destroy() {
        if (this.scene) {
            this.scene.remove(this);
        }
    }

    add(): void | Promise<void> {}

    remove() {}

    serialize(serializer: Serializer) {}

    onUpdate(deltaTime: number) {}

    onPostUpdate() {}

    onPreRender() {}

    onPostRender() {}

    onAdded(element: Element) {}

    onRemoved(element: Element) {}

    move(position?: Vec3, rotation?: Quat, scale?: Vec3) {}

    // Subclasses that have an entity should override this to place the transform pivot.
    // Default: no-op (pivot stays wherever it was last placed).
    getPivot(_mode: 'center' | 'boundCenter', _selection: boolean, _result: Transform) {}

    // Subclasses should override to reflect actual visibility. Default: always visible.
    get visible(): boolean { return true; }
    set visible(_value: boolean) {}

    get worldBound(): BoundingBox | null {
        return null;
    }
}

export { ElementType, ElementTypeList, Element };
