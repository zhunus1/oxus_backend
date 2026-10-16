import { crc32, inflateRawSync } from "node:zlib";
import { DOCX_MAX_XML_BYTES, DOCX_MAX_XML_PART_BYTES, parseDocxXml, validDocxWordParts } from "./student-document-docx-xml";

function requireCondition(condition: boolean): void {
  if (!condition) throw new Error("Invalid DOCX package");
}

function validateExtraFields(extra: Buffer): void {
  let offset = 0;
  while (offset < extra.length) {
    requireCondition(offset + 4 <= extra.length);
    const id = extra.readUInt16LE(offset);
    const size = extra.readUInt16LE(offset + 2);
    // ZIP64 is unnecessary for the bounded document upload size.
    requireCondition(id !== 1 && offset + 4 + size <= extra.length);
    offset += 4 + size;
  }
}

function safeEntryName(bytes: Buffer): string {
  const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  requireCondition(name.length > 0 && name.length <= 1024 && !name.startsWith("/") && !name.includes("\\") && !name.includes(":"));
  requireCondition(![...name].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127));
  requireCondition(!name.split("/").some(part => part === "." || part === ".."));
  requireCondition(!/(?:^|\/)(?:vbaproject\.bin|activex)(?:\/|$)/i.test(name));
  return name;
}

/** Checks ZIP integrity and essential Word parts without extracting files or resolving XML entities. */
export function isValidStudentDocumentDocx(bytes: Buffer, maxBytes: number): boolean {
  try {
    requireCondition(bytes.length >= 22 && bytes.length <= maxBytes && bytes.readUInt32LE(0) === 0x04034b50);
    let end = -1;
    for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
      if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) {
        end = offset;
        break;
      }
    }
    requireCondition(end >= 0 && bytes.readUInt16LE(end + 4) === 0 && bytes.readUInt16LE(end + 6) === 0);
    const count = bytes.readUInt16LE(end + 10);
    const size = bytes.readUInt32LE(end + 12);
    const start = bytes.readUInt32LE(end + 16);
    requireCondition(count > 0 && count <= 2048 && bytes.readUInt16LE(end + 8) === count && start + size === end);
    let offset = start;
    let totalExpanded = 0;
    const names = new Set<string>();
    const ranges: [number, number][] = [];
    const parts = new Map<string, ReturnType<typeof parseDocxXml>>();
    const xmlBudget = { bytes: 0, elements: 0 };
    for (let entry = 0; entry < count; entry++) {
      requireCondition(offset + 46 <= end && bytes.readUInt32LE(offset) === 0x02014b50);
      const flags = bytes.readUInt16LE(offset + 8);
      const method = bytes.readUInt16LE(offset + 10);
      const crc = bytes.readUInt32LE(offset + 16);
      const compressed = bytes.readUInt32LE(offset + 20);
      const expanded = bytes.readUInt32LE(offset + 24);
      const nameLength = bytes.readUInt16LE(offset + 28);
      const extraLength = bytes.readUInt16LE(offset + 30);
      const commentLength = bytes.readUInt16LE(offset + 32);
      const local = bytes.readUInt32LE(offset + 42);
      const mode = (bytes.readUInt32LE(offset + 38) >>> 16) & 0xf000;
      requireCondition(bytes.readUInt16LE(offset + 6) <= 20 && (flags & ~0x080e) === 0 && [0, 8].includes(method));
      requireCondition(bytes.readUInt16LE(offset + 34) === 0 && [0, 0x8000, 0x4000].includes(mode));
      requireCondition(offset + 46 + nameLength + extraLength + commentLength <= end && expanded <= maxBytes);
      totalExpanded += expanded;
      requireCondition(totalExpanded <= 2 * maxBytes);
      const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
      const name = safeEntryName(nameBytes);
      const xmlPart = /\.(xml|rels)$/i.test(name);
      if (xmlPart) requireCondition(expanded <= DOCX_MAX_XML_PART_BYTES && xmlBudget.bytes + expanded <= DOCX_MAX_XML_BYTES);
      requireCondition(!names.has(name.toLowerCase()));
      names.add(name.toLowerCase());
      validateExtraFields(bytes.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraLength));
      requireCondition(local + 30 <= start && bytes.readUInt32LE(local) === 0x04034b50);
      requireCondition(bytes.readUInt16LE(local + 4) <= 20 && bytes.readUInt16LE(local + 6) === flags && bytes.readUInt16LE(local + 8) === method);
      const localName = bytes.readUInt16LE(local + 26);
      const localExtra = bytes.readUInt16LE(local + 28);
      const payload = local + 30 + localName + localExtra;
      requireCondition(payload + compressed <= start && localName === nameLength && bytes.subarray(local + 30, local + 30 + localName).equals(nameBytes));
      validateExtraFields(bytes.subarray(local + 30 + localName, payload));
      let localEnd = payload + compressed;
      if (flags & 8) {
        requireCondition(localEnd + 12 <= start);
        if (bytes.readUInt32LE(localEnd) === 0x08074b50) localEnd += 4;
        requireCondition(
          localEnd + 12 <= start && bytes.readUInt32LE(localEnd) === crc && bytes.readUInt32LE(localEnd + 4) === compressed && bytes.readUInt32LE(localEnd + 8) === expanded,
        );
        localEnd += 12;
        requireCondition(
          [0, crc].includes(bytes.readUInt32LE(local + 14)) && [0, compressed].includes(bytes.readUInt32LE(local + 18)) && [0, expanded].includes(bytes.readUInt32LE(local + 22)),
        );
      } else requireCondition(bytes.readUInt32LE(local + 14) === crc && bytes.readUInt32LE(local + 18) === compressed && bytes.readUInt32LE(local + 22) === expanded);
      ranges.push([local, localEnd]);
      const packed = bytes.subarray(payload, payload + compressed);
      let body: Buffer;
      if (method === 0) {
        requireCondition(compressed === expanded);
        body = packed;
      } else {
        // Node's typings omit the info:true return shape.
        const inflated = inflateRawSync(packed, { maxOutputLength: Math.max(1, expanded), info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
        requireCondition(inflated.engine.bytesWritten === compressed);
        body = inflated.buffer;
      }
      requireCondition(body.length === expanded && crc32(body) === crc && (!name.endsWith("/") || expanded === 0));
      if (xmlPart) {
        const xml = parseDocxXml(body, xmlBudget);
        if (["[Content_Types].xml", "_rels/.rels", "word/document.xml"].includes(name)) parts.set(name, xml);
      }
      offset += 46 + nameLength + extraLength + commentLength;
    }
    requireCondition(offset === end);
    ranges.sort((a, b) => a[0] - b[0]);
    requireCondition(ranges[0][0] === 0 && ranges[ranges.length - 1][1] === start && ranges.every((range, index) => index === 0 || range[0] === ranges[index - 1][1]));
    return validDocxWordParts(parts);
  } catch {
    return false;
  }
}
