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
  const branch = 'claude/add-interval-funds-analyzer-FJ1hb';
  const workspace = '/home/runner/workspace';

  console.log(`Fetching branch: ${branch}...`);
  
  // Get the branch ref
  let branchRef;
  try {
    branchRef = await octokit.git.getRef({ owner, repo, ref: `heads/${branch}` });
  } catch (e: any) {
    if (e.status === 404) {
      console.error(`Branch "${branch}" not found. Let me list available branches...`);
      const { data: branches } = await octokit.repos.listBranches({ owner, repo });
      console.log('Available branches:');
      branches.forEach((b: any) => console.log(`  - ${b.name}`));
      process.exit(1);
    }
    throw e;
  }

  const commitSha = branchRef.data.object.sha;
  console.log(`Branch commit: ${commitSha.substring(0, 8)}`);

  // Also get main branch commit to find what's different
  let mainSha = '';
  try {
    const mainRef = await octokit.git.getRef({ owner, repo, ref: 'heads/main' });
    mainSha = mainRef.data.object.sha;
    console.log(`Main commit: ${mainSha.substring(0, 8)}`);
  } catch (e) {}

  // Get the full tree of the branch
  const commit = await octokit.git.getCommit({ owner, repo, commit_sha: commitSha });
  const { data: tree } = await octokit.git.getTree({ owner, repo, tree_sha: commit.data.tree.sha, recursive: 'true' });
  const branchFiles = tree.tree.filter((item: any) => item.type === 'blob');
  console.log(`Found ${branchFiles.length} files in branch.`);

  // If we have main, compare to find changed files
  let changedFiles: Set<string> | null = null;
  if (mainSha && mainSha !== commitSha) {
    try {
      const { data: comparison } = await octokit.repos.compareCommits({
        owner, repo, base: mainSha, head: commitSha
      });
      changedFiles = new Set(comparison.files?.map((f: any) => f.filename) || []);
      console.log(`\n${changedFiles.size} files changed between main and branch:`);
      changedFiles.forEach(f => console.log(`  - ${f}`));
      console.log('');
    } catch (e: any) {
      console.log('Could not compare branches, will sync all files.');
    }
  }

  // Protected files
  const protectedPaths = new Set(['.replit', 'replit.nix', '.replit.nix', '_pull_branch.ts']);
  const protectedDirs = ['node_modules', '.git', '.cache', '.local', '.config', '.upm'];

  let updated = 0;
  let created = 0;
  let unchanged = 0;
  let skipped = 0;

  // Only process changed files if we know them, otherwise process all
  const filesToProcess = changedFiles 
    ? branchFiles.filter((f: any) => changedFiles!.has(f.path))
    : branchFiles;

  console.log(`Processing ${filesToProcess.length} files...`);

  for (const file of filesToProcess) {
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
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fullPath, content);
        if (isNew) {
          created++;
          console.log(`  Created: ${filePath}`);
        } else {
          updated++;
          console.log(`  Updated: ${filePath}`);
        }
      }
    } catch (e: any) {
      console.log(`  Error on ${filePath}: ${e.message?.substring(0, 80)}`);
    }
  }

  // Handle deleted files (files in main but not in branch)
  if (changedFiles) {
    try {
      const { data: comparison } = await octokit.repos.compareCommits({
        owner, repo, base: mainSha, head: commitSha
      });
      const deletedFiles = comparison.files?.filter((f: any) => f.status === 'removed') || [];
      for (const df of deletedFiles) {
        const fullPath = path.join(workspace, df.filename);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
          console.log(`  Deleted: ${df.filename}`);
        }
      }
    } catch (e) {}
  }

  console.log(`\nDone! ${created} created, ${updated} updated, ${unchanged} unchanged, ${skipped} skipped.`);
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
