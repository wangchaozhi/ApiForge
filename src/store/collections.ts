import { translate as t } from '../i18n/index.ts';
import { createId } from '../lib/id.ts';
import type { ApiCollection } from '../domain/workspace.ts';
import type { ApiRequest } from '../domain/request.ts';
import type { CreateTarget } from './types.ts';

export function normalizeCollections(collections: ApiCollection[] | undefined, requests: ApiRequest[]) {
  if (!collections?.length) {
    return [{ id: createId('col'), name: t("My Collection"), requestIds: requests.map((item) => item.id), folders: [] }];
  }
  const valid = new Set(requests.map((item) => item.id));
  return collections.map((collection) => ({
    ...collection,
    requestIds: (collection.requestIds ?? []).filter((id) => valid.has(id)),
    folders: (collection.folders ?? []).map((folder) => ({
      ...folder,
      requestIds: (folder.requestIds ?? []).filter((id) => valid.has(id)),
    })),
  }));
}




export function removeRequestFromCollections(collections: ApiCollection[], requestId: string) {
  return collections.map((collection) => ({
    ...collection,
    requestIds: collection.requestIds.filter((id) => id !== requestId),
    folders: collection.folders.map((folder) => ({
      ...folder,
      requestIds: folder.requestIds.filter((id) => id !== requestId),
    })),
  }));
}

export function addRequestToTarget(collections: ApiCollection[], requestId: string, target: CreateTarget = {}) {
  if (!target.collectionId) return collections;
  return collections.map((collection) => {
    if (collection.id !== target.collectionId) return collection;
    if (target.folderId) {
      return {
        ...collection,
        folders: collection.folders.map((folder) =>
          folder.id === target.folderId && !folder.requestIds.includes(requestId)
            ? { ...folder, requestIds: [...folder.requestIds, requestId] }
            : folder,
        ),
      };
    }
    return collection.requestIds.includes(requestId)
      ? collection
      : { ...collection, requestIds: [...collection.requestIds, requestId] };
  });
}

export function findRequestTarget(collections: ApiCollection[], requestId: string): CreateTarget {
  for (const collection of collections) {
    if (collection.requestIds.includes(requestId)) return { collectionId: collection.id };
    const folder = collection.folders.find((item) => item.requestIds.includes(requestId));
    if (folder) return { collectionId: collection.id, folderId: folder.id };
  }
  return {};
}
