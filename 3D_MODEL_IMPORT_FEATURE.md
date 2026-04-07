# Импорт 3D-форматов в SuperSplat — Техническое описание реализации

## Контекст

Этот документ описывает кастомную доработку движка SuperSplat, добавляющую поддержку импорта традиционных 3D-форматов (`.glb`, `.gltf`, `.fbx`, `.obj`) наряду с уже существующим форматом Gaussian Splat (`.ply`). Документ предназначен для переноса этой функциональности в будущую более свежую версию движка.

---

## Архитектурный обзор

SuperSplat построен на движке **PlayCanvas** и использует систему **Element**-ов — базовых узлов сцены. Изначально поддерживались только типы `splat` (гауссовы сплаты) и вспомогательные типы. Вся доработка сводится к добавлению нового типа элемента `model` и интеграции его во все системы, которые работают с элементами сцены.

---

## Новые файлы

### `src/model.ts`

Ключевой класс — обёртка вокруг PlayCanvas `Entity` для 3D-моделей. Наследует от базового `Element`.

**Что делает:**
- Хранит ссылки на `entity` (PlayCanvas Entity) и `asset` (PlayCanvas Asset)
- Реализует методы жизненного цикла: `add()`, `remove()`, `destroy()`
- Реализует `move(position, rotation, scale)` — применяет трансформации к entity через `setLocalPosition/Rotation/Scale`
- Реализует `worldBound` — возвращает `BoundingBox` в мировом пространстве (сначала пробует `entity.model.model.getBoundingBox()`, fallback — позиция + масштаб)
- Реализует `getPivot(mode, selection, result)` — вычисляет точку поворота в режимах `center` (локальная позиция entity) и `boundCenter` (центр bounding box переведённый в локальное пространство)

**Почему важен:** без этого класса PlayCanvas Entity нельзя добавить в систему элементов SuperSplat и управлять им через UI.

### `src/obj-loader.ts`

Простой парсер формата `.obj` без зависимостей.

**Что делает:**
- Загружает файл через `fetch(url)`, парсит построчно
- Читает вершины (`v`), нормали (`vn`), UV-координаты (`vt`), грани (`f`)
- Грани поддерживают формат `v/vt/vn` — берётся только индекс вершины (минус 1 для перевода из 1-based в 0-based)
- Возвращает интерфейс `OBJData: { vertices, normals, uvs, faces }`

**Ограничения текущей реализации:** нет поддержки multiple объектов (`o`), групп (`g`), материалов (`mtl`). Один файл — один меш.

### `src/obj-converter.ts`

Тонкая обёртка над `OBJLoader`, конвертирует в формат `{ meshes: ConvertedMesh[] }` с типизированными массивами (`Float32Array`, `Uint32Array`). Это промежуточный слой между парсером и PlayCanvas API.

---

## Изменённые файлы

### `src/element.ts`

**Изменение:** добавлен новый тип в enum `ElementType`:

```typescript
enum ElementType {
    camera = 'camera',
    model = 'model',   // <-- НОВЫЙ ТИП
    splat = 'splat',
    shadow = 'shadow',
    debug = 'debug',
    other = 'other'
}
```

Также добавлен `ElementType.model` в массив `ElementTypeList`. Это фундаментальное изменение — без него система не может различать элементы типа model от других.

---

### `src/file-handler.ts`

Главный файл, где реализована логика загрузки. Функция `handleImport(url, filename)` расширена двумя новыми ветками:

#### Ветка 1: `.glb`, `.gltf`, `.fbx`

Использует **нативную систему Asset PlayCanvas**:

```
1. Создать PlayCanvas Asset с типом 'model'
2. Повесить обработчики asset.on('load'), asset.on('error'), asset.on('progress')
3. Добавить asset в реестр: scene.app.assets.add(asset)
4. Запустить загрузку: scene.app.assets.load(asset)
5. В обработчике 'load':
   a. Создать Entity, задать позицию (0, 0, -5) и масштаб
   b. Добавить компонент 'model' с { asset, type: 'asset', castShadows, receiveShadows }
   c. Создать Model(entity, asset) — обёртку для системы элементов
   d. Вызвать scene.add(modelElement)
   e. Сфокусировать камеру
```

**Почему entity помещается в позицию (0, 0, -5):** чтобы модель была видна в центре сцены сразу после загрузки. Это хардкод — в будущей реализации лучше вычислять из bounding box.

#### Ветка 2: `.obj`

Использует кастомный парсер (OBJConverter) и PlayCanvas Mesh API напрямую:

