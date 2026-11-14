# {{TITLE}}

Point: The one sentence the audience should leave with. Write it first; every slide should serve it.

Before: Who is in the room, and what they already know.

After: What they can do when they walk out.

Duration: 30 min

How this file works (deck/AUTHORING.md, "The story"):

1. Put your raw material in `sources/` (notes, voice memo transcripts, posts, papers, a links.md) and have Claude write `sources/digest.md`: every fact, number and quote, numbered.
2. Write this outline before any slide: the Point, the audience, the sections with their questions and minutes, then the beats. Get it approved.
3. Each beat becomes a slide (or a few) carrying `data-beat="1.2"`. The dev server and `bun deck check` flag any slide that drifts from what its beat says, and any number or quote with no source.

Fields on a beat, all optional: Plan (what it shows or does, for you), Screen (text that must be on the slide), Say (the slide's notes, word for word), Sources (digest items it uses).

## 0 · Opening · 5 min

Question: Why should this room care, and what will they see?

### 0.1 · {{TITLE}}

Plan:
Title slide: the title, one line of promise, the things it covers.

### 0.2 · Two ways to do the thing

Plan:
Level-set before any jargon: the usual way and the other way, side by side.

### 0.3 · What the usual way costs

Plan:
The costs, one row per click. Only costs the audience will recognize.

## 1 · First part · 10 min

Question: The question this part answers, in one line.

### 1.1 · First part

Plan:
Divider.

### 1.2 · A headline that states the point

Plan:
A code slide: the headline says what the code proves.

### 1.3 · The same code, one step further

## 2 · Second part · 10 min

Question: The question this part answers, in one line.

### 2.1 · Why this tool

Sources: S1.1, S2.1

### 2.2 · What happens on a click

### 2.3 · The pain, in five words → the consequence.

Plan:
A wall: show the setup, play the pain, land the poster.

### 2.4 · What the demo shows

Plan:
Demo: what to watch for, the command, the link, a recorded fallback clip.

## 3 · Close · 5 min

Question: What should they remember and do next?

### 3.1 · The one line you want quoted.

### 3.2 · Sources

### 3.3 · Thank you
