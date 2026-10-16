import { crc32, deflateRawSync } from "node:zlib";

export const docxParts: [string, string | Buffer][] = [
  [
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  ],
  [
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="word/document.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"/></Relationships>',
  ],
  ["word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>'],
];

export function syntheticZip(entries = docxParts, { descriptor = false, flags = 0, method = 8 } = {}): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const filename = Buffer.from(name);
    const body = typeof content === "string" ? Buffer.from(content) : content;
    const packed = method === 0 ? body : deflateRawSync(body);
    const crc = crc32(body);
    const header = Buffer.alloc(30);
    const index = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(flags | (descriptor ? 8 : 0), 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt32LE(descriptor ? 0 : crc, 14);
    header.writeUInt32LE(descriptor ? 0 : packed.length, 18);
    header.writeUInt32LE(descriptor ? 0 : body.length, 22);
    header.writeUInt16LE(filename.length, 26);
    const desc = Buffer.alloc(descriptor ? 16 : 0);
    if (descriptor) {
      desc.writeUInt32LE(0x08074b50, 0);
      desc.writeUInt32LE(crc, 4);
      desc.writeUInt32LE(packed.length, 8);
      desc.writeUInt32LE(body.length, 12);
    }
    index.writeUInt32LE(0x02014b50, 0);
    index.writeUInt16LE(20, 4);
    index.writeUInt16LE(20, 6);
    index.writeUInt16LE(flags | (descriptor ? 8 : 0), 8);
    index.writeUInt16LE(method, 10);
    index.writeUInt32LE(crc, 16);
    index.writeUInt32LE(packed.length, 20);
    index.writeUInt32LE(body.length, 24);
    index.writeUInt16LE(filename.length, 28);
    index.writeUInt32LE(offset, 42);
    locals.push(header, filename, packed, desc);
    central.push(index, filename);
    offset += header.length + filename.length + packed.length + desc.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export function syntheticDocxOfSize(size: number): Buffer {
  const entries: [string, string | Buffer][] = [...docxParts, ["word/media/image.bin", Buffer.alloc(0)]];
  const overhead = syntheticZip(entries, { method: 0 }).length;
  if (size < overhead) throw new Error("DOCX fixture size is smaller than its package metadata");
  entries[entries.length - 1][1] = Buffer.alloc(size - overhead);
  return syntheticZip(entries, { method: 0 });
}
