import { extractDriveFileId } from "../drive";

describe("extractDriveFileId", () => {
  it("extracts the id from a standard file share link", () => {
    expect(
      extractDriveFileId("https://drive.google.com/file/d/1aBcDeFgHiJkLmNoPqRs/view?usp=sharing")
    ).toBe("1aBcDeFgHiJkLmNoPqRs");
  });

  it("extracts the id from an open?id= style link", () => {
    expect(extractDriveFileId("https://drive.google.com/open?id=1aBcDeFgHiJkLmNoPqRs")).toBe(
      "1aBcDeFgHiJkLmNoPqRs"
    );
  });

  it("extracts the id from a Google Docs share link", () => {
    expect(
      extractDriveFileId("https://docs.google.com/document/d/1aBcDeFgHiJkLmNoPqRs/edit")
    ).toBe("1aBcDeFgHiJkLmNoPqRs");
  });

  it("extracts the id from a Google Sheets share link", () => {
    expect(
      extractDriveFileId("https://docs.google.com/spreadsheets/d/1aBcDeFgHiJkLmNoPqRs/edit#gid=0")
    ).toBe("1aBcDeFgHiJkLmNoPqRs");
  });

  it("extracts the id from a Google Slides share link", () => {
    expect(
      extractDriveFileId("https://docs.google.com/presentation/d/1aBcDeFgHiJkLmNoPqRs/edit")
    ).toBe("1aBcDeFgHiJkLmNoPqRs");
  });

  it("returns null for a non-Drive URL", () => {
    expect(extractDriveFileId("https://example.com/some/random/path")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(extractDriveFileId("")).toBeNull();
  });
});
