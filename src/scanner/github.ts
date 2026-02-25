/**
 * GitHub clone support.
 * Detects GitHub URLs, shallow-clones to a tmp directory,
 * and returns a cleanup function to remove it afterwards.
 */

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ResolvedTarget } from "./types.js";

// ── GitHub URL patterns ──

// Matches:
//   https://github.com/owner/repo
//   https://github.com/owner/repo.git
//   git@github.com:owner/repo.git
const GITHUB_HTTPS_RE = /^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/i;
const GITHUB_SSH_RE = /^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/i;

export function isGitHubUrl(target: string): boolean {
  return GITHUB_HTTPS_RE.test(target) || GITHUB_SSH_RE.test(target);
}

/** Normalise a GitHub URL to a clean https clone URL */
function toCloneUrl(target: string): string {
  const httpsMatch = GITHUB_HTTPS_RE.exec(target);
  if (httpsMatch) {
    return `https://github.com/${httpsMatch[1]}.git`;
  }
  const sshMatch = GITHUB_SSH_RE.exec(target);
  if (sshMatch) {
    return `git@github.com:${sshMatch[1]}.git`;
  }
  // Assume it is already a valid clone URL
  return target;
}

// ── Clone options ──

export interface GitHubConfig {
  /** Clone depth for shallow clone. Defaults to 1. */
  depth?: number;
  /** Branch / tag / ref to clone. Defaults to the remote HEAD. */
  branch?: string;
  /** GitHub personal access token for private repos (injected into the HTTPS URL). */
  token?: string;
}

// ── Public API ──

/**
 * Resolve a scan target to a local directory.
 *
 * - If target is already a local path that exists: return it as-is with no cleanup.
 * - If target is a GitHub URL: shallow-clone to a temp dir and return a cleanup fn.
 */
export function resolveTarget(
  target: string,
  githubConfig?: GitHubConfig
): ResolvedTarget {
  // Local path
  if (!isGitHubUrl(target)) {
    if (!existsSync(target)) {
      throw new Error(`Target path does not exist: ${target}`);
    }
    return { projectRoot: target };
  }

  // GitHub URL
  const depth = githubConfig?.depth ?? 1;
  const branch = githubConfig?.branch;
  const token = githubConfig?.token;

  let cloneUrl = toCloneUrl(target);

  // Inject token into HTTPS URL for private repos
  if (token && cloneUrl.startsWith("https://")) {
    cloneUrl = cloneUrl.replace("https://", `https://${token}@`);
  }

  // Create a unique temp directory
  const tmpBase = join(tmpdir(), "btmg-scan-");
  const tmpDir = mkdtempSync(tmpBase);

  // Build git clone command
  const args: string[] = [
    "git",
    "clone",
    `--depth=${depth}`,
    "--single-branch",
  ];

  if (branch) {
    args.push("--branch", branch);
  }

  args.push(cloneUrl, tmpDir);

  try {
    execSync(args.join(" "), {
      stdio: "pipe",
      timeout: 120_000, // 2 minutes max
    });
  } catch (err) {
    // Clean up on failure
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to clone ${target}: ${msg}`);
  }

  const cleanup = () => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  };

  return { projectRoot: tmpDir, cleanup };
}
