import { z } from 'zod';

const circleGeometry = z.object({
  type: z.literal('circle'),
  centre: z.tuple([z.number().min(-9).max(2.5), z.number().min(49.5).max(61)]),
  radius_m: z.number().min(50).max(20_000),
});

const fileGeometry = z.object({
  type: z.literal('file'),
  path: z.string().min(1).regex(/^geometries\/[A-Za-z0-9._-]+\.geojson$/),
  merge: z.boolean().default(true),
});

export const byelawEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'id must be a kebab-case slug'),
  authority: z.string().min(2),
  area_name: z.string().min(2),
  rule_type: z.enum(['byelaw', 'pspo', 'policy']),
  takeoff_banned: z.boolean(),
  landing_banned: z.boolean().optional(),
  summary: z.string().min(10).max(500),
  source_url: z.string().url(),
  last_verified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  geometry: z.discriminatedUnion('type', [circleGeometry, fileGeometry]),
});

export const byelawFileSchema = z.object({
  version: z.literal(1),
  entries: z.array(byelawEntrySchema),
});

export type ByelawEntry = z.infer<typeof byelawEntrySchema>;
