/*  src/lib/markdown.ts
 *  ------------------------------------------------------------------
 *  Markdown helpers shared across node components.
 *  Currently used by TextInfoNode for rendering markdown content.
 *  ------------------------------------------------------------------ */

const H1 = /^# (.+)$/gm;
const H2 = /^## (.+)$/gm;
const H3 = /^### (.+)$/gm;
const BOLD = /\*\*(.+?)\*\*/g;
const ITALIC = /\*(.+?)\*/g;
const LINK = /\[(.+?)\]\((.+?)\)/g;
const CODE = /`(.+?)`/g;
const CODE_BLOCK = /```(?:([a-zA-Z0-9_-]+)\n)?([\s\S]*?)```/g;
const TABLE = /^(\|[^\n]+\|)\n(\|[-:\s|]+\|)(\n\|[^\n]+\|)*$/gm;
const BLOCK_TOKEN = /@@RAWBIT_MD_BLOCK_(\d+)@@/g;

export function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&#x20;/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x2D;/g, "-")
    .replace(/&#x2F;/g, "/")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function escapeHtml(str: string): string {
  const decoded = decodeHtmlEntities(str);
  return decoded
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const ALLOWED_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function sanitizeLinkUrl(rawUrl: string): string | null {
  const decoded = decodeHtmlEntities(rawUrl);
  const trimmed = decoded.trim();

  if (!trimmed) return null;

  if (
    trimmed.startsWith("#") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../")
  ) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed, "https://rawbit.local");
    if (ALLOWED_LINK_PROTOCOLS.has(parsed.protocol)) {
      return trimmed;
    }
  } catch {
    return null;
  }

  return null;
}

export function parseTable(tableText: string): string {
  const lines = tableText.trim().split("\n");
  if (lines.length < 2) return tableText;

  const separatorLine = lines[1];
  if (!separatorLine.includes("|") || !separatorLine.match(/[-|]+/)) {
    return tableText;
  }

  let html = "<table>";

  const headerCells = lines[0].split("|").filter((cell) => cell.trim());
  html += "<thead><tr>";
  headerCells.forEach((cell) => {
    html += `<th>${cell.trim()}</th>`;
  });
  html += "</tr></thead>";

  if (lines.length > 2) {
    html += "<tbody>";
    for (let i = 2; i < lines.length; i++) {
      const cells = lines[i].split("|").filter((cell) => cell.trim());
      if (cells.length > 0) {
        html += "<tr>";
        cells.forEach((cell) => {
          html += `<td>${cell.trim()}</td>`;
        });
        html += "</tr>";
      }
    }
    html += "</tbody>";
  }

  html += "</table>";
  return html;
}

export function parseBlockquotes(text: string): string {
  const lines = text.split("\n");
  let html = "";
  let i = 0;

  while (i < lines.length) {
    if (/^\s*(?:>|&gt;)\s?/.test(lines[i])) {
      const parts: string[] = [];
      while (i < lines.length && /^\s*(?:>|&gt;)\s?/.test(lines[i])) {
        parts.push(lines[i].replace(/^\s*(?:>|&gt;)\s?/, "").trim());
        i++;
      }
      html += `<blockquote>${parts.join("<br />")}</blockquote>`;
      continue;
    }

    html += lines[i] + "\n";
    i++;
  }

  return html;
}

type ListType = "ul" | "ol";

function parseListLine(
  line: string
): { indent: number; type: ListType; content: string } | null {
  const match = /^(\s*)([-*]|\d+\.)\s+(.+)$/.exec(line);
  if (!match) return null;

  return {
    indent: match[1].length,
    type: /^\d+\./.test(match[2]) ? "ol" : "ul",
    content: match[3].trim(),
  };
}

function parseListBlock(
  lines: string[],
  start: number,
  baseIndent: number,
  type: ListType
): { html: string; next: number } {
  let html = `<${type}>`;
  let i = start;
  let itemOpen = false;

  while (i < lines.length) {
    const item = parseListLine(lines[i]);
    if (!item || item.indent < baseIndent) break;

    if (item.indent > baseIndent) {
      if (!itemOpen) break;
      const nested = parseListBlock(lines, i, item.indent, item.type);
      html += nested.html;
      i = nested.next;
      continue;
    }

    if (item.type !== type) break;

    if (itemOpen) html += "</li>";
    html += `<li>${item.content}`;
    itemOpen = true;
    i++;
  }

  if (itemOpen) html += "</li>";
  html += `</${type}>`;

  return { html, next: i };
}

export function parseLists(text: string): string {
  const lines = text.split("\n");
  let html = "";
  let i = 0;

  while (i < lines.length) {
    const item = parseListLine(lines[i]);

    if (item) {
      const parsed = parseListBlock(lines, i, item.indent, item.type);
      html += parsed.html;
      i = parsed.next;
      continue;
    }

    html += lines[i] + "\n";
    i++;
  }
  return html;
}

export function wrapParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      if (/^<\s*(h1|h2|h3|ul|ol|pre|table|blockquote)\b/i.test(block)) {
        return block;
      }
      if (/^@@RAWBIT_MD_BLOCK_\d+@@$/.test(block)) {
        return block;
      }
      return `<p>${block}</p>`;
    })
    .join("");
}

export function mdToHtml(src: string): string {
  let result = escapeHtml(src);
  const blocks: string[] = [];
  const stashBlock = (html: string) => {
    const index = blocks.push(html) - 1;
    return `@@RAWBIT_MD_BLOCK_${index}@@`;
  };

  result = result.replace(TABLE, (match) => parseTable(match));

  result = result.replace(CODE_BLOCK, (_, language, content) => {
    const languageAttr = language ? ` data-language="${language}"` : "";
    const normalizedContent = content.replace(/^\n/, "").replace(/\n$/, "");
    return stashBlock(
      `<pre><code${languageAttr}>${normalizedContent}</code></pre>`
    );
  });

  result = result
    .replace(H1, "<h1>$1</h1>")
    .replace(H2, "<h2>$1</h2>")
    .replace(H3, "<h3>$1</h3>");

  result = parseBlockquotes(result);
  result = parseLists(result);

  result = result
    .replace(BOLD, "<strong>$1</strong>")
    .replace(ITALIC, "<em>$1</em>")
    .replace(LINK, (_, text, url) => {
      const safeUrl = sanitizeLinkUrl(url);
      if (!safeUrl) {
        return `<span class="text-primary underline underline-offset-2">${text}</span>`;
      }
      return `<a href="${escapeHtml(safeUrl)}" class="text-primary underline underline-offset-2 hover:opacity-90" target="_blank" rel="noopener noreferrer">${text}</a>`;
    })
    .replace(CODE, (_, content) => {
      return `<code>${content}</code>`;
    });

  result = wrapParagraphs(result);
  result = result.replace(BLOCK_TOKEN, (_, index) => blocks[Number(index)] ?? "");

  return result;
}
