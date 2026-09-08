# CLAUDE.md - widnyana.web.id

Hugo blog (PaperMod theme). Posts in `content/posts/`, covers in `static/images/`,
per-post plan docs in `docs/plans/`. Build: `bin/prod.sh`. Local: `bin/dev.sh`.

---

## Corrections from past sessions (do not repeat)

Each of these was a real mistake the user had to call out. Read before writing.

1. **Multi-package install one-liner.** Wrote `dnf install -y foo bar baz`.
   -> One package per line: `dnf install -y foo`, then `dnf install -y bar`, ...

2. **"Set X in file Y" with no how.** Wrote "set `SELINUX=enforcing` in
   `/etc/selinux/config`".
   -> Show the command and the exact edit: `vim /etc/selinux/config`, then "find the
   line `SELINUX=permissive` and change it to `SELINUX=enforcing`". Always `vim`,
   never `nano`.

3. **Started a firewall before its rules existed.** Put `systemctl enable --now
   firewalld` in the prereqs, before any rule allowed SSH.
   -> Never enable or reload a firewall on a box you only reach over SSH until the
   ruleset already contains the rule keeping your session alive. If firewalld is
   stopped, configure it with `firewall-offline-cmd` first (including the `ssh`
   service), then start it, with the existing session open. Branch on whether the
   daemon is already running.

4. **Realistic placeholder values.** Used `203.0.113.10` for "your server IP".
   -> Named tokens only: `your-server-ip`, `your-home-ip`. Never something a reader
   might paste as a real value.

5. **Value-dependent config line left active.** Shipped
   `PerSourcePenaltyExemptList your-home-ip/32` uncommented; a verbatim paste breaks
   the config and the SSH service will not restart.
   -> Any line needing a user-specific value ships commented out (`#`). Say which `#`
   to remove and after setting what.

6. **Distro / product name on the cover image.** Cover said "RHEL" and "SELinux".
   -> Cover images carry no distro or product name. Clickbait framing only.

7. **Descriptive title, weak for discovery.** "Hardening sshd on RHEL 10: key-only
   auth, a moved port, and SELinux left on".
   -> Clickbait, and carry the keywords people and LLMs search: the persona term plus
   the topic terms (`secure ssh`, `first vps`, `harden`, ...). Push the framing detail
   into the intro and the `description` field too.

8. **Wrote for an intermediate sysadmin.** The audience is a first-time VPS owner who
   shipped an AI-assisted app.
   -> Add a "What you need first" primer with copy-pasteable commands (SSH keygen,
   `ssh-copy-id`, `sudo -i`, what "a second terminal" is, `vim` survival keys). Keep
   full depth, but tag advanced sections "skip this on your first pass".

9. **Hand-holding asides.** "`setools-console` (for `sesearch`) and
   `setroubleshoot-server` (for `sealert`) are optional and useful when...".
   -> Cut asides about which package ships which optional tool. State the install,
   move on.

10. **Named a reading time.** Wrote "about 11 minutes".
    -> Never. Hugo renders the minute count.

11. **Planned a Debian section.** 
    -> Sysadmin posts target the RHEL 10 family only (AlmaLinux 10, Rocky 10, CentOS
    Stream 10). Do not write a Debian/Ubuntu section or name those distros at all.

---

## Standing style

- **No em-dashes or en-dashes.** Ever. Restructure with commas, periods, parens,
  colons. Grep the file for U+2014 and U+2013 before calling any writing task done.
- **Low-key, problem-first.** No hard-sell CTA, no "adopt this". Open with what
  breaks. Headings carry the argument. Close by pointing to `/about`.
- State plainly when a post has no real incident behind it, rather than inventing one.
- Cross-link related posts by path (`/posts/<slug>/`, no language prefix).

## Cover images

- 1200x630 PNG, dark, self-contained HTML rendered via headless Chrome. Under ~300 KB
  (pre-commit blocks >500 KB).
- Path `static/images/<slug>-cover.png`, referenced as top-level `cover.image`.
- No distro or product name. Clickbait framing.

## Frontmatter (match recent posts)

Top-level `cover:`, `params.author: 'widnyana'`, `date` as `YYYY-MM-DDTHH:MM:SS+07:00`
and in the past (`buildFuture: false`), double-quoted `description`, block-sequence
kebab-case `tags`, singular `categories` (`DevOps` / `Architecture` / ...), `keywords`
list. Slug is the filename; no `slug:` field.

## Verify before done

- `bin/prod.sh` builds clean; post renders at `/posts/<slug>/`.
- File has no U+2014 / U+2013.
- Cover is 1200x630 and renders in both light and dark themes.
- Every user-specific placeholder is a named token; every value-dependent config line
  is commented out.
- Write a per-post plan doc in `docs/plans/` (Context / Changes / Verification).
