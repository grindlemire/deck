package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"
)

// Signed-out followers (spaces mode). The gate lets someone who is not
// signed in reach a talk's follow-along routes with an empty X-Gate-Email.
// They may follow a live talk and nothing more: the follow page they get
// is the deck with every slide emptied (a shell), and the slides arrive
// from /slides only as far as the speaker has gone in this live session.
// Before the talk and after it they get no slide at all.

// deckParts is a published deck taken apart for the shell.
type deckParts struct {
	top     []byte   // from the start of the file through <head>
	head    []byte   // the rest of the head, less the data that names content
	body    []byte   // the <body> tag
	main    []byte   // the <main class="deck"> tag
	keep    [][]byte // the body's scripts and styles (the engine, the theme's), in order
	slides  [][]byte // each slide, its whole element
	sources map[string]json.RawMessage
}

var errNoDeck = errors.New(`no <main class="deck"> with slides`)

// splitDeck takes a published deck page apart: what the engine and the
// styles need, and the slides. Anything else in the body (comments,
// text outside the slides) is left out of the shell.
func splitDeck(b []byte) (*deckParts, error) {
	d := &deckParts{sources: map[string]json.RawMessage{}}
	headAt, headEnd := -1, -1
	var head bytes.Buffer
	i := 0
	for {
		t, ok := nextTag(b, i)
		if !ok {
			break
		}
		switch {
		case headAt < 0:
			if t.name == "head" && !t.closing {
				headAt = t.end
				d.top = b[:t.end]
			}
		case headEnd < 0:
			if t.name == "head" && t.closing {
				headEnd = t.start
				head.Write(b[i:t.start])
				d.head = head.Bytes()
				break
			}
			// Copy the head up to here, then decide on this element.
			head.Write(b[i:t.start])
			el := b[t.start:t.elemEnd]
			switch {
			case t.name == "script" && isData(t):
				if id, _ := t.attr("id"); id == "dk-sources" {
					_ = json.Unmarshal(t.inner(b), &d.sources)
				} else if id == "dk-config" {
					head.Write(el)
				}
			case t.name == "meta" && namesContent(t):
			default:
				head.Write(el)
			}
		default:
			switch {
			case t.name == "body" && !t.closing:
				d.body = b[t.start:t.end]
			case t.name == "main" && !t.closing && hasClass(t, "deck"):
				d.main = b[t.start:t.end]
				end, slides, err := slidesIn(b, t.end)
				if err != nil {
					return nil, err
				}
				d.slides = slides
				t.elemEnd = end
			case (t.name == "script" && !isData(t)) || t.name == "style" || (t.name == "link" && !t.closing):
				d.keep = append(d.keep, b[t.start:t.elemEnd])
			case t.name == "script" && isData(t):
				if id, _ := t.attr("id"); id == "dk-sources" {
					_ = json.Unmarshal(t.inner(b), &d.sources)
				}
			}
		}
		i = t.elemEnd
	}
	if headEnd < 0 || d.body == nil || d.main == nil || len(d.slides) == 0 {
		return nil, errNoDeck
	}
	return d, nil
}

// slidesIn reads the slides inside a <main class="deck"> whose start tag
// ends at from: every element with the class slide, outermost only, up to
// </main>. It returns where </main> ends.
func slidesIn(b []byte, from int) (int, [][]byte, error) {
	var slides [][]byte
	i := from
	for {
		t, ok := nextTag(b, i)
		if !ok {
			return 0, nil, errors.New("no </main>")
		}
		switch {
		case t.name == "main" && t.closing:
			return t.elemEnd, slides, nil
		case !t.closing && hasClass(t, "slide"):
			end, err := closeOf(b, t)
			if err != nil {
				return 0, nil, err
			}
			slides = append(slides, b[t.start:end])
			i = end
			continue
		}
		i = t.elemEnd
	}
}

// closeOf is where the element t opens ends: past its matching end tag.
func closeOf(b []byte, open tag) (int, error) {
	depth := 1
	i := open.end
	for {
		t, ok := nextTag(b, i)
		if !ok {
			return 0, fmt.Errorf("no </%s> for a slide", open.name)
		}
		if t.name == open.name {
			if t.closing {
				depth--
			} else if !t.selfClosing {
				depth++
			}
			if depth == 0 {
				return t.end, nil
			}
		}
		i = t.elemEnd
	}
}

