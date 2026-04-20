import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../logger.js';
import { DATA_DIR } from '../constants.js';

export interface StoredContact {
  originalId: string;
  contextToken?: string;
  updatedAt: number;
}

const CONTACT_FILE = join(DATA_DIR, 'contact.json');

export function saveContact(originalId: string, contextToken?: string): void {
  const data: StoredContact = { originalId, contextToken, updatedAt: Date.now() };
  try {
    writeFileSync(CONTACT_FILE, JSON.stringify(data, null, 2));
    logger.info('contact-store: saved', { originalId });
  } catch (err) {
    logger.warn('contact-store: save failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

export function loadContact(): StoredContact | null {
  try {
    const raw = readFileSync(CONTACT_FILE, 'utf-8');
    const data = JSON.parse(raw) as StoredContact;
    if (data.originalId) return data;
  } catch {
    // File not found or invalid — first run
  }
  return null;
}
