---
title: "Secure SSH on your first VPS before the bots find it"
date: 2026-09-09T02:00:00+07:00
draft: false
params:
  author: 'widnyana'
description: "Harden SSH on a new RHEL 10 VPS: turn off password login, block root, throttle brute-force bots, and move off port 22 without locking yourself out."
summary: "A step-by-step SSH hardening guide for a first VPS on the RHEL 10 family (AlmaLinux, Rocky, CentOS Stream). Key-only authentication, no root login, brute-force limits, a safe port move, and SELinux left enforcing, with every command shown and the lockout traps called out."
showToc: true
tags:
  - ssh
  - sshd
  - hardening
  - selinux
  - firewalld
  - rhel
  - openssh
  - sysadmin
categories:
  - DevOps
keywords:
  - how to secure ssh on a vps
  - disable ssh password authentication
  - disable root login ssh
  - ssh key only authentication
  - change ssh port selinux
  - ssh brute force protection
  - is fail2ban still needed openssh 9.9
  - almalinux ssh hardening
  - rocky linux ssh hardening
  - sshd_config drop-in
cover:
  image: /images/ssh-hardening-rhel-10-cover.png
  alt: "An sshd_config snippet turning password authentication off and requiring publickey"
---

You built something, maybe with a lot of help from an AI coding harness, and pushed it to your first VPS. It runs. Now SSH in and read the log:

```bash
journalctl -u sshd --since "1 hour ago"
```

It is already full of `Failed password for root` and `Invalid user admin` from IP addresses all over the world. Nothing is broken. That is just what a server on a public IP looks like within minutes of booting: password login is on, the `root` account can log in over SSH, and it is listening on port 22 where every automated scanner looks first.

This post is the config that makes it stop: a small set of files that turn off password login, block `root`, slow down attackers, and move SSH off port 22, applied in an order that does not lock you out of a box you can only reach over SSH.

