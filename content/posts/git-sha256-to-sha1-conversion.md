---
title: "Git push refused and the commits are stuck? Convert a SHA-256 repository to SHA-1 with full history"
date: 2026-11-09T17:20:00+07:00
draft: false
params:
  author: 'widnyana'
description: "\"fatal: the receiving end does not support this repository's hash algorithm\" means the repository stores SHA-256 objects and the host speaks SHA-1. How to convert a SHA-256 repo to SHA-1 with fast-export and fast-import, prove no commit changed, and push it without losing history."
showToc: true
tags:
  - git
  - sha256
  - sha1
  - version-control
  - migration
categories:
  - DevOps
keywords:
  - the receiving end does not support this repository's hash algorithm
  - git sha256 to sha1
  - convert git repository to sha1
  - git object format sha256
  - git fast-export fast-import migration
  - push sha256 repo to github
  - force-with-lease after history rewrite
  - git stash reflog after import
cover:
  image: /images/git-sha256-to-sha1-cover.png
  alt: "Dark navy cover reading 'Git push refused.' above the error 'the receiving end does not support this repository's hash algorithm'."
---

I ran `git push origin main` on a repository with 151 commits and no other copy anywhere, and got this:

```text
fatal: the receiving end does not support this repository's hash algorithm
```

Nothing was wrong with the network or the credentials. The repository stored its objects with SHA-256 ids, and the remote only understood SHA-1. Every commit existed locally and none of them could leave the machine.

## Check the object format: 64-character ids mean SHA-256

```bash
git rev-parse --show-object-format
```

```text
sha256
```

The setting lives in `.git/config` and is written at `git init` time:

```text
[extensions]
	objectformat = sha256
```

With that extension, every object id is 64 hex characters instead of 40. You cannot switch the format on an existing repository: the ids are stored inside every commit, tree and tag, so changing the algorithm means rewriting every object.

## Two outcomes: keep the ids, or rewrite every one

If your host accepts SHA-256 repositories, keep the repository as it is and push. That is cheaper and shorter.

If it does not, the only option is to rebuild the repository in SHA-1 format from the same commits. The ids change. The content, authors, dates and messages do not.

GitHub refused the push in my test, on git 2.56.0 in November 2026. I did not check other hosts.

## The conversion, into a second repository

`git fast-export` turns history into a text stream and `git fast-import` reads that stream back. The two commands do not care which hash algorithm each repository uses, so a SHA-256 source and a SHA-1 destination work together.

```bash
git init --object-format=sha1 ~/code/project-sha1
git -C ~/code/project fast-export --all --signed-tags=strip > /tmp/project.fi
git -C ~/code/project-sha1 fast-import --quiet < /tmp/project.fi
git -C ~/code/project-sha1 symbolic-ref HEAD refs/heads/main
git -C ~/code/project-sha1 checkout -f main
```

The `symbolic-ref` line is not optional. `fast-import` writes the branches but leaves `HEAD` on the default unborn branch, so the new repository shows nothing to check out until you point `HEAD` at a real branch.

`--signed-tags=strip` keeps the import from stopping on a signed tag it cannot reproduce. My repository had no tags, so I did not see that path run.

`git fast-import --force` is safe to re-run over a repository that already holds the result. The input is the same stream, so the commits come back with the same ids. I used that once: one more commit landed in the SHA-256 repository after the first import, I exported again and imported with `--force`, and only that commit was added. That is why the failed push happened at 151 commits and the final export held 152.

The output stream carries commits, trees, blobs, branches, tags and the stash ref. In this repository that came to 1,727 objects reachable from `main`.

## Prove nothing was lost

Start with the cheap comparison: same commit subjects in the same order.

```bash
diff <(git -C ~/code/project log --format='%s' main) \
     <(git -C ~/code/project-sha1 log --format='%s' main)
```

Then compare the file list and file modes in every commit:

```bash
diff <(git -C ~/code/project log --format=%H main | while read -r c; do
         git -C ~/code/project ls-tree -r "$c" | awk '{print $1, $4}'
       done) \
     <(git -C ~/code/project-sha1 log --format=%H main | while read -r c; do
         git -C ~/code/project-sha1 ls-tree -r "$c" | awk '{print $1, $4}'
       done)
```

That catches a missing file or a lost executable bit per commit. It does not catch changed content, so hash the content too:

```bash
git -C ~/code/project log --format=%H main | while read -r c; do
  git -C ~/code/project archive "$c" | tar -xO | shasum -a 256
done > /tmp/content-a.txt

git -C ~/code/project-sha1 log --format=%H main | while read -r c; do
  git -C ~/code/project-sha1 archive "$c" | tar -xO | shasum -a 256
done > /tmp/content-b.txt

diff /tmp/content-a.txt /tmp/content-b.txt
```

The `tar -xO` matters. `git archive` writes the commit id into a pax global header, so the tarballs differ between the two repositories even when the files inside are identical. My first attempt hashed the tarballs and reported a mismatch on a clean conversion.

