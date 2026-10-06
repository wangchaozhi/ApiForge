import { translate as t, useLocale } from '../../i18n/index.ts';
import { ChevronDown, ChevronRight, FilePlus2, Folder, FolderPlus, GripVertical, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../store/appStore.ts';
import { parseOpenApi } from '../../services/openapi/import.ts';
import { RequestTreeItem } from './RequestTreeItem.tsx';

export function CollectionTree() {
  useLocale();
  const requests = useAppStore((state) => state.requests);
  const collections = useAppStore((state) => state.collections);
  const createRequest = useAppStore((state) => state.createRequest);
  const createCollection = useAppStore((state) => state.createCollection);
  const renameCollection = useAppStore((state) => state.renameCollection);
  const deleteCollection = useAppStore((state) => state.deleteCollection);
  const createFolder = useAppStore((state) => state.createFolder);
  const renameFolder = useAppStore((state) => state.renameFolder);
  const deleteFolder = useAppStore((state) => state.deleteFolder);
  const reorderCollections = useAppStore((state) => state.reorderCollections);
  const importCollection = useAppStore((state) => state.importCollection);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [draggingCollectionId, setDraggingCollectionId] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const assignedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const collection of collections) {
      collection.requestIds.forEach((id) => ids.add(id));
      collection.folders.forEach((folder) => folder.requestIds.forEach((id) => ids.add(id)));
    }
    return ids;
  }, [collections]);
  const unfiled = requests.filter((request) => !assignedIds.has(request.id));

  const toggle = (id: string) => setCollapsed((current) => ({ ...current, [id]: !current[id] }));

  const importOpenApiFile = async (file: File) => {
    try {
      const imported = parseOpenApi(await file.text(), file.name);
      importCollection(imported.collection, imported.requests);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <>
      <div className="section-label tree-section-label">
        <span>{t("Collections")}</span>
        <div className="section-label-actions">
          <button title={t("Import OpenAPI JSON/YAML")} onClick={() => importInputRef.current?.click()}><Upload size={13} /></button>
          <button
            title={t("New collection")}
            onClick={() => {
              const name = window.prompt(t("Collection name"), t("New Collection"));
              if (name?.trim()) createCollection(name.trim());
            }}
          ><Plus size={13} /></button>
        </div>
        <input
          ref={importInputRef}
          className="visually-hidden"
          type="file"
          accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml,text/x-yaml"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importOpenApiFile(file);
            event.currentTarget.value = '';
          }}
        />
      </div>

      <div className="collection-tree">
        {collections.map((collection) => {
          const isCollapsed = collapsed[collection.id] === true;
          const isDragging = draggingCollectionId === collection.id;
          return (
            <div
              className={`collection-node ${isDragging ? 'dragging' : ''}`}
              key={collection.id}
              draggable
              onDragStart={(event) => {
                setDraggingCollectionId(collection.id);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', collection.id);
              }}
              onDragEnd={() => setDraggingCollectionId(null)}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event) => {
                event.preventDefault();
                const sourceId = event.dataTransfer.getData('text/plain') || draggingCollectionId;
                if (sourceId) reorderCollections(sourceId, collection.id);
                setDraggingCollectionId(null);
              }}
            >
              <div className="tree-row collection-row">
                <span className="collection-drag-handle" title={t("Drag to reorder")}><GripVertical size={11} /></span>
                <button className="tree-toggle" onClick={() => toggle(collection.id)} title={isCollapsed ? t("Expand") : t("Collapse")}>
                  {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                </button>
                <button className="tree-label" onClick={() => toggle(collection.id)} title={collection.name}>
                  <Folder size={13} /><span>{collection.name}</span>
                </button>
                <div className="tree-actions">
                  <button title={t("New request")} onClick={() => createRequest({ collectionId: collection.id })}><FilePlus2 size={11} /></button>
                  <button title={t("New folder")} onClick={() => {
                    const name = window.prompt(t("Folder name"), t("New Folder"));
                    if (name?.trim()) createFolder(collection.id, name.trim());
                  }}><FolderPlus size={11} /></button>
                  <button title={t("Rename collection")} onClick={() => {
                    const name = window.prompt(t("Rename collection"), collection.name);
                    if (name?.trim()) renameCollection(collection.id, name.trim());
                  }}><Pencil size={11} /></button>
                  <button className="danger" title={t("Delete collection")} onClick={() => {
                    if (window.confirm(t('Delete collection “{name}”? Requests will remain under Unfiled.', { name: collection.name }))) deleteCollection(collection.id);
                  }}><Trash2 size={11} /></button>
                </div>
              </div>

              {!isCollapsed && (
                <div className="tree-children">
                  {collection.requestIds.map((id) => <RequestTreeItem key={id} requestId={id} />)}
                  {collection.folders.map((folder) => {
                    const folderKey = `${collection.id}:${folder.id}`;
                    const folderCollapsed = collapsed[folderKey] === true;
                    return (
                      <div className="folder-node" key={folder.id}>
                        <div className="tree-row folder-row">
                          <button className="tree-toggle" onClick={() => toggle(folderKey)}>{folderCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}</button>
                          <button className="tree-label" onClick={() => toggle(folderKey)} title={folder.name}><Folder size={12} /><span>{folder.name}</span></button>
                          <div className="tree-actions">
                            <button title={t("New request in folder")} onClick={() => createRequest({ collectionId: collection.id, folderId: folder.id })}><FilePlus2 size={11} /></button>
                            <button title={t("Rename folder")} onClick={() => {
                              const name = window.prompt(t("Rename folder"), folder.name);
                              if (name?.trim()) renameFolder(collection.id, folder.id, name.trim());
                            }}><Pencil size={11} /></button>
                            <button className="danger" title={t("Delete folder")} onClick={() => {
                              if (window.confirm(t('Delete folder “{name}”? Its requests will move to the collection root.', { name: folder.name }))) deleteFolder(collection.id, folder.id);
                            }}><Trash2 size={11} /></button>
                          </div>
                        </div>
                        {!folderCollapsed && <div className="folder-children">{folder.requestIds.map((id) => <RequestTreeItem key={id} requestId={id} nested />)}</div>}
                      </div>
                    );
                  })}
                  {!collection.requestIds.length && !collection.folders.length && <div className="tree-empty">{t("Empty collection")}</div>}
                </div>
              )}
            </div>
          );
        })}

        {unfiled.length > 0 && (
          <div className="collection-node unfiled-node">
            <div className="tree-row collection-row"><span className="collection-drag-handle" /><span className="tree-toggle" /><div className="tree-label"><Folder size={13} /><span>{t("Unfiled")}</span></div></div>
            <div className="tree-children">{unfiled.map((request) => <RequestTreeItem key={request.id} requestId={request.id} />)}</div>
          </div>
        )}
      </div>

    </>
  );
}
