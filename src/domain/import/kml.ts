/**
 * Tolerant KML Placemark extractor. Handles CDATA, XML entities, comments, self-closing
 * elements and whitespace inside <coordinates>. The enclosing <Folder> name is the layer.
 */

type XmlNode = { name: string; children: XmlNode[]; text: string };

export type KmlPlacemark = {
  /** Name of the nearest enclosing <Folder> (the My Maps layer), verbatim. */
  layer: string;
  /** <name>, verbatim (for these exports: the stop code). */
  name: string;
  /** <description>, decoded but not trimmed beyond what the XML itself contains. */
  description: string;
  /** Text of the first coordinate tuple, trimmed, verbatim: "lng,lat[,alt]". */
  coordinatesRaw: string;
  lng: number;
  lat: number;
  alt: number | null;
  /** 0-based document order among all placemarks. */
  index: number;
};

export type KmlSkipped = { layer: string; name: string; reason: string };

export type KmlDocument = {
  documentName: string | null;
  placemarks: KmlPlacemark[];
  skipped: KmlSkipped[];
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x")) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(parseInt(body.slice(1), 10));
    return ENTITIES[body] ?? whole;
  });
}

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|([^<]+)/g;

function localName(qname: string): string {
  const k = qname.indexOf(":");
  return k >= 0 ? qname.slice(k + 1) : qname;
}

function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: "#root", children: [], text: "" };
  const stack: XmlNode[] = [root];
  TOKEN.lastIndex = 0;
  let consumed = 0;
  for (const m of xml.matchAll(TOKEN)) {
    if (m.index !== consumed) throw new Error(`KML: malformed XML near offset ${consumed}`);
    consumed = m.index + m[0].length;
    const top = stack[stack.length - 1]!;
    const [, cdata, closing, qname, , selfClosing, text] = m;
    if (cdata !== undefined) {
      top.text += cdata;
    } else if (text !== undefined) {
      top.text += decodeEntities(text);
    } else if (qname !== undefined) {
      const name = localName(qname);
      if (closing) {
        if (stack.length < 2 || top.name !== name) {
          throw new Error(`KML: malformed XML, unexpected </${name}>`);
        }
        stack.pop();
      } else {
        const node: XmlNode = { name, children: [], text: "" };
        top.children.push(node);
        if (!selfClosing) stack.push(node);
      }
    }
  }
  if (consumed !== xml.length) throw new Error(`KML: malformed XML near offset ${consumed}`);
  if (stack.length !== 1) throw new Error("KML: malformed XML, unclosed element");
  return root;
}

const child = (n: XmlNode, name: string): XmlNode | undefined => n.children.find((c) => c.name === name);

function parseCoordinates(raw: string, where: string): { lng: number; lat: number; alt: number | null } {
  const first = raw.trim().split(/\s+/)[0] ?? "";
  const parts = first.split(",");
  const nums = parts.map((p) => (p.trim() === "" ? NaN : Number(p)));
  if (parts.length < 2 || parts.length > 3 || nums.some((x) => !Number.isFinite(x))) {
    throw new Error(`KML: unusable coordinates "${raw.trim()}" for ${where}`);
  }
  const [lng, lat, alt] = nums as [number, number, number | undefined];
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    throw new Error(`KML: coordinates out of range "${raw.trim()}" for ${where}`);
  }
  return { lng, lat, alt: alt ?? null };
}

export function parseKml(xml: string): KmlDocument {
  const root = parseXml(xml);
  const kml = child(root, "kml");
  if (!kml) throw new Error("KML: missing <kml> root (invalid XML for KML)");
  const doc = child(kml, "Document") ?? kml;

  const placemarks: KmlPlacemark[] = [];
  const skipped: KmlSkipped[] = [];
  let index = 0;

  const walk = (node: XmlNode, layer: string | null) => {
    for (const c of node.children) {
      if (c.name === "Folder") {
        const name = child(c, "name")?.text.trim();
        walk(c, name && name.length > 0 ? name : (layer ?? ""));
      } else if (c.name === "Placemark") {
        const name = child(c, "name")?.text.trim() ?? "";
        if (layer === null) throw new Error(`KML: placemark "${name}" is not inside a Folder (layer)`);
        const description = child(c, "description")?.text ?? "";
        const point = child(c, "Point");
        const coordsNode = point ? child(point, "coordinates") : undefined;
        const i = index++;
        if (!point || !coordsNode) {
          skipped.push({ layer, name, reason: "no Point geometry" });
          continue;
        }
        const coordinatesRaw = coordsNode.text.trim();
        const { lng, lat, alt } = parseCoordinates(coordinatesRaw, `${layer}/${name}`);
        placemarks.push({ layer, name, description, coordinatesRaw, lng, lat, alt, index: i });
      } else if (c.name === "Document") {
        walk(c, layer);
      }
    }
  };
  walk(doc, null);

  return { documentName: child(doc, "name")?.text.trim() ?? null, placemarks, skipped };
}