// tag is one tag in the page: <name ...> or </name>.
type tag struct {
	start, end  int // the tag itself
	elemEnd     int // past the element's raw text for script and style; else end
	name        string
	closing     bool
	selfClosing bool
	attrs       map[string]string
}

func (t tag) attr(name string) (string, bool) {
	v, ok := t.attrs[name]
	return v, ok
}

// inner is a raw-text element's text (script, style).
func (t tag) inner(b []byte) []byte {
	end := bytes.LastIndex(b[t.end:t.elemEnd], []byte("</"))
	if end < 0 {
		return nil
	}
	return b[t.end : t.end+end]
}

func hasClass(t tag, c string) bool {
	return slices.Contains(strings.Fields(t.attrs["class"]), c)
}

// isData is a <script> that holds data, not code (type="application/json").
func isData(t tag) bool {
	typ := strings.ToLower(strings.TrimSpace(t.attrs["type"]))
	return typ != "" && typ != "module" && !strings.Contains(typ, "javascript")
}

// namesContent is a <meta> that describes the talk: its description and
// the link preview's.
func namesContent(t tag) bool {
	name := strings.ToLower(t.attrs["name"])
	prop := strings.ToLower(t.attrs["property"])
	return name == "description" || strings.HasPrefix(name, "twitter:") || strings.HasPrefix(prop, "og:")
}

// nextTag finds the next start or end tag at or after i, skipping
// comments, doctypes and the raw text of script, style and the like.
func nextTag(b []byte, i int) (tag, bool) {
	for {
		lt := bytes.IndexByte(b[i:], '<')
		if lt < 0 {
			return tag{}, false
		}
		i += lt
		rest := b[i:]
		if bytes.HasPrefix(rest, []byte("<!--")) {
			end := bytes.Index(rest[4:], []byte("-->"))
			if end < 0 {
				return tag{}, false
			}
			i += 4 + end + 3
			continue
		}
		if bytes.HasPrefix(rest, []byte("<!")) || bytes.HasPrefix(rest, []byte("<?")) {
			end := bytes.IndexByte(rest, '>')
			if end < 0 {
				return tag{}, false
			}
			i += end + 1
			continue
		}
		t := tag{start: i}
		j := 1
		if j < len(rest) && rest[j] == '/' {
			t.closing = true
			j++
		}
		n := j
		for n < len(rest) && isNameByte(rest[n]) {
			n++
		}
		if n == j || !isLetter(rest[j]) {
			i++ // a bare "<" in text
			continue
		}
		t.name = strings.ToLower(string(rest[j:n]))
		end, attrs, self, ok := readAttrs(rest, n)
		if !ok {
			return tag{}, false
		}
		t.end = i + end
		t.elemEnd = t.end
		t.attrs = attrs
		t.selfClosing = self
		if !t.closing && rawText[t.name] {
			closeAt := indexFold(b[t.end:], "</"+t.name)
			if closeAt < 0 {
				return tag{}, false
			}
			gt := bytes.IndexByte(b[t.end+closeAt:], '>')
			if gt < 0 {
				return tag{}, false
			}
			t.elemEnd = t.end + closeAt + gt + 1
		}
		return t, true
	}
}

var rawText = map[string]bool{"script": true, "style": true, "textarea": true, "title": true, "noscript": true}

func isLetter(c byte) bool   { return ('a' <= c && c <= 'z') || ('A' <= c && c <= 'Z') }
func isNameByte(c byte) bool { return isLetter(c) || ('0' <= c && c <= '9') || c == '-' || c == ':' }

