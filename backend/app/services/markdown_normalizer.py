import mdformat

class MarkdownNormalizer:
    @staticmethod
    def normalize(markdown: str) -> str:
        """
        Normalize a Markdown string. Returns the original string if formatting fails.

        Requires:
            pip install mdformat mdformat-gfm mdformat-tables mdformat-frontmatter
        """
        try:
            return mdformat.text(
                markdown,
                extensions={
                    "gfm",
                    "tables",
                    "frontmatter",
                },
            )
        except Exception:
            return markdown
