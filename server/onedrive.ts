import { Client } from '@microsoft/microsoft-graph-client';

let connectionSettings: any;

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

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=onedrive',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('OneDrive not connected');
  }
  return accessToken;
}

export async function getOneDriveClient() {
  const accessToken = await getAccessToken();

  return Client.init({
    authProvider: (done) => {
      done(null, accessToken);
    }
  });
}

export interface OneDriveFile {
  id: string;
  name: string;
  size: number;
  webUrl: string;
  lastModifiedDateTime: string;
  mimeType?: string;
  downloadUrl?: string;
}

export async function listOneDriveFiles(folderPath: string = '/root'): Promise<OneDriveFile[]> {
  const client = await getOneDriveClient();
  
  let endpoint = '/me/drive/root/children';
  if (folderPath && folderPath !== '/root' && folderPath !== '/') {
    endpoint = `/me/drive/root:${folderPath}:/children`;
  }
  
  const response = await client.api(endpoint)
    .select('id,name,size,webUrl,lastModifiedDateTime,file,@microsoft.graph.downloadUrl')
    .get();
  
  return response.value.map((item: any) => ({
    id: item.id,
    name: item.name,
    size: item.size || 0,
    webUrl: item.webUrl,
    lastModifiedDateTime: item.lastModifiedDateTime,
    mimeType: item.file?.mimeType,
    downloadUrl: item['@microsoft.graph.downloadUrl'],
  }));
}

export async function getOneDriveFileContent(fileId: string): Promise<Buffer> {
  const client = await getOneDriveClient();
  
  const response = await client.api(`/me/drive/items/${fileId}/content`)
    .responseType('arraybuffer' as any)
    .get();
  
  return Buffer.from(response);
}

export async function searchOneDriveFiles(query: string): Promise<OneDriveFile[]> {
  const client = await getOneDriveClient();
  
  const response = await client.api(`/me/drive/root/search(q='${query}')`)
    .select('id,name,size,webUrl,lastModifiedDateTime,file,@microsoft.graph.downloadUrl')
    .get();
  
  return response.value.map((item: any) => ({
    id: item.id,
    name: item.name,
    size: item.size || 0,
    webUrl: item.webUrl,
    lastModifiedDateTime: item.lastModifiedDateTime,
    mimeType: item.file?.mimeType,
    downloadUrl: item['@microsoft.graph.downloadUrl'],
  }));
}
