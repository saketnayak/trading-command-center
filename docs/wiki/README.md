# Wiki source

These pages are the source of the [GitHub wiki](https://github.com/saketnayak/trading-command-center/wiki). They are kept in the repository so that changes go through review like the code. On GitHub, links between them work as they are.

To publish them to the wiki (needs push access to the repository):

```bash
scripts/publish-wiki.sh
```

The script copies every page except this README, rewrites `Page.md` links to wiki links, and pushes. The first time, enable the wiki in the repository settings and save any page in the web UI, because GitHub only creates the wiki repository then.

Start at [Home](Home.md). When a feature changes, update its page here, and its section in [`CLAUDE.md`](../../CLAUDE.md) for developers.
