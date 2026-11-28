import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import JSZip from 'jszip';

const execFileAsync = promisify(execFile);

const SIGNING_DIR = path.join(process.cwd(), 'data', 'signing');
const SIGNING_KEY_PATH = path.join(SIGNING_DIR, 'play55-release-key.pem');
const SIGNING_CERT_PATH = path.join(SIGNING_DIR, 'play55-release-cert.pem');

export interface ApkSignatureDetails {
  isSignedApk: boolean;
  signatureScheme: 'v1+v2' | 'v2/v3' | 'v1' | 'unsigned';
  signerCertSha256?: string;
  signerSubject?: string;
}

async function ensurePlay55SigningCredentials(): Promise<{ keyPath: string; certPath: string }> {
  await fs.promises.mkdir(SIGNING_DIR, { recursive: true });
  if (fs.existsSync(SIGNING_KEY_PATH) && fs.existsSync(SIGNING_CERT_PATH)) {
    return { keyPath: SIGNING_KEY_PATH, certPath: SIGNING_CERT_PATH };
  }

  await execFileAsync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    SIGNING_KEY_PATH,
    '-out',
    SIGNING_CERT_PATH,
    '-days',
    '3650',
    '-subj',
    '/CN=Play55 Release Signer/O=Play55 Store/C=SA',
  ]);
  await fs.promises.chmod(SIGNING_KEY_PATH, 0o600).catch(() => {});
  return { keyPath: SIGNING_KEY_PATH, certPath: SIGNING_CERT_PATH };
}

export async function getPlay55SignerCertFingerprint(): Promise<string | undefined> {
  try {
    const { certPath } = await ensurePlay55SigningCredentials();
    const { stdout } = await execFileAsync('openssl', [
      'x509',
      '-in',
      certPath,
      '-noout',
      '-fingerprint',
      '-sha256',
    ]);
    const match = stdout.match(/SHA256 Fingerprint=([0-9A-Fa-f:]+)/i);
    return match ? match[1].replace(/:/g, '').toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

export async function inspectApkSignatureDetails(
  buffer: Buffer,
  zip: JSZip
): Promise<ApkSignatureDetails> {
  const fileNames = Object.keys(zip.files);
  const certEntries = fileNames.filter((n) => /^META-INF\/.+\.(RSA|DSA|EC)$/i.test(n));
  const hasV1Sf = fileNames.some((n) => /^META-INF\/.+\.SF$/i.test(n));
  const hasV1 = certEntries.length > 0 && hasV1Sf;
  const hasV2 = buffer.includes('APK Sig Block 42');

  const signatureScheme: ApkSignatureDetails['signatureScheme'] =
    hasV1 && hasV2 ? 'v1+v2' : hasV2 ? 'v2/v3' : hasV1 ? 'v1' : 'unsigned';

  let signerCertSha256: string | undefined;
  let signerSubject: string | undefined;

  if (certEntries.length > 0) {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'p55-cert-'));
    try {
      const certEntry = zip.file(certEntries[0]);
      if (certEntry) {
        const rsaBuf = await certEntry.async('nodebuffer');
        const rsaFile = path.join(tempDir, 'cert.rsa');
        await fs.promises.writeFile(rsaFile, rsaBuf);
        const { stdout: pemOut } = await execFileAsync('openssl', [
          'pkcs7',
          '-inform',
          'DER',
          '-in',
          rsaFile,
          '-print_certs',
        ]);
        const certPemMatch = pemOut.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
        if (certPemMatch) {
          const x509File = path.join(tempDir, 'cert.pem');
          await fs.promises.writeFile(x509File, certPemMatch[0], 'utf8');
          const { stdout: infoOut } = await execFileAsync('openssl', [
            'x509',
            '-in',
            x509File,
            '-noout',
            '-fingerprint',
            '-sha256',
            '-subject',
          ]);
          const fpMatch = infoOut.match(/SHA256 Fingerprint=([0-9A-Fa-f:]+)/i);
          if (fpMatch) {
            signerCertSha256 = fpMatch[1].replace(/:/g, '').toLowerCase();
          }
          const subjMatch = infoOut.match(/subject=(.+)/i);
          if (subjMatch) {
            signerSubject = subjMatch[1].trim();
          }
        }
      }
    } catch {
      // Non-fatal: continue with scheme detection even if cert metadata extraction fails
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return {
    isSignedApk: hasV1 || hasV2,
    signatureScheme,
    signerCertSha256,
    signerSubject,
  };
}

function sha256Base64(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('base64');
}

export async function signUnsignedApkBuffer(buffer: Buffer): Promise<{
  signedBuffer: Buffer;
  alreadySigned: boolean;
  certSha256?: string;
}> {
  const zip = await JSZip.loadAsync(buffer);
  const existing = await inspectApkSignatureDetails(buffer, zip);

  // Never overwrite an existing developer release signature
  if (existing.isSignedApk) {
    return {
      signedBuffer: buffer,
      alreadySigned: true,
      certSha256: existing.signerCertSha256,
    };
  }

  const { keyPath, certPath } = await ensurePlay55SigningCredentials();

  const entrySections: string[] = [];
  const sfSections: string[] = [];
  const fileNames = Object.keys(zip.files).sort();

  for (const name of fileNames) {
    const entry = zip.files[name];
    if (entry.dir) continue;
    if (/^META-INF\/(MANIFEST\.MF|.+\.(SF|RSA|DSA|EC))$/i.test(name)) {
      zip.remove(name);
      continue;
    }
    const content = await entry.async('nodebuffer');
    const digest = sha256Base64(content);
    const section = `Name: ${name}\r\nSHA-256-Digest: ${digest}\r\n\r\n`;
    entrySections.push(section);
    sfSections.push(`Name: ${name}\r\nSHA-256-Digest: ${sha256Base64(section)}\r\n\r\n`);
  }

  const manifestHeader = 'Manifest-Version: 1.0\r\nCreated-By: Play55 Release Signer\r\n\r\n';
  const manifestContent = manifestHeader + entrySections.join('');
  const manifestDigest = sha256Base64(manifestContent);

  const sfHeader =
    'Signature-Version: 1.0\r\n' +
    'Created-By: Play55 Release Signer\r\n' +
    `SHA-256-Digest-Manifest: ${manifestDigest}\r\n` +
    `SHA-256-Digest-Manifest-Main-Attributes: ${sha256Base64(manifestHeader)}\r\n\r\n`;
  const sfContent = sfHeader + sfSections.join('');

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'p55-sign-'));
  let rsaSignatureBuf: Buffer;
  try {
    const sfPath = path.join(tempDir, 'PLAY55.SF');
    const rsaPath = path.join(tempDir, 'PLAY55.RSA');
    await fs.promises.writeFile(sfPath, sfContent, 'utf8');
    await execFileAsync('openssl', [
      'cms',
      '-sign',
      '-binary',
      '-in',
      sfPath,
      '-signer',
      certPath,
      '-inkey',
      keyPath,
      '-outform',
      'DER',
      '-out',
      rsaPath,
      '-noattr',
      '-md',
      'sha256',
    ]);
    rsaSignatureBuf = await fs.promises.readFile(rsaPath);
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }

  zip.file('META-INF/MANIFEST.MF', manifestContent);
  zip.file('META-INF/PLAY55.SF', sfContent);
  zip.file('META-INF/PLAY55.RSA', rsaSignatureBuf);

  const signedBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  const certSha256 = await getPlay55SignerCertFingerprint();

  return {
    signedBuffer,
    alreadySigned: false,
    certSha256,
  };
}
