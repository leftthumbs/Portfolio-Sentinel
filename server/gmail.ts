import { google, drive_v3 } from 'googleapis';

// Hardcoded folder name restriction - only this folder is accessible
const ALLOWED_FOLDER_NAME = 'Investment Library';

let connectionSettings: any;
// Cache the Investment Library folder ID after first lookup
let investmentLibraryFolderId: string | null = null;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;

  if (!hostname) {
    throw new Error('Google Drive not configured: REPLIT_CONNECTORS_HOSTNAME environment variable is not set.');
  }

  if (!xReplitToken) {
    throw new Error('Google Drive not configured: authentication token not found. Ensure REPL_IDENTITY or WEB_REPL_RENEWAL environment variables are set.');
  }

  try {
    connectionSettings = await fetch(
      'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=google-mail',
      {
        headers: {
          'Accept': 'application/json',
          'X_REPLIT_TOKEN': xReplitToken
        }
      }
    ).then(res => res.json()).then(data => data.items?.[0]);
  } catch (fetchError) {
    throw new Error('Google Drive not configured: failed to reach connector service.');
  }

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings?.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('Google account not connected: no OAuth access token found. Connect your Google account in the Replit Connections panel.');
  }
  return accessToken;
}

async function getDriveClient(): Promise<drive_v3.Drive> {
  const accessToken = await getAccessToken();

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({
    access_token: accessToken
  });

  return google.drive({ version: 'v3', auth: oauth2Client });
}

/**
 * Finds the "Investment Library" folder in Google Drive.
 * Caches the result to avoid repeated lookups.
 * Throws if the folder does not exist.
 */
async function getInvestmentLibraryFolderId(): Promise<string> {
  if (investmentLibraryFolderId) {
    return investmentLibraryFolderId;
  }

  const drive = await getDriveClient();
  const response = await drive.files.list({
    q: `name = '${ALLOWED_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    spaces: 'drive',
  });

  const folders = response.data.files || [];
  if (folders.length === 0) {
    throw new Error(`"${ALLOWED_FOLDER_NAME}" folder not found in Google Drive. Please create it first.`);
  }

  investmentLibraryFolderId = folders[0].id!;
  return investmentLibraryFolderId;
}

/**
 * Security check: verify that a given file/folder ID is the Investment Library
 * folder itself or is a descendant of it. Prevents path traversal attacks.
 */
async function assertFileWithinInvestmentLibrary(drive: drive_v3.Drive, fileId: string): Promise<void> {
  const rootId = await getInvestmentLibraryFolderId();

  if (fileId === rootId) {
    return; // The root folder itself is always allowed
  }

  // Walk up the parent chain to verify ancestry
  let currentId = fileId;
  const visited = new Set<string>();

  while (currentId) {
    if (visited.has(currentId)) {
      throw new Error('Access denied: circular reference detected.');
    }
    visited.add(currentId);

    if (currentId === rootId) {
      return; // Found the Investment Library in the ancestry chain
    }

    const file = await drive.files.get({
      fileId: currentId,
      fields: 'parents',
    });

    const parents = file.data.parents;
    if (!parents || parents.length === 0) {
      break; // Reached the root of Drive without finding Investment Library
    }

    currentId = parents[0];
  }

  throw new Error('Access denied: file is outside the Investment Library folder.');
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  modifiedTime: string;
  webViewLink: string;
  iconLink: string;
  isFolder: boolean;
}

/**
 * Lists files inside a folder within the Investment Library.
 * If no folderId is provided, lists the root Investment Library folder.
 */
export async function listDriveFiles(folderId?: string): Promise<DriveFile[]> {
  const drive = await getDriveClient();
  const targetFolderId = folderId || await getInvestmentLibraryFolderId();

  // Security: ensure the target folder is within Investment Library
  await assertFileWithinInvestmentLibrary(drive, targetFolderId);

  const response = await drive.files.list({
    q: `'${targetFolderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType, size, modifiedTime, webViewLink, iconLink)',
    orderBy: 'folder,name',
    pageSize: 100,
  });

  return (response.data.files || []).map((file) => ({
    id: file.id!,
    name: file.name!,
    mimeType: file.mimeType || '',
    size: parseInt(file.size || '0', 10),
    modifiedTime: file.modifiedTime || '',
    webViewLink: file.webViewLink || '',
    iconLink: file.iconLink || '',
    isFolder: file.mimeType === 'application/vnd.google-apps.folder',
  }));
}

/**
 * Search for files within the Investment Library folder only.
 */
export async function searchDriveFiles(query: string): Promise<DriveFile[]> {
  const drive = await getDriveClient();
  const rootId = await getInvestmentLibraryFolderId();

  // Search scoped to the Investment Library folder tree
  const response = await drive.files.list({
    q: `name contains '${query.replace(/'/g, "\\'")}' and trashed = false`,
    fields: 'files(id, name, mimeType, size, modifiedTime, webViewLink, iconLink, parents)',
    orderBy: 'folder,name',
    pageSize: 50,
  });

  const allFiles = response.data.files || [];

  // Filter results to only include files that are descendants of Investment Library
  const validFiles: DriveFile[] = [];
  for (const file of allFiles) {
    try {
      await assertFileWithinInvestmentLibrary(drive, file.id!);
      validFiles.push({
        id: file.id!,
        name: file.name!,
        mimeType: file.mimeType || '',
        size: parseInt(file.size || '0', 10),
        modifiedTime: file.modifiedTime || '',
        webViewLink: file.webViewLink || '',
        iconLink: file.iconLink || '',
        isFolder: file.mimeType === 'application/vnd.google-apps.folder',
      });
    } catch {
      // File is outside Investment Library — silently skip
    }
  }

  return validFiles;
}

/**
 * Get metadata for a single file, only if it's within the Investment Library.
 */
export async function getDriveFile(fileId: string): Promise<DriveFile> {
  const drive = await getDriveClient();

  // Security: ensure file is within Investment Library
  await assertFileWithinInvestmentLibrary(drive, fileId);

  const file = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType, size, modifiedTime, webViewLink, iconLink',
  });

  return {
    id: file.data.id!,
    name: file.data.name!,
    mimeType: file.data.mimeType || '',
    size: parseInt(file.data.size || '0', 10),
    modifiedTime: file.data.modifiedTime || '',
    webViewLink: file.data.webViewLink || '',
    iconLink: file.data.iconLink || '',
    isFolder: file.data.mimeType === 'application/vnd.google-apps.folder',
  };
}

/**
 * Download file content, only if it's within the Investment Library.
 */
export async function downloadDriveFile(fileId: string): Promise<{ buffer: Buffer; mimeType: string; name: string }> {
  const drive = await getDriveClient();

  // Security: ensure file is within Investment Library
  await assertFileWithinInvestmentLibrary(drive, fileId);

  const meta = await drive.files.get({
    fileId,
    fields: 'name, mimeType',
  });

  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );

  return {
    buffer: Buffer.from(response.data as ArrayBuffer),
    mimeType: meta.data.mimeType || 'application/octet-stream',
    name: meta.data.name || 'download',
  };
}
