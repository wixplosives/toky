import { test } from "../test-kit/testing";
import { stripComments } from "toky/dist/parsers/strips-comments";

describe(`demos/strip-comments`, () => {
  it("a/*comment*/b", () => {
    test("a/*comment*/b", stripComments, "ab");
  });
  it("a//comment\nb", () => {
    test("a//comment\nb", stripComments, "ab");
  });
  it("a/*comment\nb", () => {
    test("a/*comment\nb", stripComments, "a");
  });
  it("a/*comment*/b/*comment*/c", () => {
    test("a/*comment*/b/*comment*/c", stripComments, "abc");
  });
});