```
1. OBJConverter.convert(url) → { meshes }
2. Создать Entity-иерархию: parentEntity → childEntity (mesh entity)
3. Создать PlayCanvas Mesh через scene.app.graphicsDevice
4. Заполнить меш: setPositions, setNormals, setUvs, setIndices
5. Создать Material (базовый, белый diffuse)
6. Создать MeshInstance(mesh, material)
7. Добавить компонент 'render' с meshInstances
8. parentEntity.setLocalPosition(0, 0, -5)
9. scene.app.root.addChild(parentEntity)  ← вручную!
10. Создать Model(parentEntity, null) и вызвать scene.add(modelElement)
```

**Важное отличие OBJ от GLB/GLTF:** для OBJ entity добавляется в `scene.app.root` напрямую до вызова `scene.add()`, тогда как для GLB/GLTF `scene.add()` делает это через метод `add()` класса Model. Это может стать источником ошибки — стоит унифицировать в новой реализации.

#### Изменения в File Picker

```typescript
// showOpenFilePicker — добавлен filePickerTypes.model в список типов
types: [filePickerTypes.ply, filePickerTypes.splat, filePickerTypes.model]

// filePickerTypes.model определён как:
'model': {
    description: '3D Model Files',
    accept: {
        'model/gltf-binary': ['.glb'],
        'model/gltf+json': ['.gltf'],
        'model/fbx': ['.fbx'],
        'model/obj': ['.obj']
    }
}

// Fallback fileSelector (когда нет showOpenFilePicker):
fileSelector.setAttribute('accept', '.ply,.splat,.gltf,.glb,.fbx,.obj');

// Drag & drop — добавлена фильтрация по новым расширениям
lowerName.endsWith('.gltf') || lowerName.endsWith('.glb') ||
lowerName.endsWith('.fbx') || lowerName.endsWith('.obj')
```

---

### `src/editor.ts`

**Изменение:** обработчик события `camera.focus` расширен для работы с `ElementType.model`.

Для Splat логика была уже готова (использует `localBound` + `worldTransform`). Для Model добавлена новая ветка:

```typescript
} else if (selection.type === ElementType.model) {
    const model = selection as Model;
    // Берём worldPos из entity.getPosition()
    // Берём радиус из model.worldBound.halfExtents.length() * max(scale)
    // Вызываем scene.camera.focus({ focalPoint, radius, speed: 1 })
}
```

Также добавлены обширные защитные проверки: `try/catch`, проверки на `isNaN`, `isFinite`, ограничение `maxSafeRadius = 10000`, fallback на `(0,0,0)` с radius 10.

---

### `src/entity-transform-handler.ts`

Обработчик трансформаций через Gizmo (инструменты move/rotate/scale). Изначально работал только со Splat.

**Изменения:**
- `activate()` — принимает выделение типа `splat` ИЛИ `model`
- `placePivot()` — вызывает `getPivot()` у Splat или Model в зависимости от типа
- `getEntityFromElement()` — новый вспомогательный метод, возвращает entity из Splat или Model
- `update()` — добавлена защита от экстремальных значений position/scale специально для OBJ-моделей (clamp до `±10000` для позиции и `±1000` для масштаба)

**Суть работы трансформ-хендлера:**
```
1. start() — вычисляет bindMat (матрица привязки pivot к entity)
2. update() — применяет новую матрицу трансформации к элементу через element.move()
3. end() — если трансформация изменилась, регистрирует EntityTransformOp в undo/redo
```

---

### `src/ui/splat-list.ts`

Панель списка объектов сцены (Scene Manager). Полностью переработана.

**Изменения:**
- `addElement()` — принимает `Splat` ИЛИ `Model` (`element instanceof Model`)
- `getElementName()` — для Model берёт `element.entity?.name`, для Splat — имя файла без расширения
- `createItemElement()` — при удалении вызывает `(element as Model).destroy()` для Model
- `removeElement()` — корректно удаляет из внутреннего списка и из UI

Таким образом, 3D-модели появляются в списке сцены наравне с гауссовыми сплатами, с теми же кнопками видимости и удаления.

---

### `src/ui/transform.ts`

Панель трансформаций (Position/Rotation/Scale). 

**Изменения:**
- Добавлено логирование состояния для отладки работы с model-элементами
- В обработчике `selection.changed` — добавлена проверка `selection.type === ElementType.model` для отладочного вывода
- Добавлен вспомогательный интерфейс `EntityLike` для type-safe доступа к `entity.getLocalPosition/Rotation/Scale`

---

### `src/pc-app.ts`

**Изменения:** добавлены обязательные зависимости PlayCanvas для загрузки 3D-моделей:

```typescript
// В addComponentSystems:
ModelComponentSystem   // <-- нужен для компонента 'model'

// В addResourceHandles:
ModelHandler           // <-- нужен для загрузки .fbx
ContainerHandler       // <-- нужен для загрузки .glb/.gltf
```

