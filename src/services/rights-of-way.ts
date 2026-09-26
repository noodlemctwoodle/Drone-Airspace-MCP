import type { PackRepository } from '../pack/repository.js';
import type { ProwCoverage, RightOfWayHit } from '../types.js';

export class RightsOfWayService {
  constructor(private readonly pack: PackRepository) {}

  nearest(lon: number, lat: number, limitMetres: number, n: number): Promise<RightOfWayHit[]> {
    return this.pack.nearestRightsOfWay(lon, lat, limitMetres, n);
  }

  /** True when the pack carries Scottish core paths, so Scotland is not a data gap. */
  async hasCorePaths(): Promise<boolean> {
    const meta = await this.pack.meta();
    return meta.sources.some((s) => s.id === 'is_core_paths' && s.featureCount > 0);
  }

  /** True when the pack carries asserted rights of way from any Northern Ireland council. */
  async hasNorthernIrelandPaths(): Promise<boolean> {
    const meta = await this.pack.meta();
    return meta.sources.some((s) => s.id === 'ni_prow' && s.featureCount > 0);
  }

  coverageAt(lon: number, lat: number): Promise<ProwCoverage> {
    return this.pack.prowCoverageAt(lon, lat);
  }
}
