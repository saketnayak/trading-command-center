---
name: upstream-prs
description: >-
  Create PRs from fork branches to upstream. Use when the user says "Create PRs
  for upstream", "open upstream PRs", or wants to contribute fork feature
  branches back to the parent repository.
disable-model-invocation: true
---

# Upstream PRs (fork → parent)

When the user says **"Create PRs for upstream"**, follow these steps in order.

## Hard rules

- Do **not** push, create PRs, or force-push until the user confirms the PR plan (step 5).
- One PR per solution branch — never combine branches into a single PR.
- Target the upstream default branch (usually `main`) unless the user specifies otherwise.
- Use `gh` for all GitHub operations.
- Return every created PR URL at the end.

## 1. Detect fork and upstream remotes

Run in parallel where possible:

```bash
git remote -v
git status
gh repo view --json nameWithOwner,parent,isFork,defaultBranchRef
```

Resolve:

| Role | Source |
|------|--------|
| **Fork** | `origin` remote, or `gh repo view --json nameWithOwner` when `isFork` is true |
| **Upstream** | `upstream` remote if configured; else `gh repo view --json parent` → `parent.owner.login/parent.name` |

If `upstream` remote is missing but parent is known, note it for PR creation (`--repo owner/repo`). Do not add remotes unless the user asks.

For this repository, upstream is typically `saketnayak/trading-command-center` and the fork is `mjanker4247/trading-command-center`.

## 2. Find solution branches on the fork

```bash
git fetch origin
git fetch upstream 2>/dev/null || true   # optional; skip if no upstream remote

UPSTREAM_DEFAULT=main   # or from gh repo view parent.defaultBranchRef

# Remote branches on fork (exclude integration + bot branches)
git branch -r --format='%(refname:short)' origin/ \
  | sed 's|^origin/||' \
  | grep -Ev '^(main|master|dev|HEAD)$' \
  | grep -Ev '^cursor/'
```

For each candidate branch, keep it only if it has commits not in upstream:

```bash
git log --oneline "upstream/${UPSTREAM_DEFAULT}..origin/${branch}" 2>/dev/null \
  || git log --oneline "origin/${UPSTREAM_DEFAULT}..origin/${branch}"
```

Also include **local-only** branches that are ahead of upstream and not yet pushed — push them to `origin` before opening PRs (after plan approval).

**Exclude** a branch when:

- It has zero unique commits vs upstream default
- An open PR already exists: `gh pr list --repo UPSTREAM --head FORK_OWNER:branch --state open`
- The user explicitly excludes it in step 5

## 3. Prepare exactly one PR per branch

For each remaining branch, gather:

```bash
git log --oneline "upstream/${UPSTREAM_DEFAULT}..origin/${branch}"
git diff "upstream/${UPSTREAM_DEFAULT}...origin/${branch}" --stat
```

Draft per branch:

- **Title**: concise, reflects the branch purpose (prefer existing commit theme)
- **Body**: Summary (1–3 bullets) + Test plan checklist
- **Head**: `FORK_OWNER:branch-name`
- **Base**: upstream default branch

## 4. Show the PR plan

Present a table or numbered list before creating anything:

| Branch | Commits | PR title | Already open? |
|--------|---------|----------|---------------|
| `feature/foo` | 4 | … | no |

State fork → upstream mapping explicitly, e.g. `mjanker4247:feature/foo` → `saketnayak/trading-command-center:main`.

## 5. Wait for confirmation

Stop and ask the user to confirm, edit titles, or drop branches.

Do not proceed until they approve (explicit yes, or adjusted plan).

## 6. Create PRs with GitHub CLI

For each approved branch, sequentially:

```bash
# Push local branch if needed
git push -u origin "${branch}"

gh pr create \
  --repo "${UPSTREAM_OWNER}/${UPSTREAM_REPO}" \
  --head "${FORK_OWNER}:${branch}" \
  --base "${UPSTREAM_DEFAULT}" \
  --title "${title}" \
  --body "$(cat <<'EOF'
## Summary
- …

## Test plan
- [ ] …
EOF
)"
```

Capture the PR URL from each `gh pr create` invocation.

## 7. Return all PR links

End with a bullet list of every PR URL created, plus any branches skipped and why.