**Short on time?** Jump to [the full config](#appendix-the-whole-config) at the bottom. It is two files you can paste. The rest of this post explains every line and how to roll it out safely.

## The short version

- The one change that stops password-guessing bots is `PasswordAuthentication no`. Everything else is defense in depth.
- Never log in as `root` over SSH. Use a normal account with `sudo` and set `PermitRootLogin no`.
- OpenSSH 9.9, which ships in RHEL 10, turns on `PerSourcePenalties` by default. It rate-limits and then blocks IP addresses that keep failing, so a separate `fail2ban` setup is now mostly redundant for SSH.
- Moving SSH off port 22 cuts the automated scan noise but is not a security control. A targeted attacker finds the new port in seconds.
- SELinux must stay in `Enforcing` mode. Turning it off removes mandatory-access-control confinement from every service on the host, not just SSH.
- Apply every change with your current SSH session still open and test from a second terminal. One typo in `AllowUsers` or a firewall reload without the right rule locks you out, and the only way back is the provider's web console.

A scope note: the commands here target the **RHEL 10 family**, meaning AlmaLinux 10, Rocky 10, or CentOS Stream 10. Check with `cat /etc/os-release`. The `sshd_config` settings themselves work on any current SSH server, but the `dnf`, `semanage`, and `firewall-cmd` commands are RHEL-specific. This is a hardening baseline, not a war story: the config is generalized from real machines (some Vagrant dev VMs and a server called `magmar`), and there is no breach to recount, just the reasoning.

## What you need first

This guide assumes you can SSH into the box as a normal user (not `root`) and run `sudo`. If you are still logging in as `root` with a password, set up a key first.

**1. Make an SSH key on your own computer**, not on the server. Skip this if you already have one at `~/.ssh/id_ed25519`:

```bash
ssh-keygen -t ed25519 -C "your-name@laptop"
```

Press Enter to accept the default location. Set a passphrase when it asks; that passphrase protects the key file if your laptop is lost.

**2. Copy the public half to the server:**

```bash
ssh-copy-id your-user@your-server-ip
```

Replace `your-user` with your login name on the server and `your-server-ip` with the server's actual IP address. It asks for your password one last time.

**3. Confirm the key works.** Open a new terminal window and log in again:

```bash
ssh your-user@your-server-ip
```

If it does not ask for your account password (only the key passphrase, if you set one), the key is working.

**4. Confirm `sudo` works** without the password you are about to disable:

```bash
sudo whoami
```

It should print `root`.

A few conventions for the rest of this guide:

- **Become root once.** Everything that changes the server needs root. Run `sudo -i` after you log in and stay in that shell for the whole guide. The commands below assume you did this and do not write `sudo`.
- **`user@host`** means your login name on the server, then its IP or domain. Example: `ssh deploy@your-server-ip`.
- **"A second terminal"** is just another terminal window or tab on your own computer. Keep your first SSH session connected while you change things, and test every change from a second one. If a change breaks login, the still-connected first session is how you undo it.
- **`vim`** edits the config files here. If you have not used it: press `i` to start typing, make the change, then press `Esc`, type `:wq`, and press Enter to save and quit. To leave without saving, press `Esc` and type `:q!`.

## Before you touch anything

SSH hardening has one failure mode that matters: you change a setting, restart the SSH service, and the box stops accepting your connection. Now you need the VPS provider's web console, if they have one.

Two rules make that a non-event:

1. **Keep your current SSH session open.** Run every `systemctl restart sshd` from that session. If the restart breaks login, the existing connection stays up and you can undo the change.
2. **Test from a second terminal.** Open a fresh connection after each change and confirm it works before you trust it or close anything.

Now install the packages this guide uses, one at a time so you can see each one succeed:

```bash
dnf install -y openssh-server
dnf install -y policycoreutils-python-utils
dnf install -y firewalld
```

`openssh-server` is the SSH service itself (usually already installed). `policycoreutils-python-utils` provides the `semanage` command, needed later to let SSH use a new port; a minimal install does not have it. `firewalld` is the firewall.

Do not start `firewalld` yet. Starting a firewall on a box you can only reach over SSH, before its rules include one that keeps your session alive, is a classic way to lock yourself out. It gets started later in this guide, deliberately, with your existing session open to catch a mistake.

Every `sshd_config` change below goes in one file, which you create and edit with:

```bash
vim /etc/ssh/sshd_config.d/50-hardening.conf
```

A drop-in config file is a `.conf` file in `/etc/ssh/sshd_config.d/` that OpenSSH reads in addition to the main `/etc/ssh/sshd_config`. Keeping your changes in a drop-in means a package update never rewrites them, and your whole hardening set is one file you can copy to the next box. For any setting, the first value OpenSSH sees wins, and the stock `sshd_config` includes the drop-in directory on its first line, so a drop-in named `50-*` overrides the defaults further down. Every directive used here is documented in [`man sshd_config`](https://man.openbsd.org/sshd_config).

## SELinux stays Enforcing

Check it first:

```bash
getenforce
```

It must print `Enforcing`.

If it prints `Permissive`, switch it on now and make it survive a reboot:

```bash
setenforce 1
vim /etc/selinux/config
```

In that file, find the line that reads `SELINUX=permissive` and change it to:

```
SELINUX=enforcing
```

If `getenforce` prints `Disabled`, edit the same file the same way (the line will read `SELINUX=disabled`), then relabel the filesystem on the next boot, because it has been collecting unlabeled files the whole time SELinux was off:

```bash
vim /etc/selinux/config    # change SELINUX=disabled to SELINUX=enforcing
fixfiles -F onboot
reboot
```

The internet is full of tutorials whose first step is `setenforce 0`. The internet is also full of compromised RHEL boxes. These two facts are related.

SELinux is the thing that keeps a compromised sshd from becoming a compromised machine. With it enforcing, a popped sshd process is confined to what the `sshd_t` domain is allowed to do and almost nothing else. Turn it off and that confinement is gone for every service on the box, permanently, so that you could skip three commands. Later in this post there is exactly one SELinux step: labeling a new port. It takes one command. When something SELinux-related does break, the denial is written down for you:

```bash
ausearch -m avc -ts recent
journalctl -t setroubleshoot
```

Read the denial, add the one rule it asks for, move on. `setenforce 0` is not a debugging step. It is deleting the evidence and the protection at the same time.

## Turn off SSH password authentication

This is the core of it. No passwords, no keyboard-interactive, publickey and nothing else.

```
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitEmptyPasswords no
AuthenticationMethods publickey
PubkeyAuthentication yes
```

`PasswordAuthentication no` is the one that matters. `KbdInteractiveAuthentication no` closes the other interactive path that PAM can offer, which is easy to forget because it used to be called `ChallengeResponseAuthentication`. `AuthenticationMethods publickey` makes the requirement explicit rather than implied by what is switched off, and it is where you would later add `publickey,totp` if you wanted a second factor.

Do not apply this until a key login from a second terminal has actually worked. This is the setting that locks people out.

## Block root login over SSH

```
PermitRootLogin prohibit-password
```

`prohibit-password` still allows `root` to log in with a key, but never with a password. If nothing needs to log in as `root` directly, which is the normal case once your own user has `sudo`, use `no` instead and close it entirely:

```
PermitRootLogin no
```

The only reason to keep `prohibit-password` is if some deploy script or backup tool connects as `root` with a key. If you are not sure, you do not have one; use `no`.

## Allow only one account to log in

```
AllowUsers deploy
```

Replace `deploy` with your own login name on the server (the name you type in `ssh name@host`). With this line, the SSH service rejects every other account before it even checks a password or key. If you later add more admins, switch to a group:

```
AllowGroups sshusers
```

A typo here is a lockout: `AllowUsers deploi` locks out `deploy`. This is the other line, besides `PasswordAuthentication no`, that puts you on the provider's web console if you get it wrong. Test from the second terminal before you close the first.

## Rate-limit and penalize brute-force attempts

```
MaxAuthTries 3
LoginGraceTime 20
MaxStartups 10:30:60
PerSourceMaxStartups 3
PerSourcePenalties yes
# PerSourcePenaltyExemptList your-home-ip/32
```

`MaxAuthTries 3` drops the connection after three failed attempts. `LoginGraceTime 20` gives a client 20 seconds to authenticate before sshd hangs up, down from the default 120. `MaxStartups 10:30:60` starts refusing new unauthenticated connections once 10 are in progress, randomly, ramping to a hard cap at 60. `PerSourceMaxStartups 3` limits unauthenticated connections from a single address to 3 at once, so one host cannot eat the global pool.

`PerSourcePenalties` is an OpenSSH feature added in [version 9.8](https://www.openssh.com/txt/release-9.8) (July 2024). sshd tracks the behavior of each source address and imposes escalating timeouts, then outright blocks, on addresses that keep failing authentication, crashing, or disconnecting mid-protocol. It is `fail2ban` built into sshd, without the log-parsing or the extra service. RHEL 10 ships OpenSSH 9.9, where `PerSourcePenalties` is on by default, so `PerSourcePenalties yes` here is just making the default explicit.

`PerSourcePenaltyExemptList` is the part people learn the hard way. The penalty system does not tell the difference between a botnet and you mistyping your key passphrase four times during setup: both get the escalating timeout. Exempt the address you always connect from. Find it by running this on your own computer:

```bash
curl -s ifconfig.me
```

That line is commented out with a `#` in the config above on purpose. Remove the `#` and replace `your-home-ip` with what `curl` printed, keeping the `/32` on the end (that means "just this one address"):

```
PerSourcePenaltyExemptList 198.51.100.7/32
```

Leave the `#` in place until you have done that. A literal `your-home-ip` makes the config invalid, `sshd -t` fails, and the service will not restart. If your home IP changes often, either exempt the wider range your provider gives you or leave this line commented and just be careful during setup. Getting locked out here is recoverable only from the provider's web console.

One note on `LoginGraceTime`: the [regreSSHion bug](https://blog.qualys.com/vulnerabilities-threat-research/2024/07/01/regresshion-remote-unauthenticated-code-execution-vulnerability-in-openssh-server) ([CVE-2024-6387](https://access.redhat.com/security/cve/cve-2024-6387)), disclosed by Qualys in July 2024, was a race in the signal handler that fires when this timer expires, and it allowed unauthenticated remote code execution as root. RHEL 10's OpenSSH 9.9 is patched, so `20` is fine. On an older box you cannot patch, the interim mitigation was `LoginGraceTime 0`, which disables the vulnerable path at the cost of the grace timer.

## Disconnect idle and dead sessions

```
ClientAliveInterval 300
ClientAliveCountMax 2
TCPKeepAlive no
```

sshd sends an encrypted keepalive every 300 seconds and gives up after 2 unanswered, so a dead or hung client is cleaned up after about 10 minutes instead of holding a session and a PTY forever. `TCPKeepAlive no` turns off the plaintext TCP-level keepalive, which is spoofable and now redundant, since `ClientAlive` covers the same job inside the encrypted channel.

## Trim the attack surface

```
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding no
PermitUserEnvironment no
```

Most servers are not anyone's X11 display, SOCKS proxy, or agent-forwarding hop, and every forwarding type that is on is a channel that can be abused from an authenticated session. Turn off the ones the box does not need. If it needs none of them, there is a single directive that covers X11, agent, TCP, tunnel, and Unix-socket forwarding at once:

```
DisableForwarding yes
```

`PermitUserEnvironment no` stops a user's `~/.ssh/environment` file from setting environment variables at login, which is a small privilege-escalation vector through things like `LD_PRELOAD`. It is the default, but stock configs sometimes flip it.

## Speed up logins and cut log noise

These are not in the original drop-in. They are worth adding.

```
GSSAPIAuthentication no
UseDNS no
LogLevel VERBOSE
MaxSessions 3
```

`GSSAPIAuthentication no` turns off Kerberos/GSSAPI negotiation, which RHEL enables by default. Unless the box is joined to FreeIPA or Active Directory and you actually log in with Kerberos tickets, it is dead weight on every connection and a bit of extra code in the auth path. `UseDNS no` stops the reverse DNS lookup sshd does on every connecting address, which speeds up logins and removes a dependency on your resolver being reachable and honest.

`LogLevel VERBOSE` logs the fingerprint of the key that was used to authenticate. Without it you cannot tell which key logged in, which you want for audit, and which anything watching the logs needs to be useful. `MaxSessions 3` caps multiplexed sessions on one connection.

## Ciphers: let the system policy drive, pin only on purpose

*Skip this section on your first pass. A current RHEL 10 box already negotiates strong ciphers by default. Come back when you want to tighten further.*

RHEL has a [system-wide crypto policy](https://access.redhat.com/articles/3642912) that governs sshd, GnuTLS, OpenSSL, and the rest from one place. Check and tighten it there first:

```bash
update-crypto-policies --show        # DEFAULT on a fresh install
update-crypto-policies --set FUTURE  # drops SHA-1, small DH groups, and more
systemctl restart sshd
```

`FUTURE` is a deliberately aggressive policy. It will refuse connections from old clients, so roll it out where you control both ends. The policy writes `/etc/crypto-policies/back-ends/opensshserver.config`, which the stock `sshd_config` includes.

You can also pin algorithms directly in a drop-in. It works, but understand that it fights the policy file: your values and the policy's values are both loaded, and the next `update-crypto-policies` run will not touch your drop-in, so the box quietly drifts from every other box. If you pin, do it knowingly and re-check after any policy change. A current, conservative set:

```
KexAlgorithms sntrup761x25519-sha512@openssh.com,curve25519-sha256,curve25519-sha256@libssh.org
Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com
MACs hmac-sha2-256-etm@openssh.com,hmac-sha2-512-etm@openssh.com,umac-128-etm@openssh.com
HostKeyAlgorithms ssh-ed25519,rsa-sha2-512,rsa-sha2-256
```

While you are here, drop the ECDSA host key and keep Ed25519 plus RSA:

```
HostKey /etc/ssh/ssh_host_ed25519_key
HostKey /etc/ssh/ssh_host_rsa_key
```

If the RSA host key is still 2048-bit, regenerate it at 4096:

```bash
ssh-keygen -t rsa -b 4096 -f /etc/ssh/ssh_host_rsa_key -N ""
```

Removing a host key changes the fingerprint clients see, so existing clients will warn on the next connection. Do it before the box has many users. DSA is already gone: OpenSSH [removed it in 9.8](https://www.openssh.com/txt/release-9.8).

Validate and apply everything so far:

```bash
sshd -t && systemctl restart sshd
```

`sshd -t` parses the config and exits non-zero on an error, so the `&&` means a broken config never reaches the restart. Reconnect from the second terminal now.

## Move SSH off port 22 (what it does and does not do)

Be honest about what this buys you. Mass scanners only probe port 22, so moving off it makes most of the automated scan traffic and failed-login log spam simply stop arriving. It does close to nothing against someone specifically targeting your box, because a port scan finds the new port in seconds. It is noise reduction, not a security control. Worth doing, not worth overrating.

Pick a port below 32768 (the start of the [ephemeral port range](https://www.iana.org/assignments/service-names-port-numbers/service-names-port-numbers.xhtml) on Linux) that is not a registered service. `magmar` uses 14567. The steps below use that; substitute your own.

The order matters. SELinux has to know about the port before sshd tries to bind it, or the bind fails.

### Step 1: label the port for SELinux

```bash
semanage port -a -t ssh_port_t -p tcp 14567
semanage port -l | grep ssh_port_t
```

The second command should list `14567` alongside `22`. Do this before the restart.

### Step 2: open the port in firewalld

Check first whether firewalld is already running:

```bash
firewall-cmd --state
```

**If it says `not running`** (common on a fresh or cloud image), configure the ruleset while it is stopped, so the rules are complete before the daemon ever enforces anything. Add both the `ssh` service, which keeps your current session on port 22, and the new port, then start it:

```bash
firewall-offline-cmd --add-service=ssh
firewall-offline-cmd --add-port=14567/tcp
firewall-offline-cmd --list-all          # confirm both are listed
systemctl enable --now firewalld
firewall-cmd --list-all                  # verify again, from your live session
```

**If it says `running`**, your session is already relying on whatever is in the active zone, so check that before you touch anything:

```bash
firewall-cmd --list-services             # 'ssh' must be here if you are on port 22
firewall-cmd --permanent --add-port=14567/tcp
firewall-cmd --reload
firewall-cmd --list-all
```

If `ssh` is not in that list and you are connected on port 22, add it (`firewall-cmd --permanent --add-service=ssh`) and reload before doing anything else. A `--reload` applies the permanent ruleset, and if that ruleset does not include the door you came in through, the reload closes it.

Either way, keep `ssh` (port 22) open until the new port is confirmed working.

### Step 3: add the port in sshd, keeping 22

```bash
cat > /etc/ssh/sshd_config.d/10-port.conf <<'EOF'
Port 22
Port 14567
EOF

sshd -t && systemctl restart sshd
ss -tlnp | grep sshd
```

`ss` should show sshd listening on both `:22` and `:14567`.

If it shows both, skip ahead to Step 4. If it only shows `:22`, the box is one of the few where systemd owns the SSH port instead of the SSH config. Check:

```bash
systemctl is-active sshd.socket
```

If that prints `active`, the `Port` lines you just wrote are ignored and you set the port on the socket unit instead:

```bash
systemctl edit sshd.socket
```

```
[Socket]
ListenStream=
ListenStream=14567
```

The empty `ListenStream=` first is required. It clears the inherited `:22`; without it you append 14567 and keep listening on both.

### Step 4: verify the new port, then close 22

From the second terminal:

```bash
ssh -p 14567 user@host
```

Once that works, remove port 22 everywhere:

```bash
sed -i '/^Port 22$/d' /etc/ssh/sshd_config.d/10-port.conf
sshd -t && systemctl restart sshd

firewall-cmd --permanent --remove-service=ssh
firewall-cmd --reload
```

You can leave the SELinux label on 22 or remove it with `semanage port -d -t ssh_port_t -p tcp 22`. Leaving it costs nothing.

Better still, do not expose the new port to the whole internet. If you reach the box from a VPN or a known management range, scope it there with a firewalld rich rule or a `Match Address` block, and the port move stops mattering because the port is not reachable from anywhere that scans.

## Verify the hardening worked

From a client, in order:

```bash
# key login works on the new port
ssh -p 14567 user@host

# password auth is refused
ssh -p 14567 -o PreferredAuthentications=password -o PubkeyAuthentication=no user@host
# expected: Permission denied (publickey)

# root is refused
ssh -p 14567 root@host
```

On the box:

```bash
getenforce                    # Enforcing
ss -tlnp | grep sshd          # only :14567
ausearch -m avc -ts recent    # no sshd denials
ssh-audit -p 14567 localhost  # no fail/warn lines
```

`ssh-audit` (`pipx install ssh-audit`, or from EPEL) grades your key exchange, ciphers, MACs, and host keys and flags the weak ones.

## What not to do

- **Do not run `setenforce 0` to fix a bind failure.** The fix is `semanage port -a`. Every minute you spend with SELinux disabled is every service on the box unconfined.
- **Do not restart sshd without an open session and a second terminal ready.** A typo in `AllowUsers`, a bad `Match` block, or a cipher list that excludes your client all end the same way: on the console.
- **Do not treat the port move as security.** It reduces noise. A targeted attacker finds the new port immediately.
- **Do not set `PasswordAuthentication no` before a key login has worked from a second terminal.** Confirm first, then disable.
- **Do not paste `PerSourcePenaltyExemptList your-home-ip/32` literally.** Either set it to a real address or leave the line commented. A literal placeholder breaks the config and the SSH service will not restart.
- **Do not put access rules in the main `/etc/ssh/sshd_config`.** Use `sshd_config.d/` drop-ins so a package update's config handling never fights your changes, and so your hardening is one file you can diff and copy.

## The part that surprises people

`PerSourcePenalties` changes the threat model in a way that is easy to miss. A botnet hitting you from ten thousand addresses is now throttled per address, which is great. But you connect from one address, every time, and that address gets penalized on the same rules. One bad passphrase during a late-night change, then another, then a reconnect that times out because sshd is now sitting on your IP with a penalty, and you have locked yourself out of a box that is working perfectly. The exempt list is how you do not do that to yourself.

The other one: with 9.9's penalties on by default, running `fail2ban` for SSH specifically is mostly redundant now. It still earns its place watching other services, but the SSH jail is doing work sshd already does.

## FAQ

### What is the single most important SSH hardening step?

Turning off password authentication with `PasswordAuthentication no`. Password guessing is what almost every SSH bot does, and key-only authentication makes all of it fail regardless of how weak an account password is. Everything else in this guide is defense in depth on top of that one change.

### Is it worth changing the SSH port from 22?

Only as noise reduction, not as security. Moving off port 22 stops most automated scanners, which only check 22, so your logs get quiet. It does nothing against a targeted attacker, who finds the new port with a quick scan. Do it if the log volume bothers you; skip it if the extra steps are not worth it.

### Do I still need fail2ban with OpenSSH 9.9?

For SSH specifically, mostly no. OpenSSH 9.8 and later include `PerSourcePenalties`, which rate-limits and then blocks misbehaving source addresses inside sshd, and RHEL 10 enables it by default. `fail2ban` still earns its place watching other services like web and mail servers, but a dedicated SSH jail now duplicates work sshd already does.

### Should I disable SELinux if it blocks SSH?

No. SELinux confines a compromised sshd to almost nothing, and turning it off removes that protection from every service on the host. When SELinux blocks something the denial is logged (`ausearch -m avc -ts recent`), and the fix is usually one command, such as `semanage port -a` to label a new SSH port. `setenforce 0` deletes the evidence and the protection at once.

### How do I harden SSH without locking myself out?

Keep your current SSH session open, make one change at a time, and test each change from a second terminal before trusting it. The changes that cause lockouts are a typo in `AllowUsers`, disabling password auth before a key login works, a firewall reload whose ruleset omits your access, and a literal placeholder left in `PerSourcePenaltyExemptList`. If you do lock yourself out, recovery is through the VPS provider's web console.

### Will these settings work on distributions other than RHEL 10?

The `sshd_config` directives work on any current OpenSSH, so the key-only auth, root, `AllowUsers`, brute-force, and forwarding settings are portable. The surrounding commands are not: `dnf`, `semanage`, `firewall-cmd`, and `update-crypto-policies` are specific to the RHEL family. On another distribution you would use its package manager, firewall front end, and mandatory-access-control tooling instead.

## Wrapping up

The drop-in below is the whole thing: key-only auth, no root by password, a single allowed user, brute-force and idle limits, forwarding off, and the noise turned down. The port move is a separate file so you can roll it back on its own. SELinux stays enforcing throughout, because the one time it costs you three commands is not worth what turning it off costs you.

If you are rolling this across more than a handful of boxes, the same least-privilege thinking applies to the automation that connects to them, which is most of what the [Terragrunt and OpenTofu on vSphere](/posts/terragrunt-vsphere-iac-provisioning/) post is about. And if you want a second opinion on a specific setup, more on how I work is on the [about page](/about).

## Quick reference: what each setting does

| Setting | What it does | If you get it wrong |
| --- | --- | --- |
| `PasswordAuthentication no` | Refuses every password login; only keys work | Set it before your key works from a second terminal and you are locked out |
| `PermitRootLogin no` | Blocks the `root` account from logging in over SSH | Low risk; keep `prohibit-password` only if a script logs in as root by key |
| `AllowUsers <name>` | Rejects every account except the ones listed, before checking credentials | A typo in the name locks out the real account |
| `MaxAuthTries 3` | Drops the connection after three failed attempts | Too low a value can cut off an SSH agent before it reaches the right key |
| `PerSourcePenalties yes` | sshd rate-limits, then blocks, source addresses that keep failing | Without an exempt entry, your own IP gets penalized after setup mistakes |
| `ClientAliveInterval 300` + `ClientAliveCountMax 2` | Disconnects a dead or hung client after about 10 minutes | Too aggressive a value drops real sessions on a flaky link |
| `X11Forwarding no` and the other forwarding lines | Turn off forwarding channels the box does not need | Disabling a type something actually uses breaks that workflow |
| `GSSAPIAuthentication no` | Skips Kerberos negotiation on every connection | Only an issue if the box genuinely uses Kerberos, FreeIPA, or AD |
| `UseDNS no` | Skips a reverse-DNS lookup per connection | No practical downside; only affects DNS-based `Match` rules, which are rare |
| `Port <n>` with `semanage` and a firewall rule | Moves SSH off port 22 to cut scanner noise | Skipping the SELinux label or firewall rule stops sshd binding or locks you out |

## Appendix: the whole config

`/etc/ssh/sshd_config.d/50-hardening.conf`:

```
# --- key-only auth ---
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitEmptyPasswords no
AuthenticationMethods publickey
PubkeyAuthentication yes

# --- no root over SSH (use prohibit-password only if a script needs keyed root) ---
PermitRootLogin no

# --- restrict who can log in (put YOUR server login name here) ---
AllowUsers deploy

# --- brute-force / DoS limits ---
MaxAuthTries 3
LoginGraceTime 20
MaxStartups 10:30:60
PerSourceMaxStartups 3
PerSourcePenalties yes
# uncomment and set to your own IP once you know it (see the post):
# PerSourcePenaltyExemptList 198.51.100.7/32

# --- idle session reaping ---
ClientAliveInterval 300
ClientAliveCountMax 2
TCPKeepAlive no

# --- trim attack surface ---
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding no
PermitUserEnvironment no

# --- quieter, smaller ---
GSSAPIAuthentication no
UseDNS no
LogLevel VERBOSE
MaxSessions 3

# --- host keys: Ed25519 + RSA only ---
HostKey /etc/ssh/ssh_host_ed25519_key
HostKey /etc/ssh/ssh_host_rsa_key

# --- optional: pin algorithms (fights update-crypto-policies; see the post) ---
# KexAlgorithms sntrup761x25519-sha512@openssh.com,curve25519-sha256,curve25519-sha256@libssh.org
# Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com
# MACs hmac-sha2-256-etm@openssh.com,hmac-sha2-512-etm@openssh.com,umac-128-etm@openssh.com
# HostKeyAlgorithms ssh-ed25519,rsa-sha2-512,rsa-sha2-256
```

`/etc/ssh/sshd_config.d/10-port.conf` (after the transition, only the new port):

```
Port 14567
```

Rollout, in order:

```bash
# packages (install firewalld, do not start it yet)
dnf install -y openssh-server policycoreutils-python-utils firewalld

# SELinux enforcing
getenforce                         # must say Enforcing

# label the new port before sshd tries to bind it
semanage port -a -t ssh_port_t -p tcp 14567

# firewall: if not running, configure offline (incl. ssh) then start
firewall-cmd --state || {
  firewall-offline-cmd --add-service=ssh
  firewall-offline-cmd --add-port=14567/tcp
  systemctl enable --now firewalld
}
# if it was already running instead:
#   firewall-cmd --list-services            # 'ssh' must be present
#   firewall-cmd --permanent --add-port=14567/tcp && firewall-cmd --reload
firewall-cmd --list-all

# write both drop-ins, validate, restart
vim /etc/ssh/sshd_config.d/50-hardening.conf
printf 'Port 22\nPort 14567\n' > /etc/ssh/sshd_config.d/10-port.conf
sshd -t && systemctl restart sshd

# TEST from a second terminal: ssh -p 14567 user@host

# once confirmed: drop port 22
sed -i '/^Port 22$/d' /etc/ssh/sshd_config.d/10-port.conf
sshd -t && systemctl restart sshd
firewall-cmd --permanent --remove-service=ssh
firewall-cmd --reload
```
