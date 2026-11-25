/* ============================================================
 * deck / browser.d.ts
 * The globals the deck's browser code shares on window: what
 * engine.ts, lint.ts and story.ts put there, and the flags the dev
 * server (dev.ts) and the follow-along server (server/live.go)
 * write into the page before them.
 * ============================================================ */
export {};

declare global {
  // Where the deck is: engine.ts's state(), and what apply() takes.
  interface DeckState {
    slide: number;
    phase: number;
    blank: string;
    clip: boolean;
  }

  // engine.ts
  interface Deck {
    goTo(n: number, opts?: { atLastPhase?: boolean }): void;
    next(): void;
    prev(): void;
    finish(): void;
    jumpTo(n: number): Promise<void>;
    slides: HTMLElement[];
    state(): DeckState;
    apply(s: Partial<DeckState>, opts?: { instant?: boolean }): void;
    // Runs fn on slide i laid out at its last build step.
    probe<T>(i: number, fn: (slide: HTMLElement) => T): T;
    // Seconds the slide should take.
    estimate(slide: HTMLElement): number;
    titleOf(slide: Element): string;
    // The deck:slide, deck:phase and deck:shared events, by short name.
    on(type: "slide", fn: (d: DeckSlideEvent) => void): void;
    on(type: "phase", fn: (d: DeckPhaseEvent) => void): void;
    on(type: "shared", fn: (d: DeckSharedEvent) => void): void;
    // Keep a small JSON value the same in every view of the talk (the
    // other window, and phones while live); null clears it. With slide,
    // it belongs to the current slide and a slide change clears it.
    // False when it was not shared (over the size cap, or not JSON).
    share(key: string, value: unknown, opts?: { slide?: boolean }): boolean;
    // A shared value, null when unset.
    shared(key: string): unknown;
  }

  // deck:shared: another view of the talk shared a value (null: cleared).
  interface DeckSharedEvent {
    key: string;
    value: unknown;
  }

  // deck:slide: the current slide changed (from is -1 at the start).
  interface DeckSlideEvent {
    index: number;
    from: number;
    slide: HTMLElement;
    dir: "fwd" | "back";
  }

  // deck:phase: the current slide's build step changed, or a slide
  // was arrived on (phase 1, or its last when stepping back).
  interface DeckPhaseEvent {
    index: number;
    slide: HTMLElement;
    phase: number;
    phases: number;
  }

  interface DocumentEventMap {
    "deck:slide": CustomEvent<DeckSlideEvent>;
    "deck:phase": CustomEvent<DeckPhaseEvent>;
    "deck:shared": CustomEvent<DeckSharedEvent>;
  }

  // One slide's lint issues; slide is 1-based.
  interface DeckLintResult {
    slide: number;
    issues: string[];
  }

  // lint.ts
  interface DeckLint {
    slide(slide: HTMLElement): string[];
    deck(): DeckLintResult[];
    story(): string[];
    badge(): DeckLintResult[];
    results(): { slides: DeckLintResult[]; deck: string[] };
    claimsIn(text: string): string[];
    norm(t: string): string;
  }

  // story.ts: the headline readout.
  interface DeckStory {
    read(): {
      title: string;
      // The parsed outline.md (outline.ts), or null.
      outline: any;
      duration: number | null;
      sections: {
        id: string;
        title: string;
        minutes: number | null;
        question: string;
        rows: {
          issues: string[];
          n: number;
          beat: string;
          title: string;
          seconds: number;
          hints: string[];
        }[];
        seconds?: number;
      }[];
      deckIssues: string[];
      issues: number;
      total: number;
    };
    markdown(): string;
  }

  interface Window {
    deck: Deck;
    deckLint: DeckLint;
    deckStory: DeckStory;
    // Set by the dev server (dev.ts).
    DECK_DEV?: boolean;
    // Set by the follow-along server (server/live.go): the talk's
    // events URL, and the emojis the audience can send.
    DECK_FOLLOW?: string;
    DECK_REACTIONS?: string[];
    // Set on a signed-out follower's page (server/anon.go): where to
    // fetch the slides the speaker has shown so far.
    DECK_ANON?: string;
  }
}
