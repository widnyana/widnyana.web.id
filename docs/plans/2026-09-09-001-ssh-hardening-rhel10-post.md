# SSH hardening blog post (RHEL 10, first-VPS audience)

## Context

No SSH/sshd post existed on the site. Source material: a working `sshd_config`
drop-in and a port-migration runbook from real machines (Vagrant dev VMs and a server
called `magmar`). Written with `prose-engineers:technical-writer`.

Audience and framing settled with the user during drafting:

- **Audience: a first-time VPS owner** who shipped an AI-assisted app and now has a
  box on a public IP. Title and intro use that hook. A "What you need first" primer
  covers SSH keygen, `ssh-copy-id`, `sudo -i`, "second terminal", and `vim` basics.
- **Full technical depth kept**, but advanced sections (crypto-policies, explicit
  cipher lists, socket activation, `PerSourcePenalties` exempt list) are tagged
  "skip on your first pass".
- **RHEL 10 family only** (AlmaLinux 10 / Rocky 10 / CentOS Stream 10). No Debian or
  Ubuntu content at all, by explicit instruction.
- **SELinux stays Enforcing.** The "turning it off is not a fix" point is dry
  understatement, not a callout box.
- **`vim` throughout.** Config-file changes show the `vim` command plus the exact
  line to change.
- **Placeholders are named tokens** (`your-server-ip`, `your-home-ip`). The
  `PerSourcePenaltyExemptList` line ships commented out so a verbatim paste cannot
  lock the reader out.
- **Firewalld is installed but not started** until its ruleset (including `ssh`) is in
  place; the post branches on whether firewalld is already running and uses
  `firewall-offline-cmd` only while it is stopped.
- Crypto section: `update-crypto-policies` first, explicit pinned lists commented in
  the appendix.

These rules were also written to the new root `CLAUDE.md`.

## Changes

- `content/posts/ssh-hardening-rhel-10.md`: new post. Intro (read the auth log on a
  fresh box) -> primer -> safety rules -> one-package-per-line install -> SELinux
  Enforcing -> annotated drop-in (`50-hardening.conf`) grouped as key-only auth, no
  root, `AllowUsers`, brute-force/DoS limits, idle reaping, forwarding off, a
  quieter/smaller group -> crypto-policies (advanced) -> port move (SELinux label,
  firewalld both-states, sshd drop-in keeping 22, socket-activation check, verify,
  drop 22) -> verification checklist -> what not to do -> the `PerSourcePenalties`
  self-lockout gotcha -> low-key close to `/about`. Appendix: both drop-in files plus
  an ordered rollout script. `DevOps` category. Cross-links the Terragrunt/vSphere
  post.
- `static/images/ssh-hardening-rhel-10-cover.png`: 1200x630 PNG, ~185 KB. Dark
  gradient, dot grid, mono snippet with `PasswordAuthentication yes` struck through
  above the good config. Title "Your server is already being brute-forced". No distro
  or product name on it.
- `CLAUDE.md` (new, repo root): writing rules, sysadmin/how-to rules, cover-image
  rules, title rules, frontmatter conventions, verify-before-done checklist.

No em-dashes or en-dashes. Low-key close, no CTA.

## GEO + SEO pass (second round)

Optimized for search ranking and, primarily, citation by generative engines
(Princeton GEO study levers: cite primary sources, add statistics, answer directly,
structure for extraction).

- `content/posts/ssh-hardening-rhel-10.md`:
  - Frontmatter: `description` cut to ~145 chars, head term first; `keywords` rewritten
    to real query phrases (`how to secure ssh on a vps`, `is fail2ban still needed
    openssh 9.9`, `almalinux/rocky ssh hardening`, ...); added hand-written `summary`;
    `showToc: true` (this post only).
  - New `## The short version` block right after the intro: six self-contained,
    quotable declarative sentences.
  - Inline citations to primary sources at each claim: OpenSSH release-9.8 notes
    (`PerSourcePenalties`, DSA removal), Qualys regreSSHion advisory + Red Hat
    CVE-2024-6387, `man.openbsd.org/sshd_config`, Red Hat crypto-policies article,
    IANA port registry. Unsourced "~95%" replaced with a no-number framing.
  - Definitions: "drop-in config file" and "`PerSourcePenalties`" (with version/date).
  - H2s rewritten to query form ("Turn off SSH password authentication", "Block root
    login over SSH", "Move SSH off port 22 (what it does and does not do)", ...).
  - New `## FAQ` (plain markdown H3s, house pattern): 6 Q&As, each answer leads with a
    one-sentence direct answer.
  - New `## Quick reference: what each setting does` table (Setting | What it does | If
    you get it wrong).
- `layouts/partials/extend_head.html`: removed the duplicate
  `partialCached "templates/schema_json.html"` call. The theme's `head.html` already
  emits it, so every page was carrying two identical BlogPosting + BreadcrumbList
  JSON-LD blocks. Now one each.

Deliberately skipped: `FAQPage`/`HowTo` JSON-LD (Google dropped FAQ rich results for
non-authoritative sites), `llms.txt` (measured AI-crawler usage is negligible), visible
"Updated on" line, any site-wide theme param change.

## Verification

- `bin/prod.sh`: clean build, post renders at `/posts/ssh-hardening-rhel-10/`.
- `grep -n "—\|–"` on the post: nothing.
- Cover: `file` reports 1200 x 630; size well under the 500 KB pre-commit limit;
  displays in both light and dark themes.
- `pre-commit run --files content/posts/ssh-hardening-rhel-10.md
  static/images/ssh-hardening-rhel-10-cover.png CLAUDE.md`: passes.
- Placeholders are all named tokens; `PerSourcePenaltyExemptList` is commented in both
  the body and the appendix.
- Shell spot-checked for RHEL 10: `policycoreutils-python-utils` provides `semanage`;
  `semanage port -a -t ssh_port_t -p tcp <port>`; `firewall-cmd` vs
  `firewall-offline-cmd` used correctly per daemon state; `update-crypto-policies
  --set FUTURE`; OpenSSH 9.9 ships `PerSourcePenalties` on by default.
