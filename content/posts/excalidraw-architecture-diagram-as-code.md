---
title: "Why my AI agent kept drawing blank boxes in Excalidraw, and what stopped it"
date: 2026-10-07T17:00:00+07:00
draft: false
params:
  author: 'widnyana'
description: "Claude Code wrote Excalidraw scene JSON and failed five ways: blank boxes, coordinates it could not see, facts from memory, checks it passed anyway, and a filter that broke its own rule. What each failure looked like and the constraint that stopped it."
showToc: true
tags:
  - excalidraw
  - claude-code
  - ai-agents
  - llm
  - diagrams
  - architecture-diagram
  - diagram-as-code
  - obsidian
  - python
categories:
  - DevOps
keywords:
  - claude code excalidraw
  - excalidraw blank rectangle
  - excalidraw text not showing
  - llm generate excalidraw json
  - ai agent diagram mistakes
  - excalidraw generate diagram with python
  - keep diagram in sync with design doc
  - architecture diagram out of date
cover:
  image: /images/excalidraw-architecture-diagram-as-code-cover.png
  alt: "The words 'The agent drew blank boxes' above a list of failing diagram checks and one passing build"
---

The first Excalidraw file Claude Code wrote for me opened as a page of colored rectangles with nothing written on them. No error, no warning in the console. It had put a `text` property on each rectangle. Excalidraw loads that without complaint and then draws nothing. That was the first failure. It was not the last, and the later ones were quieter.

This is a report from one agent on one project, not a rule about agents. Over a few sessions Claude Code wrote, and then rebuilt, a 13-frame architecture diagram for a platform design, working from a design doc. It failed in five ways. Each one got a constraint that turns the failure into an error, and those constraints are now a Claude Code skill. The list below is what happened, in the order I hit it.

## 1. It drew blank boxes, then copied a broken reference

Excalidraw has no text on a shape. Text is its own element, laid over the shape or bound to it. The agent fixed that, and then did it again, because the file it copied as a known good example carried the same pattern. Copying a reference proves nothing when you cannot see the result.

It also drew arrows between distant shapes as one straight segment. That is a diagonal line, and it looks like it connects everything it happens to cross.

That took two rounds of visibly broken output before anything usable existed. What stops it now: text is always its own element, arrows run along the axes and are bound to both shapes, and a check rejects any arrow that crosses a box it does not connect.

## 2. It placed coordinates it could not see

The first full diagram had six frames stacked in one narrow column and text at 10 to 14 pixels. That is not a hard mistake, it is a consequence. The agent worked in numbers and had no way to look at the result. My read, not a measurement: every layout error was invisible to it while it was making it.

So placement became the tool's job. A frame is a function, boxes size themselves from their text, rows keep equal heights, and arrows bind to boxes at both ends:

```python
from xl import *

def f1(doc):
    f = doc.frame('1 One request')
    f.header('How does one request reach the database?')
    users, edge = f.rowx(150, [
        dict(x=60,  w=300, tier='ext', title='Users',   detail='HTTPS to the public name'),
        dict(x=500, w=300, tier='dmz', title='HAProxy', detail='terminates TLS', tag=PRO)])
    app = f.node(940, 150, 300, 'apps', 'App', 'tcp 8443', h=edge.h)
    db  = f.node(940, 400, 300, 'data', 'PostgreSQL', 'tcp 5432', tag=DEC)
    f.horiz(users, edge, label='tcp 443')
    f.horiz(edge, app)
    f.vert(app, db, label='SQL')
    f.fit()
    return f
```

The build fails when:

- two boxes overlap or sit closer than 8 pixels
- text does not fit its box
- an arrow crosses a box it does not connect
- an arrow label lands on a box or on another arrow
- a font is smaller than 16 pixels
- a label contains a dash other than the hyphen, or an emoji (a style rule of mine, enforced by the tool)

Each frame also answers one question, written at its top, and frame 0 is a legend. A frame with one job has room for its details.

## 3. It wrote from memory

My first review of the old design docs leaned on memory and was wrong in places. It said no backups existed anywhere. The repo already had a nightly encrypted dump. It said nothing pages anyone. The monitoring role already shipped a Telegram receiver. Then the new diagram carried a NIC count and a scheduler feature that were not in the doc either.

Nothing compared the output to the source, so nothing objected. When I pushed back with "every claim must be backed by proof", the workflow changed:

1. Write the goals first: one question per frame, checkable success criteria, and what the diagram will not do.
2. Update the design doc first. The diagram may hold no fact the doc lacks.
3. Anything not decided gets a tag on the box: proposed, to assign, open, or user-verify, meaning only a person with access to the system can confirm it.
4. Run a script that lists every address, port, version, and host name on the diagram that the doc does not contain.

The diagram is where the doc turned out to be incomplete. It needed host addresses, service ports, and a failure-mode table, and all three went into the doc first, marked proposed where they were not decided.

On the final diagram my ad hoc check flagged 20 tokens. All 20 were formatting differences, such as a range written with backticks in the doc and without them on the diagram. The version that ships in the skill strips backticks and understands shorthand like `01/02/03`. On the same diagram it flags 4, all ranges that a person judges in seconds. It reports leftovers and does not decide. A leftover is either a fact the doc lacks or a formatting variant, and a person tells which.

## 4. It passed its own checks

The first build of the frames I had by then reported zero errors. Then I rendered each frame to a PNG and looked at it. Three things needed fixing that no check had caught:

- A label sat on top of the short arrow it labeled and hid it.
- One zone had an empty top third.
- Node titles wrapped to two lines because a host name did not fit.

Checks cover what someone thought of in advance. The rule now is that the agent renders every frame to a PNG and reads it before it calls the work done.

The preview tooling took some trial. ImageMagick could not draw SVG text on my machine, and PIL was not installed. On macOS, `qlmanage` makes a PNG from an SVG but crops it when the SVG is not square, so the renderer pads the canvas to a square. The preview is not Excalidraw. Fonts differ, and it only checks layout.

## 5. The filter that broke its own rule

One of the checks rejects dashes and emoji in labels. The first version of that filter held the banned characters literally, inside the regex that bans them. The regex worked, so every test passed. A scan I ran over the finished skill folder for exactly those characters matched the filter itself. It now builds the characters from code points, and the scan stays in the routine.

## What I still check by hand

- **Arrow label backgrounds.** I do not know yet how the Obsidian plugin draws the background behind a bound arrow label.
- **Text widths.** The checks use a conservative width per character. Real fonts may leave more or less room.
- **Moving a box later.** Arrows are fixed paths. If you move a box, you fix its arrow.
- **Regenerating.** The generator runs once per diagram. The Obsidian plugin rewrites element ids when it opens a file, so a later re-run would overwrite hand edits.
- **A clean install.** I have not yet installed the plugin on a clean machine and triggered the skill from a fresh session.

## Use it

The skill is a plugin in my marketplace:

```bash
/plugin marketplace add widnyana/eyay-toolkits
/plugin install excalidraw-diagrams@eyay-toolkits
```

Then ask for it in plain words:

```text
Use the excalidraw-diagrams skill to draw the network diagram for docs/design.md.
Every value must come from the doc. Tag anything undecided as proposed.
```

The build, the preview, the validator, and the cross-check are scripts inside the skill, and its workflow tells the agent to run them in that order.

If you keep infrastructure diagrams that have to stay true to a doc and want a second opinion on the checks, more on how I work is on the [about page](/about).
