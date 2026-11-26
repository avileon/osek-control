import { Readable } from 'node:stream';
import { clients } from '../lib/google.js';
import { config } from '../config.js';

const FOLDER = 'application/vnd.google-apps.folder';
const cache = new Map();

async function findOrCreateFolder(name, parentId) {
  const k = `${parentId}/${name}`;
  if (cache.has(k)) return cache.get(k);
  const { drive } = clients();
  const q = `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='${FOLDER}' and trashed=false`;
  const { data } = await drive.files.list({ q, fields: 'files(id)', supportsAllDrives: true, includeItemsFromAllDrives: true });
  let id = data.files?.[0]?.id;
  if (!id) {
    const res = await drive.files.create({ requestBody: { name, mimeType: FOLDER, parents: [parentId] }, fields: 'id', supportsAllDrives: true });
    id = res.data.id;
  }
  cache.set(k, id);
  return id;
}

async function parentOf(folderId) {
  const { drive } = clients();
  const { data } = await drive.files.get({ fileId: folderId, fields: 'parents', supportsAllDrives: true });
  return data.parents?.[0] || 'root';
}

// עוסק: <תיקיית העוסק>/YYYY-MM
// חברה: <DRIVE_COMPANY_FOLDER_ID או "ויביט בע״מ - לא לעוסק" ליד תיקיית העוסק>/YYYY-MM
// לבדיקה: <DRIVE_REVIEW_FOLDER_ID או "לבדיקה - עוסק" ליד תיקיית העוסק>/YYYY-MM
// חברה/בדיקה נשמרות מחוץ לתיקיית העוסק בכוונה — אם תשתף אותה עם רו"ח, הוא לא יראה מסמכים של החברה.
export async function monthFolder(entity, month) {
  const osekRoot = config.drive.osekFolderId;
  if (!osekRoot) throw new Error('DRIVE_OSEK_FOLDER_ID חסר');
  let root;
  if (entity === 'osek') root = osekRoot;
  else if (entity === 'company') root = config.drive.companyFolderId || (await findOrCreateFolder('ויביט בע״מ - לא לעוסק', await parentOf(osekRoot)));
  else root = config.drive.reviewFolderId || (await findOrCreateFolder('לבדיקה - עוסק', await parentOf(osekRoot)));
  return findOrCreateFolder(month, root);
}

export async function uploadToDrive({ entity, month, filename, mime, buffer }) {
  const { drive } = clients();
  const parent = await monthFolder(entity, month);
  const res = await drive.files.create({
    requestBody: { name: filename, parents: [parent] },
    media: { mimeType: mime, body: Readable.from(buffer) },
    fields: 'id, webViewLink',
    supportsAllDrives: true,
  });
  return { id: res.data.id, link: res.data.webViewLink };
}

// העברה בין תיקיות כשמשנים סיווג ידנית
export async function moveInDrive(fileId, entity, month) {
  const { drive } = clients();
  const { data } = await drive.files.get({ fileId, fields: 'parents', supportsAllDrives: true });
  const parent = await monthFolder(entity, month);
  await drive.files.update({ fileId, addParents: parent, removeParents: (data.parents || []).join(','), supportsAllDrives: true });
}
