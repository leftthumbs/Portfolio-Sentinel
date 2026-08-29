import { Client } from '@microsoft/microsoft-graph-client';

/**
 * Microsoft Graph credentials.
 *
 * App-only access via the client credentials flow: the app registration is
 * granted the Files.Read.All *application* permission with admin consent, and
 * authenticates as itself rather than as a signed-in person.
 *
 * The consequence is easy to miss and breaks everything if it is: under
 * application permissions there is no signed-in user, so /me does not resolve
 * and every request returns 400. The drive has to be addressed explicitly,
 * which is why ONEDRIVE_USER exists — the UPN or object id of the account whose
 * OneDrive holds the documents.
 *
 * Setup: register an application in Microsoft Entra ID, add the Files.Read.All
 * application permission, grant admin consent, create a client secret, then set
 * AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET and ONEDRIVE_USER.
 */
interface CachedToken {
  token: string;
  expiresAt: number;
}
let cachedToken: CachedToken | null = null;

/** Refresh a minute early rather than racing the expiry. */
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

export function requireGraphConfig(): {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  user: string;
} {
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  const user = process.env.ONEDRIVE_USER;

  const missing = [
    !tenantId && "AZURE_TENANT_ID",
    !clientId && "AZURE_CLIENT_ID",
    !clientSecret && "AZURE_CLIENT_SECRET",
    !user && "ONEDRIVE_USER",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(
      `OneDrive is not configured. Missing ${missing.join(", ")}. Register an application in Microsoft Entra ID with the Files.Read.All application permission and admin consent, then set these variables. ONEDRIVE_USER is the UPN or object id of the account whose OneDrive holds the documents.`,
    );
  }

  return { tenantId: tenantId!, clientId: clientId!, clientSecret: clientSecret!, user: user! };
}

/** The drive path for the configured account. There is no /me under app-only auth. */
export function driveRoot(user: string): string {
  return `/users/${encodeURIComponent(user)}/drive`;
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const { tenantId, clientId, clientSecret } = requireGraphConfig();

  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        // .default asks for whatever application permissions were consented,
        // rather than naming scopes the app may not have been granted.
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `OneDrive authentication failed (${response.status}). Check AZURE_CLIENT_ID and AZURE_CLIENT_SECRET, and that admin consent has been granted for Files.Read.All. ${detail.slice(0, 300)}`,
    );
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error("OneDrive authentication returned no access token.");
  }

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - TOKEN_EXPIRY_MARGIN_MS,
  };
  return cachedToken.token;
}

export async function getOneDriveClient() {
  const accessToken = await getAccessToken();
  return Client.init({ authProvider: (done) => done(null, accessToken) });
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
  
  const root = driveRoot(requireGraphConfig().user);
  let endpoint = `${root}/root/children`;
  if (folderPath && folderPath !== '/root' && folderPath !== '/') {
    endpoint = `${root}/root:${folderPath}:/children`;
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
  
  const response = await client.api(`${driveRoot(requireGraphConfig().user)}/items/${fileId}/content`)
    .responseType('arraybuffer' as any)
    .get();
  
  return Buffer.from(response);
}

export async function searchOneDriveFiles(query: string): Promise<OneDriveFile[]> {
  const client = await getOneDriveClient();
  
  const response = await client.api(`${driveRoot(requireGraphConfig().user)}/root/search(q='${query}')`)
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
