import { XMLParser, XMLValidator } from "fast-xml-parser";

export const DOCX_MAX_XML_PART_BYTES = 4 * 1024 * 1024;
export const DOCX_MAX_XML_BYTES = 8 * 1024 * 1024;
export const DOCX_MAX_XML_ELEMENTS = 50_000;
const contentTypesNamespace = "http://schemas.openxmlformats.org/package/2006/content-types";
const relationshipsNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
const wordNamespaces = ["http://schemas.openxmlformats.org/wordprocessingml/2006/main", "http://purl.oclc.org/ooxml/wordprocessingml/main"];
const officeRelationships = [
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
  "http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument",
];

interface OrderedXmlNode {
  [name: string]: OrderedXmlNode[] | Record<string, string>;
}
interface XmlElement {
  local: string;
  namespace: string;
  attributes: Record<string, string>;
  namespaces: Record<string, string>;
  children: OrderedXmlNode[];
}
export interface DocxXmlBudget {
  bytes: number;
  elements: number;
}

function elements(nodes: OrderedXmlNode[], inherited: Record<string, string> = {}): XmlElement[] {
  return nodes.flatMap(node => {
    const name = Object.keys(node).find(key => key !== ":@" && !key.startsWith("#"));
    if (!name) return [];
    const attributes = (node[":@"] ?? {}) as Record<string, string>;
    const namespaces = { ...inherited };
    for (const [key, value] of Object.entries(attributes)) {
      if (key === "xmlns") namespaces[""] = value;
      else if (key.startsWith("xmlns:")) namespaces[key.slice(6)] = value;
    }
    const colon = name.indexOf(":");
    return [
      {
        local: colon < 0 ? name : name.slice(colon + 1),
        namespace: namespaces[colon < 0 ? "" : name.slice(0, colon)] ?? "",
        attributes,
        namespaces,
        children: node[name] as OrderedXmlNode[],
      },
    ];
  });
}

/** Bounded XML validation with entities disabled; no network/file resolution or full Word document model. */
export function parseDocxXml(bytes: Buffer, budget: DocxXmlBudget): XmlElement {
  budget.bytes += bytes.length;
  if (bytes.length > DOCX_MAX_XML_PART_BYTES || budget.bytes > DOCX_MAX_XML_BYTES) throw new Error("DOCX XML budget exceeded");
  const signature = bytes.subarray(0, 2).toString("hex");
  const xml = new TextDecoder(signature === "fffe" ? "utf-16le" : signature === "feff" ? "utf-16be" : "utf-8", { fatal: true }).decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("DOCX declarations are not supported");
  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: "",
    ignoreDeclaration: true,
    ignorePiTags: true,
    parseTagValue: false,
    processEntities: false,
    maxNestedTags: 128,
    updateTag: (name, path) => {
      if (++budget.elements > DOCX_MAX_XML_ELEMENTS || String(path).split(".").length > 128) throw new Error("DOCX XML complexity exceeded");
      return name;
    },
  });
  // Bound the parser's depth/element work before the separate syntax validator allocates its tag stack.
  const roots = elements(parser.parse(xml) as OrderedXmlNode[]);
  if (XMLValidator.validate(xml) !== true) throw new Error("Invalid DOCX XML syntax");
  if (roots.length !== 1) throw new Error("DOCX requires one XML root");
  return roots[0];
}

export function validDocxWordParts(parts: Map<string, XmlElement>): boolean {
  const types = parts.get("[Content_Types].xml");
  const relationships = parts.get("_rels/.rels");
  const document = parts.get("word/document.xml");
  if (!types || !relationships || !document) return false;
  if (types.local !== "Types" || types.namespace !== contentTypesNamespace) return false;
  if (relationships.local !== "Relationships" || relationships.namespace !== relationshipsNamespace) return false;
  if (document.local !== "document" || !wordNamespaces.includes(document.namespace)) return false;
  const overrides = elements(types.children, types.namespaces);
  if (overrides.some(part => /macroEnabled/i.test(part.attributes.ContentType ?? ""))) return false;
  const mainTypes = overrides.filter(part => part.local === "Override" && part.namespace === contentTypesNamespace && part.attributes.PartName === "/word/document.xml");
  if (mainTypes.length !== 1 || mainTypes[0].attributes.ContentType !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml") return false;
  const targets = elements(relationships.children, relationships.namespaces).filter(
    part => part.local === "Relationship" && part.namespace === relationshipsNamespace && officeRelationships.includes(part.attributes.Type),
  );
  if (targets.length !== 1) return false;
  const target = targets[0].attributes;
  if (!target.Id || !["word/document.xml", "/word/document.xml"].includes(target.Target) || (target.TargetMode && target.TargetMode !== "Internal")) return false;
  return elements(document.children, document.namespaces).filter(part => part.local === "body" && part.namespace === document.namespace).length === 1;
}
