import { Seeker } from "../seeker";
import { tokenize } from "../core";
import {
  isComment,
  isStringDelimiter,
  isWhitespace,
  createToken,
  getJSCommentStartType,
  isCommentEnd,
  getUnclosedComment,
} from "../helpers";
import type { Token, Descriptors } from "../types";

type Delimiters = "," | ";" | ":" | "{" | "}" | "[" | "]" | "(" | ")" | "*";

export type CodeToken = Token<Descriptors | Delimiters>;

export function tokenizeImports(
  source: string,
  blockStart = "{",
  blockEnd = "}",
  taggedImportSupport = false
) {
  return findImports(
    tokenize<CodeToken>(source, {
      isDelimiter,
      isStringDelimiter,
      isWhitespace,
      shouldAddToken,
      createToken,
      getCommentStartType: getJSCommentStartType,
      isCommentEnd,
      getUnclosedComment,
    }),
    blockStart,
    blockEnd,
    taggedImportSupport
  );
}

const isDelimiter = (char: string) =>
  char === ";" ||
  char === "(" ||
  char === ")" ||
  char === "," ||
  char === "{" ||
  char === "}" ||
  char === ":" ||
  char === "*" ||
  char === "[" ||
  char === "]";

const shouldAddToken = (type: CodeToken["type"]) =>
  type === "space" || isComment(type) ? false : true;

export interface ImportValue {
  star: boolean;
  defaultName: string | undefined;
  named: Record<string, string> | undefined;
  tagged: Record<string, Record<string, string>> | undefined;
  from: string | undefined;
  errors: string[];
  start: number;
  end: number;
}

const isImportBlockEndError = (token: CodeToken) =>
  token.value === "from" || token.type === ";";

function findImports(
  tokens: CodeToken[],
  blockStart: string,
  blockEnd: string,
  taggedImportSupport = false
) {
  const imports: ImportValue[] = [];
  const s = new Seeker<CodeToken>(tokens);
  let token;
  let t;
  while ((token = s.next())) {
    if (!token.type) {
      break;
    }
    if (token.value === "import") {
      const startTokenIndex = s.index;
      const errors = [];
      let defaultName;
      let star = false;
      let named = undefined;
      let tagged = undefined;
      let from;
      t = s.next();
      if (t.type === "string") {
        from = t.value.slice(1, -1);
      } else {
        if (t.type === "text") {
          if (t.value === "from") {
            s.back();
            errors.push("missing name");
          } else {
            defaultName = t.value;
          }
        } else if (t.type === "*") {
          star = true;
          const as = s.peek();
          if (as.value === "as") {
            s.next();
            t = s.peek();
            if (t.type === "text" && t.value !== "from") {
              s.next();
              defaultName = t.value;
            } else {
              errors.push("missing as name");
            }
          } else {
            errors.push("expected as after *");
          }
        } else if (t.type === ",") {
          errors.push("missing default name");
        }

        if (t.type === blockStart) {
          if (star) {
            errors.push("Invalid named after *");
          }
          s.back();
          const block = s.flatBlock(
            blockStart,
            blockEnd,
            isImportBlockEndError
          );
          if (block) {
            const res = processNamedBlock(block, errors, taggedImportSupport);
            named = res.named;
            tagged = res.tagged;
          } else {
            errors.push("unclosed block");
          }
        } else {
          t = s.peek();
          let hasComma = false;
          if (t.type === ",") {
            hasComma = true;
            s.next();
            t = s.peek();
          }
          if (t.type === blockStart) {
            if (defaultName && !hasComma) {
              errors.push("missing comma after name");
            }
            if (star) {
              errors.push("Invalid named after *");
            }
            const block = s.flatBlock(
              blockStart,
              blockEnd,
              isImportBlockEndError
            );
            if (block) {
              const res = processNamedBlock(block, errors, taggedImportSupport);
              named = res.named;
              tagged = res.tagged;
            } else {
              errors.push("unclosed block");
            }
          } else if (hasComma) {
            errors.push("missing named block");
          }
        }

        t = s.next();
        if (t.value !== "from") {
          s.back();
          errors.push("invalid missing from");
        }
        t = s.next();
        if (t.type === "string") {
          from = t.value.slice(1, -1);
        } else {
          errors.push("invalid missing source");
        }
      }

      if (s.peek().type === ";") {
        s.next();
      }

      imports.push({
        star,
        defaultName,
        named,
        tagged: tagged,
        from,
        errors,
        start: s.tokens[startTokenIndex].start,
        end: s.tokens[s.index].end,
      });
    }
  }
  return imports;
}

function processNamedBlock(
  block: CodeToken[],
  errors: string[],
  taggedImportSupport: boolean
) {
  const named: Record<string, string> = {};
  const tagged: Record<string, Record<string, string>> = {};
  const tokens: CodeToken[] = [];

  for (let i = 0; i < block.length; i++) {
    const token = block[i];
    if (block[i + 1]?.type === "(" && taggedImportSupport) {
      const tagTokens = [];
      const tagName = block[i];
      let hasEnded;
      for (let j = i + 2; j < block.length; j++) {
        i = j;
        if (block[j].type === ")") {
          hasEnded = true;
          break;
        }
        tagTokens.push(block[j]);
      }
      tagged[tagName.value] = processNamedBlock(tagTokens, errors, false).named;
      if (tagName.type !== "text") {
        errors.push(`invalid tag name: ${tagName.value}`);
      }
      if (!hasEnded) {
        errors.push(`unclosed tagged import "${tagName.value}"`);
      }
    } else if (token.type === ",") {
      pushToken();
    } else {
      tokens.push(token);
    }
  }
  if (tokens.length) {
    pushToken();
  }

  return { named, tagged };

  function pushToken() {
    if (tokens.length === 1) {
      const name = tokens[0].value;
      named[name] = name;
    } else if (tokens.length === 3) {
      if (tokens[1].value === "as") {
        named[tokens[0].value] = tokens[2].value;
      }
    }
    tokens.length = 0;
  }
}

// REGEXP for import parsing import\s+(.*?)\s*,?\s*(\{.*?\})?\s*(from)?\s*(['"].*?['"]);?
