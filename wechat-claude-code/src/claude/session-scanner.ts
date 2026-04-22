import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import { logger } from '../logger.js';

export interface SessionInfo {
  sessionId: string;
  shortId: string;
  size: number;
  mtime: Date;
}

const CLAUDE_DIR = join(homedir(), '.claude', 'projects');

/**
 * Convert an absolute path to Claude's project directory hash.
 * /Volumes/PiCData/Claude/test → -Volumes-PiCData-Claude-test
 */
function toProjectDir(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

/**
 * List all Claude Code sessions for a given working directory.
 * Returns sessions sorted by mtime descending (most recent first).
 * Excludes agent sub-sessions (agent-*.jsonl).
 */
export function listSessions(cwd: string): SessionInfo[] {
  const projectDir = toProjectDir(cwd);
  const dir = join(CLAUDE_DIR, projectDir);

  try {
    const entries = readdirSync(dir);
    const sessions: SessionInfo[] = [];

    for (const entry of entries) {
      // Only top-level .jsonl files that are UUID-like (not agent-*)
      if (!entry.endsWith('.jsonl') || entry.startsWith('agent-')) continue;

      const filePath = join(dir, entry);
      try {
        const stat = statSync(filePath);
        const sessionId = basename(entry, '.jsonl');
        sessions.push({
          sessionId,
          shortId: sessionId.slice(0, 8),
          size: stat.size,
          mtime: stat.mtime,
        });
      } catch {
        // Skip unreadable files
      }
    }

    // Sort by mtime descending
    sessions.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    return sessions;
  } catch {
    logger.debug('No Claude project directory found', { dir });
    return [];
  }
}

/**
 * Find the most recent session ID for a cwd, or undefined if none exists.
 */
export function findLatestSessionId(cwd: string): string | undefined {
  const sessions = listSessions(cwd);
  return sessions[0]?.sessionId;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;

  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

/**
 * Format a session list for display in WeChat.
 */
export function formatSessionList(cwd: string, sessions: SessionInfo[], activeSessionId?: string): string {
  if (sessions.length === 0) {
    return `📂 ${cwd}\n\n暂无会话记录\n\n发送消息将自动创建新会话`;
  }

  const lines = [`📂 ${cwd}\n`, `共 ${sessions.length} 个会话:\n`];

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const isActive = s.sessionId === activeSessionId;
    const marker = isActive ? ' *' : '  ';
    const activeTag = isActive ? ' ← 当前' : '';
    lines.push(`[${i + 1}]${marker} ${s.shortId}  ${formatSize(s.size)}  ${formatTime(s.mtime)}${activeTag}`);
  }

  lines.push('\n/session select <n>  切换会话');
  lines.push('/session new        新建会话');

  return lines.join('\n');
}
