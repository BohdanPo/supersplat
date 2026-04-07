import { Element, ElementType } from './element';
import { Events } from './events';
import { Scene } from './scene';
import { Splat } from './splat';

const registerSelectionEvents = (events: Events, scene: Scene) => {
    // Selection is any scene element (Splat, Model, Unit, …)
    let selection: Element = null;

    const setSelection = (element: Element) => {
        if (element !== selection && (!element || element.visible)) {
            const prev = selection;
            selection = element;
            events.fire('selection.changed', selection, prev);
        }
    };

    events.on('selection', (element: Element) => {
        setSelection(element);
    });

    events.function('selection', () => {
        return selection;
    });

    // Cycle through splats only
    events.on('selection.next', () => {
        const splats = scene.getElementsByType(ElementType.splat) as Splat[];
        if (splats.length > 1) {
            const idx = splats.indexOf(selection as Splat);
            setSelection(splats[(idx + 1) % splats.length]);
        }
    });

    // Auto-select newly added splats (not models/units — they go in explicitly via UI)
    events.on('scene.elementAdded', (element: Element) => {
        if (element.type === ElementType.splat) {
            setSelection(element as Splat);
        }
    });

    // If the currently selected element is removed, clear selection or fall back to a splat
    events.on('scene.elementRemoved', (element: Element) => {
        if (element === selection) {
            if (element.type === ElementType.splat) {
                const splats = scene.getElementsByType(ElementType.splat) as Splat[];
                setSelection(splats.length === 1 ? null : splats.find(v => v !== element));
            } else {
                setSelection(null);
            }
        }
    });

    events.on('splat.visibility', (splat: Splat) => {
        if (splat === selection && !splat.visible) {
            setSelection(null);
        }
    });

    events.on('camera.focalPointPicked', (details: { splat: Splat }) => {
        setSelection(details.splat);
    });
};

export { registerSelectionEvents };