Без этих регистраций PlayCanvas не знает как обрабатывать соответствующие типы ассетов.

---

## Поток данных при импорте

```
Пользователь выбирает файл
        ↓
scene.import (events.function)
        ↓
handleImport(url, filename)
        ↓
    ┌───┴──────────────┬──────────────────────┐
   .ply             .glb/.gltf/.fbx          .obj
    ↓                    ↓                    ↓
scene.assetLoader    PlayCanvas Asset     OBJConverter
.loadModel()         system (async)       .convert(url)
    ↓                    ↓                    ↓
  Splat              Entity +             Entity + Mesh
  element            'model'              + MeshInstance
                     component            + 'render' component
                         ↓                    ↓
                    Model(entity, asset)  Model(entity, null)
                         ↓                    ↓
                    scene.add(model)      scene.add(model)
                         ↓                    ↓
                  scene.elementAdded    scene.elementAdded
                  event → SplatList     event → SplatList
```

---

## Система событий

Новых событий не добавлено. Модели используют уже существующие события:

| Событие | Когда срабатывает | Что происходит |
|---|---|---|
| `scene.elementAdded` | После `scene.add(model)` | `SplatList` добавляет строку в UI |
| `scene.elementRemoved` | После `scene.remove(model)` | `SplatList` удаляет строку из UI |
| `selection.changed` | Клик в SplatList | Transform-панель и Gizmo активируются |
| `camera.focus` | F или кнопка фокуса | Камера летит к выбранному объекту |
| `element.visibilityChanged` | Клик на иконке глаза | Показ/скрытие модели |

---

## Что нужно учесть при переносе в новую версию

### 1. Регистрация ComponentSystem и ResourceHandler
В `pc-app.ts` обязательно должны быть зарегистрированы:
- `ModelComponentSystem` + `ModelHandler` — для FBX
- `RenderComponentSystem` + `ContainerHandler` — для GLB/GLTF (в новых версиях PlayCanvas предпочтительнее использовать `RenderComponent` вместо устаревшего `ModelComponent`)

### 2. ModelComponent vs RenderComponent
В PlayCanvas `ModelComponent` считается устаревшим. В более новых версиях правильный подход — `RenderComponent` с типом `asset` и ссылкой на `ContainerAsset`. Текущая реализация использует `ModelComponent`, что может не работать в новых версиях движка.

### 3. OBJ через PlayCanvas ContainerHandler
Текущая OBJ-реализация (ручной парсинг + создание Mesh) очень примитивна — нет материалов, нет multiple объектов. В новой версии правильнее использовать PlayCanvas ContainerHandler для .obj тоже, или сторонний полноценный OBJ-лоадер (например, three-stdlib).

### 4. ElementType.model
Это изменение в `element.ts` — первое что нужно воспроизвести. Без него ничего остального не заработает.

### 5. Model class
Класс `Model` (`src/model.ts`) должен быть воспроизведён полностью. Ключевые методы для правильной работы: `worldBound`, `getPivot`, `move`, `destroy`.

### 6. Отладочный код
В текущей реализации очень много `console.log` отладочных сообщений — в новой версии их следует убрать или заменить на условные логи через флаг `DEBUG`.

### 7. Позиция модели при загрузке
Хардкод `setLocalPosition(0, 0, -5)` — временное решение. В идеале нужно вычислять позицию из bounding box загруженной модели.

### 8. OBJ entity добавляется в root напрямую
В OBJ-ветке `scene.app.root.addChild(parentEntity)` вызывается явно до `scene.add()`. Это несогласованно с GLB/GLTF, где добавление в иерархию происходит через `Model.add()`, который вызывает `scene.contentRoot.addChild(entity)`. В новой реализации стоит унифицировать.

---

## Минимальная реализация для новой версии

Для переноса фичи необходимо:

1. **`src/element.ts`** — добавить `model = 'model'` в `ElementType` enum
2. **`src/model.ts`** — создать класс `Model extends Element` с методами `add`, `remove`, `destroy`, `move`, `worldBound`, `getPivot`
3. **`src/pc-app.ts`** — зарегистрировать нужные ComponentSystems и ResourceHandlers
4. **`src/file-handler.ts`** — добавить ветки для `.glb/.gltf/.fbx` и `.obj` в `handleImport`, расширить filePickerTypes и drag-drop фильтр
5. **`src/ui/splat-list.ts`** — добавить `element instanceof Model` в `addElement()`
6. **`src/editor.ts`** — добавить ветку `ElementType.model` в обработчик `camera.focus`
7. **`src/entity-transform-handler.ts`** — добавить поддержку `ElementType.model` в `activate()`, `placePivot()`, `getEntityFromElement()`
