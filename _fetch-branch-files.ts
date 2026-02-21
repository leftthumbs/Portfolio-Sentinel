import { Octokit } from '@octokit/rest';
import * as fs from 'fs';
import * as path from 'path';

let connectionSettings: any;
async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) return connectionSettings.settings.access_token;
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY ? 'repl ' + process.env.REPL_IDENTITY : process.env.WEB_REPL_RENEWAL ? 'depl ' + process.env.WEB_REPL_RENEWAL : null;
  if (!xReplitToken) throw new Error('X_REPLIT_TOKEN not found');
  connectionSettings = await fetch('https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=github', { headers: { 'Accept': 'application/json', 'X_REPLIT_TOKEN': xReplitToken } }).then(res => res.json()).then(data => data.items?.[0]);
  const accessToken = connectionSettings?.settings?.access_token || connectionSettings?.settings?.oauth?.credentials?.access_token;
  if (!connectionSettings || !accessToken) throw new Error('GitHub not connected');
  return accessToken;
}

async function main() {
  const accessToken = await getAccessToken();
  const octokit = new Octokit({ auth: accessToken });
  const owner = 'leftthumbs';
  const repo = 'Portfolio-Sentinel';
  const branch = 'claude/improve-benchmark-calculations-Bilr6';

  const filesToFetch = [
    'server/benchmarkCalculations.ts',
    'client/src/hooks/use-all-benchmarks.ts',
    'client/src/pages/gmail.tsx',
    'client/src/pages/performance.tsx',
    'client/src/pages/risk.tsx',
    'client/src/components/app-sidebar.tsx',
    'client/src/App.tsx',
    'server/routes.ts',
    'server/gmail.ts',
  ];

  const outDir = '/tmp/branch-files';
  fs.mkdirSync(outDir, { recursive: true });

  for (const filePath of filesToFetch) {
    try {
      const { data } = await octokit.repos.getContent({ owner, repo, path: filePath, ref: branch });
      if ('content' in data) {
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        const outPath = path.join(outDir, filePath.replace(/\//g, '__'));
        fs.writeFileSync(outPath, content);
        console.log(`Fetched: ${filePath} (${content.length} chars)`);
      }
    } catch (e: any) {
      console.error(`Failed: ${filePath} - ${e.message}`);
    }
  }
  console.log('\nDone! Files saved to', outDir);
}
main().catch(e => { console.error('Error:', e.message); process.exit(1); });
