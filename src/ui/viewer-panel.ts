import { Container, Label } from '@playcanvas/pcui';

import { Events } from '../events';

class ViewerPanel extends Container {
    constructor(events: Events, args: Record<string, unknown> = {}) {
        super({
            ...args,
            id: 'viewer-panel'
        });

        // Header row: title + open button
        const headerRow = new Container({
            id: 'viewer-panel-header-row'
        });

        const headerLabel = new Label({
            id: 'viewer-panel-header',
            text: 'Apartments'
        });

        // "Open Project" button — fires doc.open so .ssproj can be loaded in viewer mode
        const openBtn = document.createElement('button');
        openBtn.id = 'viewer-open-btn';
        openBtn.textContent = 'Open';
        openBtn.title = 'Open project (.ssproj)';
        openBtn.addEventListener('click', () => {
            events.invoke('doc.open');
        });

        headerRow.append(headerLabel);
        headerRow.dom.appendChild(openBtn);

        const list = new Container({
            id: 'viewer-panel-list'
        });

        // Empty state shown when no project is loaded
        const emptyState = document.createElement('div');
        emptyState.id = 'viewer-empty-state';
        emptyState.innerHTML = 'Drop a <strong>.ssproj</strong> file here<br>or click <strong>Open</strong>';
        list.dom.appendChild(emptyState);

        this.append(headerRow);
        this.append(list);

        let selectedId: string | null = null;
        const itemMap = new Map<string, HTMLElement>();

        const selectItem = (id: string | null) => {
            if (selectedId) {
                itemMap.get(selectedId)?.classList.remove('selected');
            }
            selectedId = id;
            if (id) {
                const el = itemMap.get(id);
                if (el) {
                    el.classList.add('selected');
                    el.scrollIntoView({ block: 'nearest' });
                }
            }
        };

        events.on('units.loaded', (ids: string[]) => {
            list.dom.innerHTML = '';
            itemMap.clear();
            selectedId = null;

            if (ids.length === 0) {
                list.dom.appendChild(emptyState);
                return;
            }

            ids.forEach(id => {
                const item = document.createElement('div');
                item.className = 'viewer-unit-item';
                item.textContent = id;
                item.addEventListener('click', () => {
                    // Toggle: clicking selected item deselects it
                    events.fire('unit.select', id === selectedId ? null : id);
                });
                list.dom.appendChild(item);
                itemMap.set(id, item);
            });
        });

        // Keep list in sync when 3D hover/click changes selection
        events.on('unit.selected', (id: string | null) => {
            selectItem(id);
        });
    }
}

export { ViewerPanel };
