import { BadRequestException } from "@nestjs/common";
import { XMLValidator } from "fast-xml-parser";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { docxParts, syntheticDocxOfSize, syntheticZip } from "../../../../test/fixtures/student-documents/docx";
import { STUDENT_DOCUMENT_DOCX_MIME, STUDENT_DOCUMENT_MAX_BYTES, validateStudentDocumentFile } from "./student-document-file";
import { DOCX_MAX_XML_BYTES, DOCX_MAX_XML_ELEMENTS, DOCX_MAX_XML_PART_BYTES, parseDocxXml } from "./student-document-docx-xml";

const validate = (buffer: Buffer, mimetype = STUDENT_DOCUMENT_DOCX_MIME) => validateStudentDocumentFile({ buffer, size: buffer.length, mimetype });

describe("DOCX upload validation", () => {
  it.each(["fixture", "deflated", "stored", "descriptor"])("accepts %s Word packages without changing bytes", kind => {
    const buffer =
      kind === "fixture"
        ? readFileSync(resolve(__dirname, "../../../../test/fixtures/student-documents/synthetic-legacy.docx"))
        : syntheticZip(docxParts, { method: kind === "stored" ? 0 : 8, descriptor: kind === "descriptor" });
    const before = Buffer.from(buffer);
    expect(validate(buffer).contentType).toBe(STUDENT_DOCUMENT_DOCX_MIME);
    expect(buffer).toEqual(before);
  });

  it.each(["magic only", "ordinary ZIP", "corrupt", "truncated", "encrypted", "wrong MIME"])("rejects %s", kind => {
    let buffer = syntheticZip();
    if (kind === "magic only") buffer = Buffer.from([80, 75, 3, 4]);
    if (kind === "ordinary ZIP") buffer = syntheticZip([["file.txt", "not a document"]]);
    if (kind === "corrupt") buffer[45] ^= 1;
    if (kind === "truncated") buffer = buffer.subarray(0, buffer.length - 8);
    if (kind === "encrypted") buffer = syntheticZip(docxParts, { flags: 1 });
    expect(() => validate(buffer, kind === "wrong MIME" ? "application/pdf" : STUDENT_DOCUMENT_DOCX_MIME)).toThrow(BadRequestException);
  });

  it.each([
    ["../secret.txt", "data"],
    ["Word/document.xml", "alias"],
    ["word/vbaProject.bin", "macro"],
    ["word/activeX/x.xml", "active content"],
    ["word/extra.xml", '<!DOCTYPE x [<!ENTITY x SYSTEM "private-path">]><x/>'],
  ])("rejects unsafe entry %s", (name, value) => {
    expect(() => validate(syntheticZip([...docxParts, [name, value]]))).toThrow(BadRequestException);
  });

  it("rejects macro-enabled document content types", () => {
    const entries = docxParts.map(([name, value]): [string, string | Buffer] => [
      name,
      name === "[Content_Types].xml" ? String(value).replace("document.main+xml", "macroEnabled.main+xml") : value,
    ]);
    expect(() => validate(syntheticZip(entries))).toThrow(BadRequestException);
  });

  it.each(["mismatched tags", "fake root", "comment body", "wrong namespace", "split content type", "split relationship", "external main", "missing Word part"])(
    "rejects structurally invalid OOXML: %s",
    kind => {
      let entries = docxParts.map(([name, value]): [string, string | Buffer] => {
        let xml = String(value);
        if (name === "word/document.xml") {
          if (kind === "mismatched tags") xml = xml.replace("</w:body>", "</w:wrong>");
          if (kind === "fake root") xml = `<fake><!--${xml}--></fake>`;
          if (kind === "comment body") xml = xml.replace("<w:body><w:p/></w:body>", "<!--<w:body><w:p/></w:body>-->");
          if (kind === "wrong namespace") xml = xml.replace("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "urn:not-word");
        }
        if (name === "[Content_Types].xml" && kind === "split content type")
          xml = xml
            .replace('PartName="/word/document.xml"', 'PartName="/unrelated.xml"')
            .replace("</Types>", '<Override PartName="/word/document.xml" ContentType="text/plain"/></Types>');
        if (name === "_rels/.rels") {
          if (kind === "split relationship")
            xml = xml
              .replace('Target="word/document.xml"', 'Target="wrong.xml"')
              .replace("</Relationships>", '<Relationship Id="rId2" Target="word/document.xml" Type="urn:unrelated"/></Relationships>');
          if (kind === "external main") xml = xml.replace('Id="rId1"', 'Id="rId1" TargetMode="External"');
        }
        return [name, xml];
      });
      if (kind === "missing Word part") entries = entries.filter(([name]) => name !== "word/document.xml");
      expect(() => validate(syntheticZip(entries))).toThrow(BadRequestException);
    },
  );

  it.each(["utf-16le", "utf-16be"])("accepts well-formed %s XML without altering stored bytes", encoding => {
    const entries = docxParts.map(([name, value]): [string, Buffer] => {
      let encoded = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(String(value), "utf16le")]);
      if (encoding === "utf-16be") encoded = encoded.swap16();
      return [name, encoded];
    });
    const buffer = syntheticZip(entries);
    expect(validate(buffer).buffer.equals(buffer)).toBe(true);
  });

  it.each(["XML part size", "total XML size", "element count", "nesting"])("bounds XML %s", kind => {
    let entries: [string, string | Buffer][] = [...docxParts];
    if (kind === "XML part size") entries.push(["word/oversized.xml", Buffer.alloc(DOCX_MAX_XML_PART_BYTES + 1)]);
    if (kind === "total XML size") {
      const xml = "<x>" + " ".repeat(DOCX_MAX_XML_BYTES / 3) + "</x>";
      entries = [...entries, ["word/a.xml", xml], ["word/b.xml", xml], ["word/c.xml", xml]];
    }
    if (kind === "element count") entries.push(["word/many.xml", `<x>${"<p/>".repeat(DOCX_MAX_XML_ELEMENTS)}</x>`]);
    if (kind === "nesting") entries.push(["word/deep.xml", "<x>".repeat(129) + "</x>".repeat(129)]);
    expect(() => validate(syntheticZip(entries))).toThrow(BadRequestException);
  });

  it("rejects a fake DOCX extension on PDF bytes and a fake PDF MIME on DOCX bytes", () => {
    const pdf = readFileSync(resolve(__dirname, "../../../../test/fixtures/student-documents/blank.pdf"));
    expect(() => validate(pdf)).toThrow(BadRequestException);
    expect(() => validate(syntheticZip(), "application/pdf")).toThrow(BadRequestException);
  });

  it("rejects excessive nesting before the syntax validator builds its tag stack", () => {
    const syntax = jest.spyOn(XMLValidator, "validate");
    try {
      expect(() => parseDocxXml(Buffer.from("<x>".repeat(10_000) + "</x>".repeat(10_000)), { bytes: 0, elements: 0 })).toThrow();
      expect(syntax).not.toHaveBeenCalled();
    } finally {
      syntax.mockRestore();
    }
  });

  it.each(["expanded entry", "entry count", "ZIP64", "overlapping entries"])("bounds %s before decompression", kind => {
    const buffer = syntheticZip();
    const directory = buffer.readUInt32LE(buffer.length - 6);
    if (kind === "expanded entry") buffer.writeUInt32LE(STUDENT_DOCUMENT_MAX_BYTES + 1, directory + 24);
    if (kind === "entry count") {
      buffer.writeUInt16LE(2049, buffer.length - 14);
      buffer.writeUInt16LE(2049, buffer.length - 12);
    }
    if (kind === "ZIP64") buffer.writeUInt32LE(0xffffffff, directory + 42);
    if (kind === "overlapping entries") buffer.writeUInt32LE(0, directory + 46 + buffer.readUInt16LE(directory + 28) + 42);
    expect(() => validate(buffer)).toThrow(BadRequestException);
  });

  it("rejects a small compressed archive that expands beyond the per-entry budget", () => {
    const buffer = syntheticZip([...docxParts, ["word/media/oversized.bin", Buffer.alloc(STUDENT_DOCUMENT_MAX_BYTES + 1)]]);
    expect(buffer.length).toBeLessThan(1024 * 1024);
    expect(() => validate(buffer)).toThrow(BadRequestException);
  });

  it("bounds total expanded data even when each compressed entry fits its own budget", () => {
    const block = Buffer.alloc(STUDENT_DOCUMENT_MAX_BYTES);
    const buffer = syntheticZip([...docxParts, ["word/media/a.bin", block], ["word/media/b.bin", block]]);
    expect(buffer.length).toBeLessThan(1024 * 1024);
    expect(() => validate(buffer)).toThrow(BadRequestException);
  });

  it("does not trust forged small expanded sizes when decompressing", () => {
    const buffer = syntheticZip();
    const directory = buffer.readUInt32LE(buffer.length - 6);
    buffer.writeUInt32LE(1, directory + 24);
    buffer.writeUInt32LE(1, 22);
    expect(() => validate(buffer)).toThrow(BadRequestException);
  });

  it("accepts a genuine stored DOCX exactly at 50 MiB and rejects MAX+1", () => {
    const buffer = syntheticDocxOfSize(STUDENT_DOCUMENT_MAX_BYTES);
    expect(buffer.length).toBe(50 * 1024 * 1024);
    expect(validate(buffer).size).toBe(STUDENT_DOCUMENT_MAX_BYTES);
    expect(() => validate(Buffer.concat([buffer, Buffer.from([0])]))).toThrow(BadRequestException);
  });
});
