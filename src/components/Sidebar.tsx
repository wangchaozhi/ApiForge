import { translate as t, useLocale } from '../i18n';
import {
  Braces,
  ChevronDown,
  ChevronRight,
  Clock3,
  Cookie,
  Copy,
  FilePlus2,
  Folder,
  FolderPlus,
  GripVertical,
  MoveRight,
  Pencil,
  Plus,
  Play,
  Settings2,
  Trash2,
  Upload,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { parseOpenApi } from '../lib/openapi';
import { useAppStore, type CreateTarget } from '../store/appStore';

export function Sidebar() {
  useLocale();
  const requests = useAppStore((state) => state.requests);
  const collections = useAppStore((state) => state.collections);
  const activeRequestId = useAppStore((state) => state.activeRequestId);
  const activeView = useAppStore((state) => state.activeView);
  const historyCount = useAppStore((state) => state.history.length);
  const setActiveRequest = useAppStore((state) => state.setActiveRequest);
  const setActiveView = useAppStore((state) => state.setActiveView);
  const createRequest = useAppStore((state) => state.createRequest);
  const deleteRequest = useAppStore((state) => state.deleteRequest);
  const duplicateRequest = useAppStore((state) => state.duplicateRequest);
  const moveRequest = useAppStore((state) => state.moveRequest);
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

  const requestById = useMemo(() => new Map(requests.map((request) => [request.id, request])), [requests]);
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

  const chooseMoveTarget = (requestName: string): CreateTarget | undefined | null => {
    const targets: Array<{ label: string; target: CreateTarget | undefined }> = [{ label: t("Unfiled"), target: undefined }];
    for (const collection of collections) {
      targets.push({ label: collection.name, target: { collectionId: collection.id } });
      for (const folder of collection.folders) {
        targets.push({ label: `${collection.name} / ${folder.name}`, target: { collectionId: collection.id, folderId: folder.id } });
      }
    }
    const menu = targets.map((item, index) => `${index + 1}. ${item.label}`).join('\n');
    const choice = window.prompt(t('Move “{name}” to:\n\n{menu}\n\nEnter a number:', { name: requestName, menu }));
    if (choice === null) return null;
    const index = Number(choice) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= targets.length) {
      window.alert(t("Invalid destination."));
      return null;
    }
    return targets[index].target;
  };

  const requestRow = (requestId: string, nested = false) => {
    const request = requestById.get(requestId);
    if (!request) return null;
    return (
      <div className={`tree-request-wrap ${nested ? 'nested' : ''}`} key={request.id}>
        <button
          className={`request-item ${activeView === 'collections' && request.id === activeRequestId ? 'active' : ''}`}
          onClick={() => setActiveRequest(request.id)}
        >
          <span className={`method method-${request.method.toLowerCase()}`}>{request.method}</span>
          <span className="request-name">{request.name}</span>
        </button>
        <div className="tree-request-actions">
          <button className="tree-icon-action" title={t("Duplicate request")} onClick={() => duplicateRequest(request.id)}><Copy size={11} /></button>
          <button className="tree-icon-action" title={t("Move request")} onClick={() => {
            const target = chooseMoveTarget(request.name);
            if (target !== null) moveRequest(request.id, target);
          }}><MoveRight size={11} /></button>
          <button
            className="tree-icon-action danger"
            title={t("Delete request")}
            onClick={() => {
              if (window.confirm(t('Delete “{name}”?', { name: request.name }))) deleteRequest(request.id);
            }}
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>
    );
  };

  const importOpenApiFile = async (file: File) => {
    try {
      const imported = parseOpenApi(await file.text(), file.name);
      importCollection(imported.collection, imported.requests);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">A</div>
        <div>
          <strong>ApiForge</strong>
          <span>{t("Local workspace")}</span>
        </div>
      </div>

      <button className="new-request" onClick={() => createRequest()}>
        <Plus size={16} /> {t("New Request")}
      </button>

      <nav className="nav-list" aria-label={t("Workspace navigation")}>
        <button className={`nav-item ${activeView === 'collections' ? 'active-static' : ''}`} onClick={() => setActiveView('collections')}><Folder size={15} /> {t("Collections")}</button>
        <button className={`nav-item ${activeView === 'runner' ? 'active-static' : ''}`} onClick={() => setActiveView('runner')}><Play size={15} /> {t('Runner')}</button>
        <button className={`nav-item ${activeView === 'history' ? 'active-static' : ''}`} onClick={() => setActiveView('history')}><Clock3 size={15} /> {t("History")} {historyCount > 0 && <span className="nav-count">{historyCount}</span>}</button>
        <button className={`nav-item ${activeView === 'environments' ? 'active-static' : ''}`} onClick={() => setActiveView('environments')}><Braces size={15} /> {t("Environments")}</button>
        <button className={`nav-item ${activeView === 'cookies' ? 'active-static' : ''}`} onClick={() => setActiveView('cookies')}><Cookie size={15} /> {t("Cookies")}</button>
      </nav>

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
                  {collection.requestIds.map((id) => requestRow(id))}
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
                        {!folderCollapsed && <div className="folder-children">{folder.requestIds.map((id) => requestRow(id, true))}</div>}
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
            <div className="tree-children">{unfiled.map((request) => requestRow(request.id))}</div>
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <button className={`nav-item ${activeView === 'settings' ? 'active-static' : ''}`} onClick={() => setActiveView('settings')}><Settings2 size={15} /> {t("Settings")}</button>
      </div>
    </aside>
  );
}
