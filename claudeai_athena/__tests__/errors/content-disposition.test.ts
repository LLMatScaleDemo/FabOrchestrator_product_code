import { test } from "node:test";
import assert from "node:assert/strict";
import { contentDispositionAttachment } from "../../lib/content-disposition";

test("plain ASCII name passes through quoted", () => {
  assert.equal(contentDispositionAttachment("report.pptx"), 'attachment; filename="report.pptx"');
});

test("Tamil filename is accepted by Node Headers and keeps the UTF-8 name", () => {
  const value = contentDispositionAttachment("தமிழ்நாடு அரசு.pptx");
  // This is the exact call that used to throw "Cannot convert argument to a ByteString".
  assert.doesNotThrow(() => new Headers({ "Content-Disposition": value }));
  assert.doesNotThrow(() => new Response("x", { headers: { "Content-Disposition": value } }));
  assert.match(value, /^attachment; filename="download\.pptx"; filename\*=UTF-8''/);
  const encoded = value.split("filename*=UTF-8''")[1];
  assert.equal(decodeURIComponent(encoded), "தமிழ்நாடு அரசு.pptx");
});

test("mixed name keeps ASCII stem in the fallback", () => {
  const value = contentDispositionAttachment("TN-Gov தமிழ் Dashboard.png");
  assert.doesNotThrow(() => new Headers({ "Content-Disposition": value }));
  assert.match(value, /filename="TN-Gov_Dashboard\.png"; filename\*=/);
});

test("quotes and backslashes never break the quoted-string", () => {
  const value = contentDispositionAttachment('a"b\\c.txt');
  assert.doesNotThrow(() => new Headers({ "Content-Disposition": value }));
  assert.match(value, /filename="a_b_c\.txt"/);
});

test("empty / whitespace name falls back to download", () => {
  assert.equal(contentDispositionAttachment(""), 'attachment; filename="download"');
  assert.equal(contentDispositionAttachment("   "), 'attachment; filename="download"');
});