`shasum` ships with macOS. On Linux, `sha256sum` does the same job and takes no `-a` flag.

The check I trust most is a second, independent import. Export the source again into a throwaway SHA-1 repository and compare the full object graph:

```bash
git init --object-format=sha1 /tmp/check
git -C ~/code/project fast-export --all --signed-tags=strip | git -C /tmp/check fast-import --quiet

diff <(git -C /tmp/check log --format='%H %T %P %B' main) \
     <(git -C ~/code/project-sha1 log --format='%H %T %P %B' main)
```

Identical strings there mean the destination holds exactly what the stream contains, down to tree ids, parent order and full commit messages. The import is deterministic, so a second run either matches or the input changed.

On my repository all four checks passed: 152 commits on both sides, 15,402 file versions compared (every commit crossed with every path it contains), 806 distinct file contents, and zero differences.

For a count you can quote later, the number of distinct blob contents is worth computing on both sides:

```bash
git -C ~/code/project-sha1 rev-list --objects main | awk 'NF == 2 {print $1}' | sort -u | wc -l
```

Two equal numbers plus a clean content diff is enough for me to trust the copy.

## Pushing over an existing SHA-1 history

If the remote already holds SHA-1 commits from the same work, the converted history is not a fast-forward. Same commits, different ids.

Before replacing anything, confirm the remote has nothing you lack. Fetch it into a throwaway repository and diff the subject lines:

```bash
git init --object-format=sha1 /tmp/remote-check
git -C /tmp/remote-check remote add origin git@github.com:<owner>/<repo>.git
git -C /tmp/remote-check fetch -q origin main

n=$(git -C /tmp/remote-check rev-list --count origin/main)
diff <(git -C /tmp/remote-check log --format=%s --reverse origin/main) \
     <(git -C ~/code/project-sha1 log --format=%s --reverse main | head -n "$n")
```

A clean diff means every remote commit is the first `n` commits of your history and the remote holds nothing unique. Then replace the branch:

```bash
git push --force-with-lease=refs/heads/main:<old-remote-sha> -u origin main
```

The lease only lets the push through if the remote still points at `<old-remote-sha>`, the value you inspected. A plain `--force` drops that check and will also drop commits someone pushed while you were converting.

After the push, fetch into a throwaway repository once more and repeat the hash diff against `origin/main`. That is the only step that closes the loop on the remote side.

## What the conversion does not carry

- Untracked and ignored files. `fast-export` reads objects only, so `docs/plans/`, a generated project file, `dist/` and local build caches stay in the old directory. Copy the ones you need with `rsync`.
- Build caches are better rebuilt than copied. Xcode and SwiftPM artifacts record absolute paths from the directory they were built in, so a copied cache makes the build reuse stale objects from the other tree. In my case that was 1.9 GB of cache pointing at the wrong path.
- The reflog. `git reflog` starts empty in the new repository.
- The stash reflog entry. `refs/stash` arrives intact but `git stash list` reads the reflog and prints nothing. `git stash store -m "<message>" <sha>` is the command meant for this. On git 2.56.0 it exited 0 and wrote no entry, so I wrote the reflog file by hand:

```bash
sha=$(git -C ~/code/project-sha1 rev-parse refs/stash)
committer=$(git -C ~/code/project-sha1 cat-file -p "$sha" | grep '^committer ' | sed 's/^committer //')
printf '%040d %s %s\t%s\n' 0 "$sha" "$committer" "On <branch>: <message>" \
  > ~/code/project-sha1/.git/logs/refs/stash
```

- Remote configuration and hooks. Re-add `origin` and copy `.git/hooks` if you had any.
- Commit and tag signatures. This repository had none, so I cannot show what the import does with them. The export stream does not carry a signature field.

## Two traps that break the conversion silently

`--quiet` on `git fast-export` truncates the stream. Git accepts the flag, the export exits 0, and filemodify lines disappear: on git 2.56.0 a two-commit test produced three `M` lines without the flag and one with it, and the import built trees with missing files and reported nothing. Keep `--quiet` on `fast-import`, never on `fast-export`. The file-list diff above catches the damage.

`set -o pipefail` plus `git log --format=%H | head -n 1` exits 141 and kills the script, because `head` closes the pipe early. Capture the value with `git rev-parse main` instead, and do not put a `| head` on any step of the conversion script.

## What I did not test

This repository had one branch, no tags, no submodules, no Git LFS, no merge commits, no signed commits and no worktrees. I tested none of those cases, so treat them as open questions rather than as paths the conversion handles.

One consequence I can state without testing: every commit id changed. Anything that recorded a short sha (a release note, a deploy log, an issue link) now points at an id that does not exist.

I also skipped the in-place variant, where you rename `.git` to a backup, import into a fresh repository and move the working tree across. It works the same way and keeps one directory, and it is the version I would test first on a repository with uncommitted work.
