import { translate as t } from '../../i18n/index.ts';
import { createId } from '../../lib/id.ts';
import type { AppSlice } from '../types.ts';

export const createCollectionsSlice: AppSlice<'createCollection' | 'renameCollection' | 'deleteCollection' | 'createFolder' | 'renameFolder' | 'deleteFolder' | 'reorderCollections'> = (set) => ({
  createCollection: (name = t("New Collection")) => {
    const id = createId('col');
    set((state) => ({ collections: [...state.collections, { id, name, requestIds: [], folders: [] }] }));
    return id;
  },
  renameCollection: (id, name) => set((state) => ({
    collections: state.collections.map((collection) => collection.id === id ? { ...collection, name: name.trim() || collection.name } : collection),
  })),
  deleteCollection: (id) => set((state) => ({ collections: state.collections.filter((collection) => collection.id !== id) })),
  createFolder: (collectionId, name = t("New Folder")) => {
    const id = createId('folder');
    set((state) => ({
      collections: state.collections.map((collection) => collection.id === collectionId
        ? { ...collection, folders: [...collection.folders, { id, name, requestIds: [] }] }
        : collection),
    }));
    return id;
  },
  renameFolder: (collectionId, folderId, name) => set((state) => ({
    collections: state.collections.map((collection) => collection.id === collectionId
      ? {
          ...collection,
          folders: collection.folders.map((folder) => folder.id === folderId ? { ...folder, name: name.trim() || folder.name } : folder),
        }
      : collection),
  })),
  deleteFolder: (collectionId, folderId) => set((state) => ({
    collections: state.collections.map((collection) => {
      if (collection.id !== collectionId) return collection;
      const folder = collection.folders.find((item) => item.id === folderId);
      return {
        ...collection,
        requestIds: folder ? [...collection.requestIds, ...folder.requestIds.filter((id) => !collection.requestIds.includes(id))] : collection.requestIds,
        folders: collection.folders.filter((item) => item.id !== folderId),
      };
    }),
  })),
  reorderCollections: (sourceId, targetId) => set((state) => {
    if (sourceId === targetId) return state;
    const sourceIndex = state.collections.findIndex((item) => item.id === sourceId);
    const targetIndex = state.collections.findIndex((item) => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return state;
    const collections = [...state.collections];
    const [source] = collections.splice(sourceIndex, 1);
    const nextTargetIndex = collections.findIndex((item) => item.id === targetId);
    collections.splice(nextTargetIndex, 0, source);
    return { collections };
  }),
});
