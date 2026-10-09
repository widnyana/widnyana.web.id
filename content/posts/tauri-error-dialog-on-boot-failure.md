---
title: "Tauri app won't start and shows nothing? How to trap the boot error in a dialog"
date: 2026-10-10T03:30:00+07:00
draft: false
params:
  author: 'widnyana'
description: "A Tauri 2 app that fails during startup panics inside Tauri and shows the user nothing. How to catch the failures you can check early, show them in a native error dialog with rfd, exit cleanly, where else the same check fits, and which boot errors it does not trap."
showToc: true
tags:
  - tauri
  - rust
  - desktop-app
  - error-handling
  - env-vars
  - rfd
categories:
  - Architecture
keywords:
  - tauri app crashes silently
  - tauri show error dialog on startup
  - tauri setup hook panic
  - tauri failed to setup app
  - tauri boot error dialog
  - rust native message box rfd
  - tauri missing environment variable
  - panic in a function that cannot unwind
cover:
  image: /images/tauri-error-dialog-on-boot-failure-cover.png
  alt: "The words 'The app just died' above a list of startup steps that fail silently and one that shows a dialog"
---

If a Tauri 2 app fails while it boots, the user sees nothing. I found this out with a missing environment variable: the app panicked, the terminal got a stack trace, and anyone launching it from an icon would have seen an app that refuses to open. This post is the fix I used, which is a native error dialog shown before Tauri starts, plus a clear account of which boot errors it traps and which it does not.

It is one app and one fix, so read it as a report on what worked for me, not a rule.

## What a boot failure looks like

I started the app without `JWT_SECRET` set. This is the output, trimmed to the lines that matter:

```text
[ERROR][app_lib] Configuration error: JWT_SECRET environment variable is not set. Configure it before starting the application.

thread 'main' panicked at tauri-2.10.3/src/app.rs:1299:11:
Failed to setup app: error encountered during setup hook: JWT_SECRET environment variable is not set. Configure it before starting the application.

thread 'main' panicked at library/core/src/panicking.rs:225:5:
panic in a function that cannot unwind
```

The message is good. It names the variable and says what to do. But it goes to a log line and a panic payload on stderr, and a desktop app launched from the Dock or the Start menu has no terminal to read it in.

## Why you cannot catch it where it happens

The check lived in the `setup` hook, and returning `Err` from there did stop the boot:

```rust
builder.setup(|_app| {
    auth::validate_jwt_config().map_err(|e| {
        log::error!("Configuration error: {}", e);
        Box::<dyn std::error::Error>::from(e)
    })?;
    // database init, workers, local HTTP API ...
    Ok(())
})
```

The first panic in the trace above points at `tauri-2.10.3/src/app.rs`, not at my own `.expect(...)` after `builder.run(...)`. So Tauri turns the hook's `Err` into a panic internally, before control comes back to my code. Wrapping `run()` in my own error handling would not have caught it. That is my reading of the trace, not something I tested separately.

The second panic, "panic in a function that cannot unwind", follows the first and only adds a backtrace on top of the line you wanted.

## The fix: check before the builder, show a dialog, exit

Move the check out of the hook and to the top of `run()`, before `tauri::Builder` exists. Then show a native message box with the `rfd` crate and exit.

First add the dependency. I put it in the desktop-only target table of `Cargo.toml`:

```toml
[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]
rfd = "0.15"
```

Then the check in `run()`:

```rust
pub fn run() {
    // Fail before Tauri starts: a panic in the setup hook gives the user no visible message.
    if let Err(e) = auth::validate_jwt_config() {
        eprintln!("Configuration error: {e}");
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        rfd::MessageDialog::new()
            .set_level(rfd::MessageLevel::Error)
            .set_title("Configuration error")
            .set_description(e.as_str())
            .show();
        std::process::exit(1);
    }

    let mut builder = tauri::Builder::default();
    // ...
}
```

Delete the same check from the `setup` hook, so it runs once. `MessageDialog::show` blocks until the user closes the box, then the process exits with code 1. There is no panic and no backtrace, and the sentence that used to live only in the terminal is on screen.

Two details are easy to get wrong. Use `eprintln!` and not `log::error!`: the log plugin is registered on the builder, and before the builder exists there is nowhere for `log::error!` to go. And set the dialog level to `Error` so the operating system draws it as a failure and not as a notice.

## Where else this technique fits

Any startup failure that you can detect without a window, a webview, or a Tauri plugin can go in the same block at the top of `run()`. These are the cases I would put there. I only ran the first one, so treat the rest as suggestions.

| Boot failure | Check before the builder |
|---|---|
| Missing or empty env var (what I ran) | `std::env::var("NAME")` returns `Err` |
| Config file absent or unparseable | Read and parse it, show the path and the parse error |
| Data directory not writable | Create a probe file, show the directory that failed |
| Required external binary or driver missing | Look it up on `PATH`, name the one that is missing |
| Local port already taken by another instance | Try to bind it, say which port and suggest closing the other copy |

The common thread is that the user can fix each of these themselves if the app tells them what it is. The same dialog also suits a warning you want acknowledged before the app starts, because `show()` waits for the user to close it.

## Why not the dialog plugin

The obvious alternative is `tauri-plugin-dialog` from inside the setup hook. I did not take it. As I read its docs, the blocking dialog is not meant to be called from the main thread, and the setup hook runs on the main thread. I never tested whether that deadlocks in this app, so take it as the reason I avoided the path and not as a measured failure.

If your app already uses that plugin, it may be the smaller change. The price of `rfd` was 94 new lines in `Cargo.lock`, for a dialog that should almost never appear.

## What this does not trap

Only failures you can detect before Tauri starts. My app also initializes its database in the setup hook, and a failure there still ends in the same silent panic. I did not build a trap for it, because database init needs the async runtime that Tauri sets up. If that matters to you, it needs a different design, for example reaching the database before the builder with your own runtime. I have not tried that.

## Test it by breaking it on purpose

Build the app and start it with the variable unset:

```bash
env -u JWT_SECRET ./target/debug/your-app
```

You should see the dialog, and the terminal should show the one-line message with no panic trace. Close the dialog and the process exits with code 1. Start it again with the variable set and confirm the normal boot is unchanged.

I ran this on macOS. `rfd` uses a different backend on Windows and Linux, so repeat the test on each OS you ship before you trust it there.

## One cost outside the code

After the change I ran the repo's formatter, and it rewrote about 120 files unrelated to the fix. Merged, that would have conflicted with every other branch in flight. I reverted the formatter output and committed only the three files I had touched: `Cargo.lock`, `Cargo.toml`, and `lib.rs`. If your formatter is not a no-op on `main`, look at `git status` before you stage.

If you ship desktop apps and want a second pair of eyes on startup failure paths, more on how I work is on the [about page](/about).
