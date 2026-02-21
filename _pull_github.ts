import { Octokit } from '@octokit/rest';
import * as fs from 'fs';
import * as path from 'path';

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
  if (!xReplitToken) throw new Error('X_REPLIT_TOKEN not found');

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=github',
    { headers: { 'Accept': 'application/json', 'X_REPLIT_TOKEN': xReplitToken } }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;
  if (!connectionSettings || !accessToken) throw new Error('GitHub not connected');
  return accessToken;
}

async function main() {
  const accessToken = await getAccessToken();
  const octokit = new Octokit({ auth: accessToken });
  const owner = 'leftthumbs';
  const repo = 'Portfolio-Sentinel';
  const workspace = '/home/runner/workspace';

  // List branches to find the latest
  const { data: branches } = await octokit.repos.listBranches({ owner, repo, per_page: 100 });
  console.log(`Available branches (${branches.length}):`);
  branches.forEach((b: any) => console.log(`  - ${b.name} (${b.commit.sha.substring(0, 8)})`));

  // Use main branch
  const branch = 'main';
  const branchRef = await octokit.git.getRef({ owner, repo, ref: `heads/${branch}` });
  const commitSha = branchRef.data.object.sha;
  console.log(`\nPulling from: ${branch} (${commitSha.substring(0, 8)})`);

  // Get the full tree
  const commit = await octokit.git.getCommit({ owner, repo, commit_sha: commitSha });
  const { data: tree } = await octokit.git.getTree({ owner, repo, tree_sha: commit.data.tree.sha, recursive: 'true' });
  const allFiles = tree.tree.filter((item: any) => item.type === 'blob');
  console.log(`Total files in repo: ${allFiles.length}`);

  const protectedPaths = new Set(['.replit', 'replit.nix', '.replit.nix', '_pull_branch.ts', '_pull_github.ts']);
  const protectedDirs = ['node_modules', '.git', '.cache', '.local', '.config', '.upm'];

  let updated = 0, created = 0, unchanged = 0, skipped = 0;

  for (const file of allFiles) {
    const filePath = file.path as string;
    if (protectedPaths.has(filePath)) { skipped++; continue; }
    if (protectedDirs.some((d: string) => filePath.startsWith(d + '/'))) { skipped++; continue; }

    const fullPath = path.join(workspace, filePath);

    try {
      const blob = await octokit.git.getBlob({ owner, repo, file_sha: file.sha as string });
      const content = Buffer.from(blob.data.content, 'base64' as BufferEncoding);

      let needsUpdate = true;
      let isNew = !fs.existsSync(fullPath);
      if (!isNew) {
        const existing = fs.readFileSync(fullPath);
        if (existing.equals(content)) {
          needsUpdate = false;
          unchanged++;
        }
      }

      if (needsUpdate) {
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(fullPath, content);
        if (isNew) { created++; console.log(`  Created: ${filePath}`); }
        else { updated++; console.log(`  Updated: ${filePath}`); }
      }
    } catch (e: any) {
      console.log(`  Error on ${filePath}: ${e.message?.substring(0, 80)}`);
    }
  }

  console.log(`\nDone! ${created} created, ${updated} updated, ${unchanged} unchanged, ${skipped} skipped.`);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
