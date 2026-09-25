# Council byelaw seed list

`seed.yaml` is a hand-curated list of council byelaws, Public Space Protection
Orders (PSPOs) and policies that restrict drone take-off or landing from land a
council or similar body manages. There is no open national dataset for this, so
the list is incomplete and always will be. Absence from the list never means
take-off is permitted.

## Adding an entry

1. Find the byelaw or PSPO text itself (a PDF on the council site, or the
   legislation), not a news article. Put its URL in `source_url`.
2. Describe the rule in one plain sentence in `summary`.
3. Draw the area. Either a circle (`centre: [lon, lat]`, `radius_m`) or a
   GeoJSON file under `geometries/` with one or more Polygons.
4. Set `last_verified` to the date you checked the source.
5. Run `npm run pack:build -- --region south-west --skip-fetch` (or the full
   build) and confirm the entry count in the build log.

```yaml
- id: kebab-case-slug
  authority: Example City Council
  area_name: Example Park
  rule_type: byelaw          # byelaw | pspo | policy
  takeoff_banned: true
  landing_banned: true       # optional, defaults to takeoff_banned
  summary: Byelaw 12 prohibits flying model aircraft and drones in the park.
  source_url: https://example.gov.uk/byelaws/parks.pdf
  last_verified: 2026-09-25
  geometry:
    type: circle
    centre: [-2.5879, 51.4545]
    radius_m: 400
```

### Council-wide policy notes

Many councils publish a drone policy for the land they manage without mapping
it. Record it against the council with an `authority` geometry: the entry then
carries the ONS local authority boundary and appears as a "Local authority"
note in take-off and location reports. It is a note about council-managed
land, never a district-wide ban: it does not change the verdict, and the
loader rejects any `authority` entry whose `rule_type` is not `policy`.
Council codes are the ONS ones (E06000059 is Dorset); the `lad` source must
be in the build for these entries to resolve.

```yaml
- id: dorset-council-drone-policy
  authority: Dorset Council
  area_name: Dorset
  rule_type: policy
  takeoff_banned: true       # meaning: not from council-managed land without consent
  summary: Dorset Council does not permit drone take-off from parks and open spaces it manages without written consent.
  source_url: https://example.gov.uk/drone-policy
  last_verified: 2026-09-25
  geometry:
    type: authority
    code: E06000059
```

Invalid entries are skipped with a warning at build time; they never break the pack.