// readAttrs reads a tag's attributes from b[i:] up to its '>': where the
// tag ends, its attributes (names lowercase) and whether it ends in "/>".
func readAttrs(b []byte, i int) (int, map[string]string, bool, bool) {
	attrs := map[string]string{}
	for i < len(b) {
		c := b[i]
		switch {
		case c == '>':
			return i + 1, attrs, i > 0 && b[i-1] == '/', true
		case c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '/':
			i++
		default:
			n := i
			for n < len(b) && !bytes.ContainsRune([]byte(" \t\n\r\f/>="), rune(b[n])) {
				n++
			}
			name := strings.ToLower(string(b[i:n]))
			i = n
			for i < len(b) && (b[i] == ' ' || b[i] == '\t' || b[i] == '\n' || b[i] == '\r') {
				i++
			}
			val := ""
			if i < len(b) && b[i] == '=' {
				i++
				for i < len(b) && (b[i] == ' ' || b[i] == '\t' || b[i] == '\n' || b[i] == '\r') {
					i++
				}
				if i < len(b) && (b[i] == '"' || b[i] == '\'') {
					q := b[i]
					end := bytes.IndexByte(b[i+1:], q)
					if end < 0 {
						return 0, nil, false, false
					}
					val = string(b[i+1 : i+1+end])
					i += end + 2
				} else {
					n := i
					for n < len(b) && !bytes.ContainsRune([]byte(" \t\n\r\f>"), rune(b[n])) {
						n++
					}
					val = string(b[i:n])
					i = n
				}
			}
			if _, seen := attrs[name]; !seen {
				attrs[name] = val
			}
		}
	}
	return 0, nil, false, false
}

func indexFold(b []byte, s string) int {
	return bytes.Index(bytes.ToLower(b), []byte(s))
}

// anonShell is the follow page for a signed-out follower: the deck's
// engine and styles, its slides as empty placeholders, and where to
// listen and fetch the slides the speaker has shown.
func anonShell(d *deckParts, prefix, name string) (*file, error) {
	base := prefix + "/" + name
	events, err := json.Marshal(base + "/events")
	if err != nil {
		return nil, err
	}
	slidesURL, _ := json.Marshal(base + "/slides")
	emojis, _ := json.Marshal(reactions)
	var b bytes.Buffer
	b.Write(d.top)
	fmt.Fprintf(&b, "\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<script>window.DECK_FOLLOW = %s; window.DECK_ANON = %s; window.DECK_REACTIONS = %s;</script>", events, slidesURL, emojis)
	b.Write(d.head)
	b.WriteString("</head>\n")
	b.Write(d.body)
	b.WriteString("\n")
	b.Write(d.main)
	for range d.slides {
		b.WriteString("\n<section class=\"slide\"></section>")
	}
	b.WriteString("\n</main>\n")
	for _, k := range d.keep {
		b.Write(k)
		b.WriteString("\n")
	}
	b.WriteString("</body>\n</html>\n")
	return newFile("index.html", b.Bytes(), time.Time{}), nil
}

// notLivePage is all a signed-out follower gets while the talk is not
// live: no deck at all. It looks again now and then.
var notLivePage = newFile("index.html", []byte(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="15">
<title>Not live</title>
<style>
  :root { color-scheme: light dark; --bg: #fafaf7; --fg: #1d1d1b; --dim: #6b6b66; }
  @media (prefers-color-scheme: dark) { :root { --bg: #161615; --fg: #ecebe6; --dim: #9a9993; } }
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; background: var(--bg); color: var(--fg);
         font: 18px/1.5 system-ui, sans-serif; text-align: center; padding: 0 16px; }
  p { margin: 0.25em 0; } .dim { color: var(--dim); font-size: 15px; }
</style>
</head>
<body>
<div>
<p>This talk isn't live right now.</p>
<p class="dim">This page checks again on its own, so keep it open.</p>
</div>
</body>
</html>
`), time.Time{})

// srcIDRE finds the sources a slide cites, as the engine does: S1, S2.1.
var (
	dataSrcRE = regexp.MustCompile(`\bdata-src\s*=\s*["']([^"']*)["']`)
	srcIDRE   = regexp.MustCompile(`S\d+`)
)

// slidesReply is /slides: the slides so far, in order from the first,
// and the sources they cite (for the engine's source lines and credits).
type slidesReply struct {
	Slides  []string                   `json:"slides"`
	Sources map[string]json.RawMessage `json:"sources"`
}

func (d *deckParts) reply(upto int) slidesReply {
	r := slidesReply{Slides: []string{}, Sources: map[string]json.RawMessage{}}
	for i := 0; i <= upto && i < len(d.slides); i++ {
		s := d.slides[i]
		r.Slides = append(r.Slides, string(s))
		for _, m := range dataSrcRE.FindAllSubmatch(s, -1) {
			for _, id := range srcIDRE.FindAll(m[1], -1) {
				if v, ok := d.sources[string(id)]; ok {
					r.Sources[string(id)] = v
				}
			}
		}
	}
	return r
}
