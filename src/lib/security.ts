/**
 * NEXORA Security & Cryptographic Utility Module
 * - CSPRNG token & reference generation (Web Crypto API)
 * - RFC-4180 CSV export with Spreadsheet Formula Injection neutralization
 * - URL, Email, Input, and Prototype-Pollution-safe JSON guards
 * - Salted SHA-256 credential verification for offline fallback mode
 */

const LOCAL_CRED_STORAGE_KEY = 'nexora_local_auth_vault_v1';

// ============================================================================
// 1. Cryptographically Secure Pseudo-Random Generators (CSPRNG)
// ============================================================================

export function getRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
  throw new Error('Cryptographically secure random number generator is unavailable in this environment.');
}

export function generateRandomHex(byteLength = 12): string {
  const bytes = getRandomBytes(byteLength);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateRandomDigits(digits = 6): string {
  const bytes = getRandomBytes(digits);
  let out = '';
  for (let i = 0; i < digits; i++) {
    out += (bytes[i] % 10).toString();
  }
  return out;
}

export function generateUniqueId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${generateRandomHex(4)}`;
}

export function generateOrderReference(): string {
  return `NX-${generateRandomDigits(6)}-${generateRandomHex(2).toUpperCase()}`;
}

export function generateTransactionReference(): string {
  return `TXN-${generateRandomHex(6).toUpperCase()}`;
}

export function generateTicketCode(sequenceNumber: number): string {
  return `NX-${generateRandomDigits(6)}-${sequenceNumber}`;
}

export function generateTicketToken(): string {
  return `nx_${generateRandomHex(16)}`;
}

export function generateClaimToken(): string {
  return `CLAIM-${generateRandomHex(5).toUpperCase()}-${Date.now().toString(36).slice(-3).toUpperCase()}`;
}

export function generateHmacFingerprint(): string {
  return `hmac_sha256_${generateRandomHex(10)}`;
}

// ============================================================================
// 2. CSV Formula Injection Protection & Safe Exporter
// ============================================================================

const DANGEROUS_CSV_PREFIX = /^[\s\u0000-\u001F]*[=+\-@\t\r]/;

/**
 * Neutralizes spreadsheet formula injection (CWE-1236) and formats RFC-4180 CSV cell.
 */
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let str = String(value).replace(/\r\n/g, ' ').replace(/[\r\n]/g, ' ');
  if (DANGEROUS_CSV_PREFIX.test(str)) {
    str = `'${str}`;
  }
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

export function buildSafeCsv(headers: string[], rows: unknown[][]): string {
  const headerLine = headers.map(sanitizeCsvCell).join(',');
  const dataLines = rows.map((row) => row.map(sanitizeCsvCell).join(','));
  return [headerLine, ...dataLines].join('\n');
}

export function downloadSafeCsv(filename: string, headers: string[], rows: unknown[][]): void {
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const csv = buildSafeCsv(headers, rows);
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeFilename.endsWith('.csv') ? safeFilename : `${safeFilename}.csv`;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ============================================================================
// 3. Input Validation, URL Guards & Safe JSON Parsing
// ============================================================================

export function isValidEmail(email: string): boolean {
  const trimmed = email.trim();
  if (trimmed.length < 5 || trimmed.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed);
}

export function sanitizeText(input: unknown, maxLength = 500): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLength);
}

export function isSafeHttpsUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function sanitizeSelfSignupRole(role: unknown): 'attendee' | 'organizer' {
  return role === 'organizer' ? 'organizer' : 'attendee';
}

export function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    const parsed = JSON.parse(raw, (key, value) => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        return undefined;
      }
      return value;
    });
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

// ============================================================================
// 4. Super Admin Session Token Helpers (In-memory server-signed token)
// ============================================================================

let inMemoryAdminToken: string | null = null;

export function getAdminSessionToken(): string | null {
  return inMemoryAdminToken;
}

export function setAdminSessionToken(token: string): void {
  inMemoryAdminToken = token;
}

export function clearAdminSessionToken(): void {
  inMemoryAdminToken = null;
}

// ============================================================================
// 5. Offline-Mode Salted Password Hashing (Only used when Supabase is unconfigured)
// ============================================================================

interface LocalCredentialRecord {
  id: string;
  email: string;
  name: string;
  role: 'attendee' | 'organizer';
  saltHex: string;
  hashHex: string;
  createdAt: string;
}

async function deriveSaltedPasswordHash(password: string, saltHex: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto API is required for password verification.');
  }
  const encoder = new TextEncoder();
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const saltBytes = new Uint8Array(saltHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));
  const bits = await globalThis.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('');
}

function constantTimeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function loadLocalVault(): Record<string, LocalCredentialRecord> {
  try {
    const raw = localStorage.getItem(LOCAL_CRED_STORAGE_KEY);
    if (!raw) return {};
    return safeJsonParse<Record<string, LocalCredentialRecord>>(raw, {});
  } catch {
    return {};
  }
}

function saveLocalVault(vault: Record<string, LocalCredentialRecord>): void {
  try {
    localStorage.setItem(LOCAL_CRED_STORAGE_KEY, JSON.stringify(vault));
  } catch {
    // Ignore storage quota errors
  }
}

export async function registerLocalCredential(params: {
  email: string;
  password: string;
  name: string;
  role: 'attendee' | 'organizer';
}): Promise<{ id: string; email: string; name: string; role: 'attendee' | 'organizer' }> {
  const email = params.email.trim().toLowerCase();
  const vault = loadLocalVault();
  if (vault[email]) {
    throw new Error('An account with this email already exists.');
  }
  const saltHex = generateRandomHex(16);
  const hashHex = await deriveSaltedPasswordHash(params.password, saltHex);
  const id = generateUniqueId('usr');
  const record: LocalCredentialRecord = {
    id,
    email,
    name: sanitizeText(params.name, 100) || email.split('@')[0],
    role: sanitizeSelfSignupRole(params.role),
    saltHex,
    hashHex,
    createdAt: new Date().toISOString(),
  };
  vault[email] = record;
  saveLocalVault(vault);
  return { id: record.id, email: record.email, name: record.name, role: record.role };
}

export async function verifyLocalCredential(
  emailInput: string,
  password: string
): Promise<{ id: string; email: string; name: string; role: 'attendee' | 'organizer' }> {
  const email = emailInput.trim().toLowerCase();
  const vault = loadLocalVault();
  const record = vault[email];
  if (!record) {
    throw new Error('Invalid login credentials.');
  }
  const computedHash = await deriveSaltedPasswordHash(password, record.saltHex);
  if (!constantTimeStringEqual(computedHash, record.hashHex)) {
    throw new Error('Invalid login credentials.');
  }
  return {
    id: record.id,
    email: record.email,
    name: record.name,
    role: sanitizeSelfSignupRole(record.role),
  };
}
