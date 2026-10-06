import { translate as t } from '../../i18n/index.ts';
import type { ApiCollection } from '../../domain/workspace.ts';
import type { CreateTarget } from '../../store/types.ts';

export const chooseMoveTarget = (collections: ApiCollection[], requestName: string): CreateTarget | undefined | null => {
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
