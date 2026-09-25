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

/** A council-wide policy note carried on the council boundary; never a district-wide ban. */
const authorityGeometry = z.object({
  type: z.literal('authority'),
  code: z.string().regex(/^[ENSW]\d{8}$/, 'code must be an ONS local authority code such as E06000059'),
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
  geometry: z.discriminatedUnion('type', [circleGeometry, fileGeometry, authorityGeometry]),
}).refine((e) => e.geometry.type !== 'authority' || e.rule_type === 'policy', { message: 'an authority-wide entry must have rule_type policy', path: ['rule_type'] });

export const byelawFileSchema = z.object({
  version: z.literal(1),
  entries: z.array(byelawEntrySchema),
});

export type ByelawEntry = z.infer<typeof byelawEntrySchema>;
