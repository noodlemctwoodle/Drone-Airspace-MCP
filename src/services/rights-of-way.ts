import type { PackRepository } from '../pack/repository.js';
import type { ProwCoverage, RightOfWayHit } from '../types.js';

export class RightsOfWayService {
  constructor(private readonly pack: PackRepository) {}

  nearest(lon: number, lat: number, limitMetres: number, n: number): Promise<RightOfWayHit[]> {
    return this.pack.nearestRightsOfWay(lon, lat, limitMetres, n);
  }

  coverageAt(lon: number, lat: number): Promise<ProwCoverage> {
    return this.pack.prowCoverageAt(lon, lat);
  }
}
