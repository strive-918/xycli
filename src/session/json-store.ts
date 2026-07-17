// ============================================================================
// JSON File Session Store — simple file-based persistence
// ============================================================================

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Session, SessionStore } from "./types.js";

// ---------------------------------------------------------------------------
// Default paths
// ---------------------------------------------------------------------------

const DEFAULT_SESSIONS_DIR = ".xycli/sessions/json";

// ---------------------------------------------------------------------------
// JsonSessionStore
// ---------------------------------------------------------------------------

export class JsonSessionStore implements SessionStore {
  private sessionsDir: string;

  constructor(cwd: string, sessionsDir?: string) {
    this.sessionsDir = path.resolve(cwd, sessionsDir ?? DEFAULT_SESSIONS_DIR);
  }

  // -----------------------------------------------------------------------
  // create
  // -----------------------------------------------------------------------

  async create(session: Session): Promise<void> {
    await this.ensureDir();
    const filePath = this.sessionPath(session.id);

    const data = JSON.stringify(session, null, 2);
    const tmpPath = filePath + ".tmp";

    // Atomic write via temp file + rename
    await fs.writeFile(tmpPath, data, "utf-8");
    await fs.rename(tmpPath, filePath);
  }

  // -----------------------------------------------------------------------
  // update — overwrite existing session
  // -----------------------------------------------------------------------

  async update(session: Session): Promise<void> {
    await this.ensureDir();
    const filePath = this.sessionPath(session.id);

    session.updatedAt = new Date().toISOString();
    const data = JSON.stringify(session, null, 2);
    const tmpPath = filePath + ".tmp";

    await fs.writeFile(tmpPath, data, "utf-8");
    await fs.rename(tmpPath, filePath);
  }

  // -----------------------------------------------------------------------
  // get — load a session by ID
  // -----------------------------------------------------------------------

  async get(sessionId: string): Promise<Session | null> {
    const filePath = this.sessionPath(sessionId);
    try {
      const data = await fs.readFile(filePath, "utf-8");
      return JSON.parse(data) as Session;
    } catch {
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // list — most recent sessions
  // -----------------------------------------------------------------------

  async list(limit = 50): Promise<Session[]> {
    try {
      await this.ensureDir();
      const entries = await fs.readdir(this.sessionsDir);

      const jsonFiles = entries
        .filter((e) => e.endsWith(".json"));

      const sessions: Session[] = [];
      for (const file of jsonFiles) {
        try {
          const data = await fs.readFile(
            path.join(this.sessionsDir, file),
            "utf-8"
          );
          sessions.push(JSON.parse(data) as Session);
        } catch {
          // Skip corrupted files
        }
      }

      // Sort by updatedAt descending (most recent first), then limit
      sessions.sort((a, b) => {
        const aTime = new Date(a.updatedAt).getTime();
        const bTime = new Date(b.updatedAt).getTime();
        return bTime - aTime;
      });

      return sessions.slice(0, limit);
    } catch {
      return [];
    }
  }

  // -----------------------------------------------------------------------
  // helpers
  // -----------------------------------------------------------------------

  private sessionPath(sessionId: string): string {
    return path.join(this.sessionsDir, `${sessionId}.json`);
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.sessionsDir, { recursive: true });
  }
}
