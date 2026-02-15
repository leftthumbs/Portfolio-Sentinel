import { google } from 'googleapis';

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

  if (!hostname) {
    throw new Error('Gmail not configured: REPLIT_CONNECTORS_HOSTNAME environment variable is not set. Enable the Gmail connector in your Replit project settings.');
  }

  if (!xReplitToken) {
    throw new Error('Gmail not configured: authentication token not found. Ensure REPL_IDENTITY or WEB_REPL_RENEWAL environment variables are set.');
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
    throw new Error('Gmail not configured: failed to reach connector service. Check that REPLIT_CONNECTORS_HOSTNAME is correct.');
  }

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings?.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('Gmail not connected: no OAuth access token found. Connect your Gmail account in the Replit Connections panel.');
  }
  return accessToken;
}

async function getUncachableGmailClient() {
  const accessToken = await getAccessToken();

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({
    access_token: accessToken
  });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

export interface GmailMessage {
  id: string;
  threadId: string;
  snippet: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  labelIds: string[];
  isUnread: boolean;
  hasAttachment: boolean;
}

export interface GmailLabel {
  id: string;
  name: string;
  type: string;
  messagesTotal: number;
  messagesUnread: number;
}

function parseHeader(headers: any[], name: string): string {
  const header = headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase());
  return header?.value || '';
}

export async function listMessages(query?: string, maxResults: number = 20): Promise<GmailMessage[]> {
  const gmail = await getUncachableGmailClient();
  
  const response = await gmail.users.messages.list({
    userId: 'me',
    q: query || '',
    maxResults,
  });

  const messages = response.data.messages || [];
  
  const fullMessages = await Promise.all(
    messages.map(async (msg) => {
      const full = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id!,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'To', 'Date'],
      });
      
      const headers = full.data.payload?.headers || [];
      const parts = full.data.payload?.parts || [];
      const hasAttachment = parts.some((part: any) => part.filename && part.filename.length > 0);
      
      return {
        id: full.data.id!,
        threadId: full.data.threadId!,
        snippet: full.data.snippet || '',
        subject: parseHeader(headers, 'Subject'),
        from: parseHeader(headers, 'From'),
        to: parseHeader(headers, 'To'),
        date: parseHeader(headers, 'Date'),
        labelIds: full.data.labelIds || [],
        isUnread: (full.data.labelIds || []).includes('UNREAD'),
        hasAttachment,
      };
    })
  );

  return fullMessages;
}

export async function getMessage(messageId: string): Promise<{ message: GmailMessage; body: string }> {
  const gmail = await getUncachableGmailClient();
  
  const full = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });
  
  const headers = full.data.payload?.headers || [];
  const parts = full.data.payload?.parts || [];
  const hasAttachment = parts.some((part: any) => part.filename && part.filename.length > 0);
  
  let body = '';
  if (full.data.payload?.body?.data) {
    body = Buffer.from(full.data.payload.body.data, 'base64').toString('utf-8');
  } else if (parts.length > 0) {
    const textPart = parts.find((p: any) => p.mimeType === 'text/plain');
    const htmlPart = parts.find((p: any) => p.mimeType === 'text/html');
    const part = textPart || htmlPart;
    if (part?.body?.data) {
      body = Buffer.from(part.body.data, 'base64').toString('utf-8');
    }
  }
  
  return {
    message: {
      id: full.data.id!,
      threadId: full.data.threadId!,
      snippet: full.data.snippet || '',
      subject: parseHeader(headers, 'Subject'),
      from: parseHeader(headers, 'From'),
      to: parseHeader(headers, 'To'),
      date: parseHeader(headers, 'Date'),
      labelIds: full.data.labelIds || [],
      isUnread: (full.data.labelIds || []).includes('UNREAD'),
      hasAttachment,
    },
    body,
  };
}

export async function listLabels(): Promise<GmailLabel[]> {
  const gmail = await getUncachableGmailClient();
  
  const response = await gmail.users.labels.list({
    userId: 'me',
  });

  const labels = response.data.labels || [];
  
  const fullLabels = await Promise.all(
    labels.map(async (label) => {
      const full = await gmail.users.labels.get({
        userId: 'me',
        id: label.id!,
      });
      
      return {
        id: full.data.id!,
        name: full.data.name!,
        type: full.data.type || 'user',
        messagesTotal: full.data.messagesTotal || 0,
        messagesUnread: full.data.messagesUnread || 0,
      };
    })
  );

  return fullLabels;
}

export async function sendEmail(to: string, subject: string, body: string): Promise<string> {
  const gmail = await getUncachableGmailClient();
  
  const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
  const messageParts = [
    `To: ${to}`,
    `Subject: ${utf8Subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    body,
  ];
  const message = messageParts.join('\n');
  
  const encodedMessage = Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodedMessage,
    },
  });

  return response.data.id!;
}

export async function markAsRead(messageId: string): Promise<void> {
  const gmail = await getUncachableGmailClient();
  
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: {
      removeLabelIds: ['UNREAD'],
    },
  });
}

export async function searchMessages(query: string, maxResults: number = 20): Promise<GmailMessage[]> {
  return listMessages(query, maxResults);
}
