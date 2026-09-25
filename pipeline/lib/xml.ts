import { XMLParser } from 'fast-xml-parser';

/**
 * Ordered XML tree (fast-xml-parser preserveOrder). Order matters for GML
 * segments, so the whole document is parsed this way and navigated with the
 * helpers below. Namespace prefixes are removed.
 */
export type XmlNode = Record<string, unknown> & { ':@'?: Record<string, string> };

export function parseOrderedXml(xml: string): XmlNode[] {
  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: '',
    removeNSPrefix: true,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
  });
  return parser.parse(xml) as XmlNode[];
}

export function tagName(node: XmlNode): string | undefined {
  return Object.keys(node).find((k) => k !== ':@');
}

export function children(node: XmlNode): XmlNode[] {
  const name = tagName(node);
  if (!name) return [];
  const value = node[name];
  return Array.isArray(value) ? (value as XmlNode[]) : [];
}

export function attr(node: XmlNode, name: string): string | undefined {
  return node[':@']?.[name];
}

export function textOf(node: XmlNode | undefined): string | undefined {
  if (!node) return undefined;
  const parts: string[] = [];
  for (const c of children(node)) {
    if ('#text' in c) parts.push(String(c['#text']));
  }
  const t = parts.join('').trim();
  return t === '' ? undefined : t;
}

export function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  if (!node) return undefined;
  return children(node).find((c) => tagName(c) === name);
}

export function childrenNamed(node: XmlNode | undefined, name: string): XmlNode[] {
  if (!node) return [];
  return children(node).filter((c) => tagName(c) === name);
}

/** Depth-first search for the first descendant with this tag name. */
export function findFirst(node: XmlNode | undefined, name: string): XmlNode | undefined {
  if (!node) return undefined;
  for (const c of children(node)) {
    if (tagName(c) === name) return c;
    const deeper = findFirst(c, name);
    if (deeper) return deeper;
  }
  return undefined;
}

export function findAll(node: XmlNode | undefined, name: string, out: XmlNode[] = []): XmlNode[] {
  if (!node) return out;
  for (const c of children(node)) {
    if (tagName(c) === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}

export function pathText(node: XmlNode | undefined, ...names: string[]): string | undefined {
  let cur = node;
  for (const n of names) {
    cur = child(cur, n);
    if (!cur) return undefined;
  }
  return textOf(cur);
}
