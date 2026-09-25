import type { PackAccess, PackState } from '../handlers/deps.js';
import { PackUnavailableError } from '../core/errors.js';
import { D1PackRepository, type D1Like } from '../pack/d1-repository.js';
import type { PackRepository } from '../pack/repository.js';
import type { PackMeta } from '../types.js';

/** PackAccess over a D1 database that the build pipeline keeps loaded. */
export class D1PackAccess implements PackAccess {
  private readonly repo: PackRepository;
  private state: PackState = { state: 'ready', tag: 'd1', path: 'd1' };

  constructor(db: D1Like) {
    this.repo = new D1PackRepository(db);
  }

  require(): PackRepository {
    if (this.state.state !== 'ready') throw new PackUnavailableError(this.state.state === 'unavailable' ? this.state.reason : 'not ready');
    return this.repo;
  }
  current(): PackRepository | undefined {
    return this.repo;
  }
  status(): PackState {
    return this.state;
  }
  async metaOrNull(): Promise<PackMeta | null> {
    try {
      const meta = await this.repo.meta();
      this.state = { state: 'ready', tag: meta.packTag, path: 'd1' };
      return meta;
    } catch (error) {
      this.state = { state: 'unavailable', reason: `D1 pack not loaded: ${(error as Error).message}` };
      return null;
    }
  }
}
