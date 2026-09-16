import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  BACKUP_FORMAT_VERSION, decryptFileToFile, defaultScryptParams, deriveRecoveryWrappingKey, deriveSubkey,
  deriveWrappingKey, encryptFileToFile, generateRecoveryKey, objectRemoteKey, randomKey,
  recoveryVerifier, unwrapMasterKey, verifyRecoveryKey, wrapMasterKey,
} from './backup/crypto.js';

function workspace() {
  const dir = resolve(tmpdir(), 'backup-crypto-' + randomUUID());
  mkdirSync(dir, { recursive: true });
  return dir;
}

test('backup crypto: 加解密往返一致，密文与明文不同且可校验', async () => {
  const dir = workspace();
  try {
    const source = resolve(dir, 'plain.bin');
    // 跨块内容，确保是流式处理而不是一次读入。
    writeFileSync(source, Buffer.concat([Buffer.from('钟离是往生堂的客卿。'), Buffer.alloc(200_000, 7), Buffer.from('结束')]));
    const masterKey = randomKey();
    const cipherPath = resolve(dir, 'objects', 'a.bin');
    const encrypted = await encryptFileToFile({ sourcePath: source, targetPath: cipherPath, masterKey, vaultId: 'vault-1', objectId: 'object-1' });
    assert.ok(encrypted.cipherBytes > 200_000);
    assert.match(encrypted.cipherHash, /^[0-9a-f]{64}$/);

    const cipherBytes = readFileSync(cipherPath);
    assert.ok(!cipherBytes.includes(Buffer.from('往生堂')), '密文里不应出现明文内容');
    assert.equal(String.fromCharCode(...cipherBytes.subarray(0, 8)), 'STHBAK01');

    const restored = resolve(dir, 'restored.bin');
    const decrypted = await decryptFileToFile({ cipherPath, targetPath: restored, masterKey, vaultId: 'vault-1', objectId: 'object-1' });
    assert.equal(decrypted.plaintextBytes, encrypted.cipherBytes === 0 ? 0 : readFileSync(source).length);
    assert.deepEqual(readFileSync(restored), readFileSync(source), '解密结果必须与原文逐字节一致');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('backup crypto: 错误主密钥与被篡改密文都不产生明文', async () => {
  const dir = workspace();
  try {
    const source = resolve(dir, 'plain.bin');
    writeFileSync(source, 'sealed content 内容');
    const masterKey = randomKey();
    const cipherPath = resolve(dir, 'c.bin');
    await encryptFileToFile({ sourcePath: source, targetPath: cipherPath, masterKey, vaultId: 'v', objectId: 'o' });

    // 1) 错误主密钥。
    const wrongTarget = resolve(dir, 'wrong.bin');
    await assert.rejects(
      () => decryptFileToFile({ cipherPath, targetPath: wrongTarget, masterKey: randomKey(), vaultId: 'v', objectId: 'o' }),
      /backup_(decrypt_failed|unlock_failed)/,
    );
    // 失败时目标文件不应存在（更不应留下部分明文）。
    assert.equal(existsSync(wrongTarget), false, '失败时不能留下部分明文');

    // 2) 篡改密文正文中的一个字节。
    const tampered = readFileSync(cipherPath);
    tampered[tampered.length - 30] ^= 0xff;
    const tamperedPath = resolve(dir, 'tampered.bin');
    writeFileSync(tamperedPath, tampered);
    await assert.rejects(
      () => decryptFileToFile({ cipherPath: tamperedPath, targetPath: resolve(dir, 't2.bin'), masterKey, vaultId: 'v', objectId: 'o' }),
      /backup_decrypt_failed/,
    );

    // 3) 对象身份不符（防止密文被挪到别的对象名上）。
    await assert.rejects(
      () => decryptFileToFile({ cipherPath, targetPath: resolve(dir, 't3.bin'), masterKey, vaultId: 'v', objectId: 'other' }),
      /backup_object_identity_mismatch/,
    );

    // 4) 截断的密文。
    writeFileSync(resolve(dir, 'trunc.bin'), readFileSync(cipherPath).subarray(0, 12));
    await assert.rejects(
      () => decryptFileToFile({ cipherPath: resolve(dir, 'trunc.bin'), targetPath: resolve(dir, 't4.bin'), masterKey, vaultId: 'v', objectId: 'o' }),
      /backup_header_truncated/,
    );
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('backup crypto: 密码与恢复密钥都能包裹主密钥，错误密码解不开', () => {
  const params = defaultScryptParams();
  const masterKey = randomKey();

  const passwordKey = deriveWrappingKey('correct horse battery staple', params);
  const wrapped = wrapMasterKey(masterKey, passwordKey, 'password');
  assert.deepEqual(unwrapMasterKey(wrapped, deriveWrappingKey('correct horse battery staple', params), 'password'), masterKey);
  assert.throws(() => unwrapMasterKey(wrapped, deriveWrappingKey('wrong password', params), 'password'), /backup_unlock_failed/);

  // 恢复密钥是第二份独立包裹材料。
  const recoveryKey = generateRecoveryKey();
  assert.match(recoveryKey, /^[A-Z0-9]{5}(-[A-Z0-9]{5})+$/);
  const recoveryWrapped = wrapMasterKey(masterKey, deriveRecoveryWrappingKey(recoveryKey, params), 'recovery');
  assert.deepEqual(unwrapMasterKey(recoveryWrapped, deriveRecoveryWrappingKey(recoveryKey, params), 'recovery'), masterKey);
  // 用途分离：密码包裹的密文不能用恢复密钥解开。
  assert.throws(() => unwrapMasterKey(wrapped, deriveRecoveryWrappingKey(recoveryKey, params), 'recovery'), /backup_unlock_failed/);

  // 校验段能识别恢复密钥输错。
  const verifier = recoveryVerifier(recoveryKey, Buffer.from(params.salt, 'base64'));
  assert.equal(verifyRecoveryKey(recoveryKey, verifier.verifierSalt, verifier.verifierHash), true);
  assert.equal(verifyRecoveryKey('AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF-GGGGG-HHHHH', verifier.verifierSalt, verifier.verifierHash), false);
});

test('backup crypto: 子密钥用途分离，远端对象名不暴露明文 hash', () => {
  const masterKey = randomKey();
  const encryption = deriveSubkey(masterKey, 'object-encryption');
  const naming = deriveSubkey(masterKey, 'object-naming');
  assert.notDeepEqual(encryption, naming, '不同用途必须派生不同子密钥');
  assert.equal(encryption.length, 32);
  // 同一主密钥下派生稳定，便于复用已生成的密文对象。
  assert.deepEqual(deriveSubkey(masterKey, 'object-encryption'), encryption);

  const contentHash = 'a'.repeat(64);
  const remoteKey = objectRemoteKey(naming, contentHash);
  assert.match(remoteKey, /^[0-9a-f]{40}$/);
  assert.ok(!remoteKey.includes(contentHash.slice(0, 8)), '远端键不能包含明文内容 hash');
  // 换仓库（不同 naming 子密钥）得到不同远端键。
  assert.notEqual(objectRemoteKey(deriveSubkey(randomKey(), 'object-naming'), contentHash), remoteKey);
  assert.equal(BACKUP_FORMAT_VERSION, 1);
});
