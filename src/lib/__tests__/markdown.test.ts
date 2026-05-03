import { describe, expect, it } from "vitest";

import { mdToHtml } from "../markdown";

describe("mdToHtml", () => {
  it("formats headings, emphasis, and lists", () => {
    const html = mdToHtml(`# Title\n\n## Subtitle\n\n- item **bold**\n- item *italic*\n`);

    expect(html).toMatch(/<h1[^>]*>Title<\/h1>/);
    expect(html).toMatch(/<h2[^>]*>Subtitle<\/h2>/);
    expect(html).toMatch(/<ul[^>]*>.*<li[^>]*>item <strong[^>]*>bold<\/strong><\/li>/s);
    expect(html).toMatch(/<li[^>]*>item <em>italic<\/em><\/li>/);
  });

  it("renders tables with headers and rows", () => {
    const table = `| Col 1 | Col 2 |\n| ----- | ----- |\n| A | B |\n| C | D |\n`;
    const html = mdToHtml(table);

    expect(html).toMatch(/<table[^>]*>/);
    expect(html).toMatch(/<th[^>]*>Col 1<\/th>/);
    expect(html).toMatch(/<td[^>]*>B<\/td>/);
  });

  it("converts code blocks and escapes raw html", () => {
    const source = '```\nconsole.log("hi");\n```\n\n<script>alert(1)</script>';
    const html = mdToHtml(source);

    expect(html).toMatch(/<pre[^>]*><code>[\s\S]*console\.log\(&quot;hi&quot;\);/);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("keeps fenced code languages out of the code body", () => {
    const html = mdToHtml("```bash\nbitcoin-cli getblockcount\n```");

    expect(html).toContain('<pre><code data-language="bash">bitcoin-cli');
    expect(html).not.toContain(">bash\nbitcoin-cli");
  });

  it("renders blockquotes and nested lists as standard markdown", () => {
    const html = mdToHtml(
      "> Useful note\n> second line\n\n- parent\n  - child\n- next"
    );

    expect(html).toContain("<blockquote>Useful note<br />second line</blockquote>");
    expect(html).toContain("<ul><li>parent<ul><li>child</li></ul></li><li>next</li></ul>");
  });

  it("sanitizes unsafe links and allows safe/relative ones", () => {
    const html = mdToHtml(
      "[bad](javascript:alert(1)) [safe](https://example.com) [mail](mailto:test@a.com) [rel](/docs) [anchor](#section)"
    );

    expect(html).toContain(
      '<span class="text-primary underline underline-offset-2">bad</span>'
    );
    expect(html).not.toContain("javascript:alert(1)");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('href="mailto:test@a.com"');
    expect(html).toContain('href="/docs"');
    expect(html).toContain('href="#section"');
  });
});
