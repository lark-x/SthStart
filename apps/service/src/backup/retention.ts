import type { BackupCleanupPreview, BackupTarget } from '@sthstart/contracts';
import type { BackupStore } from './store.js';
import { classifyFailure, type BackupProvider } from './providers/index.js';

export interface RetentionResult {
  targetId: string;
  expiredSnapshotIds: string[];
  deletedObjectCount: number;
  reclaimedBytes: number;
  physicalDelete: boolean;
  notice: string;
  failures: string[];
}

/** 同一仓库其它目标仍引用的对象：清理不能连带删除它们。 */
function otherTargetReferences(store: BackupStore, targetId: string): Set<string> {
  const referenced = new Set<string>();
  for (const target of store.listTargets()) {
    if (target.id === targetId) continue;
    for (const objectId of store.objectReferencesForTarget(target.id).keys()) referenced.add(objectId);
    for (const snapshotId of store.listPublishedSnapshotIds(target.id)) {
      for (const objectId of store.listSnapshotObjectIds(snapshotId)) referenced.add(objectId);
    }
  }
  return referenced;
}

/**
 * 只读清理预览：淘汰哪些版本、命中多少只被它们引用的对象、预计释放多少空间。
 * 不读远端，也不修改任何状态。
 */
export function cleanupPreview(store: BackupStore, targetId: string, retainCount: number): BackupCleanupPreview {
  const references = store.objectReferencesForTarget(targetId);
  const base = store.buildCleanupPreview(targetId, retainCount, references);
  const others = otherTargetReferences(store, targetId);
  if (!others.size) return base;
  // 其它目标仍在引用时不能删：重算独占对象，避免给出虚假的可释放空间。
  const removable = new Set(base.removableSnapshotIds);
  let deletableObjectCount = 0;
  let reclaimableBytes = 0;
  for (const [objectId, snapshotIds] of references) {
    if (!snapshotIds.length || !snapshotIds.every((snapshotId) => removable.has(snapshotId))) continue;
    if (others.has(objectId)) continue;
    const object = store.getObject(objectId);
    if (!object || object.pinned) continue;
    deletableObjectCount += 1;
    reclaimableBytes += object.cipherBytes;
  }
  return {
    ...base,
    deletableObjectCount,
    reclaimableBytes,
    notice: base.physicalDeleteSupported
      ? '将淘汰 ' + base.removableSnapshotIds.length + ' 个版本；另有 ' + others.size + ' 个对象被其它目标引用，本次保留。'
      : base.notice,
  };
}

/**
 * 单个目标的保留清理。
 *
 * - 先让过期版本退出可恢复集合，再删除不再被任何保留清单引用的对象。
 * - 引用集合覆盖该目标所有保留版本、该仓库其它目标以及被固定的对象。
 * - 没有删除能力的网盘只做逻辑过期，并如实说明需要手动清理，不计入已释放空间。
 */
export async function cleanupTarget(input: {
  store: BackupStore;
  provider: BackupProvider;
  target: BackupTarget;
  vaultId: string;
  retainCount: number;
}): Promise<RetentionResult> {
  const { store, provider, target } = input;
  const preview = cleanupPreview(store, target.id, input.retainCount);
  const expired = preview.removableSnapshotIds;
  const failures: string[] = [];
  if (!expired.length) {
    return { targetId: target.id, expiredSnapshotIds: [], deletedObjectCount: 0, reclaimedBytes: 0, physicalDelete: false, notice: '没有需要淘汰的历史版本。', failures };
  }
  // 先读取引用集合再做过期处理：过期版本的引用行会被删掉，
  // 若在删除之后才读，就再也看不出这些独占对象该不该删。
  const references = store.objectReferencesForTarget(target.id);
  const others = otherTargetReferences(store, target.id);
  const removedSet = new Set(expired);
  const stillReferenced = new Set<string>();
  for (const [objectId, snapshotIds] of references) {
    if (snapshotIds.some((snapshotId) => !removedSet.has(snapshotId))) stillReferenced.add(objectId);
  }

  // 1. 逻辑过期：这些版本不再出现在该目标的可恢复列表里，其它目标不受影响。
  for (const snapshotId of expired) {
    store.deleteTargetRun(snapshotId, target.id);
    store.deleteSnapshotObjectRefs(target.id, snapshotId);
  }

  if (!preview.physicalDeleteSupported) {
    return {
      targetId: target.id,
      expiredSnapshotIds: expired,
      deletedObjectCount: 0,
      reclaimedBytes: 0,
      physicalDelete: false,
      notice: '该目标不支持删除：' + expired.length + ' 个历史版本已逻辑过期，云端文件需要在网盘端手动清理，未释放任何空间。',
      failures,
    };
  }

  // 2. 物理清理：先删这些版本的清单，再删不再被任何保留版本引用的对象。
  for (const snapshotId of expired) {
    const remote = await provider.statSnapshot(input.vaultId, snapshotId).catch(() => null);
    if (!remote) continue;
    const removed = await provider.deleteRemote({ vaultId: input.vaultId, remoteId: remote.remoteId }).catch((error) => {
      failures.push(classifyFailure(error).message);
      return false;
    });
    if (!removed) failures.push('版本 ' + snapshotId + ' 的远端清单未能删除。');
  }

  let deletedObjects = 0;
  let reclaimedBytes = 0;
  for (const [objectId, snapshotIds] of references) {
    if (!snapshotIds.length || !snapshotIds.every((snapshotId) => removedSet.has(snapshotId))) continue;
    if (stillReferenced.has(objectId) || others.has(objectId)) continue;
    const object = store.getObject(objectId);
    if (!object || object.pinned) continue;
    const targetObject = store.getTargetObject(target.id, input.vaultId, objectId);
    if (targetObject?.remoteId) {
      const removed = await provider.deleteRemote({ vaultId: input.vaultId, remoteId: targetObject.remoteId }).catch((error) => {
        failures.push(classifyFailure(error).message);
        return false;
      });
      if (!removed) {
        failures.push('对象 ' + objectId + ' 的远端副本未能删除。');
        continue;
      }
      reclaimedBytes += object.cipherBytes;
    }
    store.deleteTargetObject(target.id, objectId);
    store.deleteObject(objectId);
    deletedObjects += 1;
  }

  return {
    targetId: target.id,
    expiredSnapshotIds: expired,
    deletedObjectCount: deletedObjects,
    reclaimedBytes,
    physicalDelete: true,
    notice: failures.length
      ? '已淘汰 ' + expired.length + ' 个版本，但有 ' + failures.length + ' 项远端删除未完成，未把它们计为已释放。'
      : '已淘汰 ' + expired.length + ' 个版本，删除 ' + deletedObjects + ' 个独占对象。',
    failures,
  };
}
