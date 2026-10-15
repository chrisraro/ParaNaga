import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvObjects } from "@/domain/import/csv";
import { parseKml } from "@/domain/import/kml";
import { parseSurveyTemplate } from "@/domain/import/survey-template";

describe("parseCsv (RFC 4180)", () => {
  it("parses plain rows, CRLF and a missing final newline", () => {
    expect(parseCsv("a,b\r\n1,2\r\n3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("handles quotes, escaped quotes, commas and embedded newlines", () => {
    const csv = 'id,note\n1,"say ""hi"", ok"\n2,"line1\nline2"\n3,"a\r\nb"\n';
    expect(parseCsv(csv)).toEqual([
      ["id", "note"],
      ["1", 'say "hi", ok'],
      ["2", "line1\nline2"],
      ["3", "a\r\nb"],
    ]);
  });

  it("keeps empty fields and strips a BOM", () => {
    expect(parseCsv("﻿a,b,c\n,,\n")).toEqual([
      ["a", "b", "c"],
      ["", "", ""],
    ]);
  });

  it("rejects an unterminated quoted field", () => {
    expect(() => parseCsv('a,b\n1,"oops\n')).toThrow(/unterminated/i);
  });

  it("rejects stray quotes inside an unquoted field", () => {
    expect(() => parseCsv('a\nx"y\n')).toThrow(/quote/i);
  });

  it("parseCsvObjects ignores trailing blank lines", () => {
    expect(parseCsvObjects("a,b\n1,2\n\n\n").rows).toEqual([{ a: "1", b: "2" }]);
  });

  it("parseCsvObjects maps rows to headers and rejects ragged rows and duplicate headers", () => {
    expect(parseCsvObjects("a,b\n1,2\n")).toEqual({ header: ["a", "b"], rows: [{ a: "1", b: "2" }] });
    expect(() => parseCsvObjects("a,b\n1\n")).toThrow(/row 2/);
    expect(() => parseCsvObjects("a,a\n1,2\n")).toThrow(/duplicate/i);
  });
});

describe("parseKml", () => {
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Doc &amp; Name</name>
  <Style id="s"><IconStyle><scale>1</scale></IconStyle></Style>
  <Folder><name>Loop Service A</name>
    <Placemark><name>A1</name><description>Plaza &amp; Rizal &#241; &#x41;</description>
      <Point><coordinates>
        123.1846726,13.6233869,0
      </coordinates></Point></Placemark>
    <Placemark><name>A2</name><description><![CDATA[Cor. <Magsaysay> & Bagumbayan]]></description>
      <Point><coordinates>123.5,13.5</coordinates></Point></Placemark>
    <Placemark><name>A3</name><description/><Point><coordinates>123.6,13.6,0</coordinates></Point></Placemark>
  </Folder>
  <Folder><name>Loop Service B</name>
    <Placemark><name>B1</name><description>Line</description>
      <LineString><coordinates>1,2,0 3,4,0</coordinates></LineString></Placemark>
    <Placemark><name>B2</name><description>Pt</description><Point><coordinates>123.7,13.7,0</coordinates></Point></Placemark>
  </Folder>
</Document></kml>`;

  it("extracts folder layer, name, decoded description and verbatim coordinate text", () => {
    const { placemarks, documentName } = parseKml(kml);
    expect(documentName).toBe("Doc & Name");
    expect(placemarks).toHaveLength(4);
    const [a1, a2, a3, b2] = placemarks;
    expect(a1).toMatchObject({
      layer: "Loop Service A",
      name: "A1",
      description: "Plaza & Rizal ñ A",
      coordinatesRaw: "123.1846726,13.6233869,0",
      lng: 123.1846726,
      lat: 13.6233869,
    });
    expect(a2?.description).toBe("Cor. <Magsaysay> & Bagumbayan");
    expect(a2?.coordinatesRaw).toBe("123.5,13.5");
    expect(a3?.description).toBe("");
    expect(a3).toMatchObject({ lng: 123.6, lat: 13.6 });
    expect(b2).toMatchObject({ layer: "Loop Service B", name: "B2" });
  });

  it("reports non-point placemarks as skipped instead of inventing a point", () => {
    const { skipped } = parseKml(kml);
    expect(skipped).toEqual([{ layer: "Loop Service B", name: "B1", reason: "no Point geometry" }]);
  });

  it("throws on a Point with unusable coordinates and on placemarks outside a folder", () => {
    expect(() =>
      parseKml(
        "<kml><Document><Folder><name>L</name><Placemark><name>x</name><Point><coordinates>abc</coordinates></Point></Placemark></Folder></Document></kml>",
      ),
    ).toThrow(/coordinates/i);
    expect(() =>
      parseKml("<kml><Document><Placemark><name>x</name><Point><coordinates>1,2</coordinates></Point></Placemark></Document></kml>"),
    ).toThrow(/folder/i);
  });

  it("throws on malformed XML", () => {
    expect(() => parseKml("<kml><Document><Folder></Document></kml>")).toThrow(/xml/i);
  });
});

describe("parseSurveyTemplate", () => {
  it("returns the header columns in order", () => {
    expect(parseSurveyTemplate("a,b,c\r\n")).toEqual(["a", "b", "c"]);
  });
  it("rejects a template that has data rows or duplicate columns", () => {
    expect(() => parseSurveyTemplate("a,b\n1,2\n")).toThrow(/data row/i);
    expect(() => parseSurveyTemplate("a,a\n")).toThrow(/duplicate/i);
  });
});
