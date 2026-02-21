import { Octokit } from '@octokit/rest';
import * as fs from 'fs';
import * as path from 'path';

// GitHub integration - connection:conn_github_01KGWT6NQG0W2Z4JY39MD27CTB
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

  console.log('Pushing code to GitHub...');

  const { execSync } = await import('child_process');
  const trackedFiles = execSync('git ls-files', { cwd: '/home/runner/workspace', encoding: 'utf-8' })
    .trim().split('\n').filter(f => f.length > 0);

  console.log(`Found ${trackedFiles.length} tracked files`);

  const SKIP_PATTERNS = ['.replit', '_pull_branch.ts', '_pull_github.ts', 'push-to-github.ts'];
  const filesToPush = trackedFiles.filter(f => !SKIP_PATTERNS.some(s => f === s));
  console.log(`Pushing ${filesToPush.length} files (skipping internal files)`);

  const treeItems: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string }> = [];

  const BATCH_SIZE = 10;
  for (let i = 0; i < filesToPush.length; i += BATCH_SIZE) {
    const batch = filesToPush.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (filePath) => {
      const fullPath = path.join('/home/runner/workspace', filePath);
      const content = fs.readFileSync(fullPath);
      const base64Content = content.toString('base64');

      const { data: blob } = await octokit.git.createBlob({
        owner, repo,
        content: base64Content,
        encoding: 'base64',
      });

      return {
        path: filePath,
        mode: '100644' as const,
        type: 'blob' as const,
        sha: blob.sha,
      };
    });
    const results = await Promise.all(promises);
    treeItems.push(...results);
    console.log(`  Uploaded ${Math.min(i + BATCH_SIZE, filesToPush.length)}/${filesToPush.length} files...`);
  }

  let baseCommitSha: string | undefined;
  let baseTreeSha: string | undefined;
  try {
    const { data: ref } = await octokit.git.getRef({ owner, repo, ref: 'heads/main' });
    baseCommitSha = ref.object.sha;
    const { data: commit } = await octokit.git.getCommit({ owner, repo, commit_sha: baseCommitSha });
    baseTreeSha = commit.tree.sha;
    console.log(`Existing main branch found at ${baseCommitSha.substring(0, 7)}`);
  } catch {
    console.log('No existing main branch, creating fresh');
  }

  const treeParams: any = { owner, repo, tree: treeItems };
  if (baseTreeSha) treeParams.base_tree = baseTreeSha;

  const { data: tree } = await octokit.git.createTree(treeParams);
  console.log(`Created tree: ${tree.sha.substring(0, 7)}`);

  const commitParams: any = {
    owner, repo,
    message: 'Sync from Replit: performance metrics fixes and latest changes',
    tree: tree.sha,
  };
  if (baseCommitSha) commitParams.parents = [baseCommitSha];

  const { data: commit } = await octokit.git.createCommit(commitParams);
  console.log(`Created commit: ${commit.sha.substring(0, 7)}`);

  try {
    await octokit.git.updateRef({
      owner, repo,
      ref: 'heads/main',
      sha: commit.sha,
      force: true,
    });
    console.log('Updated main branch');
  } catch {
    await octokit.git.createRef({
      owner, repo,
      ref: 'refs/heads/main',
      sha: commit.sha,
    });
    console.log('Created main branch');
  }

  console.log(`\nDone! Code pushed to https://github.com/${owner}/${repo}`);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
