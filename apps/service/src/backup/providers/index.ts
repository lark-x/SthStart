import type { BackupCapabilities, BackupTarget, BackupTargetKind } from '@sthstart/contracts';
import { GoogleDriveProvider } from './google-drive.js';
import { LocalTestProvider } from './local-test.js';
import { OneDriveProvider } from './onedrive.js';
import { BackupProviderError, classifyFailure, type BackupProvider, type ProviderContext } from './types.js';
import { probeQuarkCapabilities } from './quark.js';

export function providerCapabilities(kind: BackupTargetKind): BackupCapabilities {
  switch (kind) {
    case 'local_test':
      return { resumableUpload: true, delete: true, remoteChecksum: true, list: true };
    case 'google_drive':
      return { resumableUpload: true, delete: true, remoteChecksum: false, list: true };
    case 'onedrive':
      return { resumableUpload: true, delete: true, remoteChecksum: false, list: true };
    case 'quark':
      // 未联调：不具备已核实的能力，UI 不应展示可用的备份开关。
      return { resumableUpload: false, delete: false, remoteChecksum: false, list: false };
  }
}

/**
 * 适配器工厂。夸克在完成能力联调前不返回可用适配器，
 * 直接给出明确原因，而不是让一次上传「看起来成功了」。
 */
export function createProvider(target: BackupTarget, context: Omit<ProviderContext, 'kind' | 'rootPath' | 'accountLabel' | 'directory'> & { directory?: string | null }): BackupProvider {
  const base: ProviderContext = {
    kind: target.kind,
    rootPath: target.rootPath,
    accountLabel: target.accountLabel,
    credential: context.credential,
    directory: context.directory ?? null,
    fetcher: context.fetcher,
    downloadVerifyLimitBytes: context.downloadVerifyLimitBytes,
  };
  switch (target.kind) {
    case 'local_test':
      return new LocalTestProvider(base);
    case 'google_drive':
      return new GoogleDriveProvider(base);
    case 'onedrive':
      return new OneDriveProvider(base);
    case 'quark': {
      const report = probeQuarkCapabilities();
      throw new BackupProviderError(
        'backup_quark_unverified',
        '夸克网盘尚未完成能力联调（' + (report.cliPath ? '检测到 CLI：' + report.cliPath + '，但仍未验证上传/列举/下载' : '当前环境未检测到夸克 CLI') + '），该目标保持未完成状态。',
        false,
        { report: report as unknown as Record<string, unknown> },
      );
    }
  }
}

export { BackupProviderError, classifyFailure, probeQuarkCapabilities };
export type { BackupProvider };
