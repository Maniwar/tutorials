# Writing narration for the ear

Read this before writing the first line, not after somebody watches the cut.

The failure this file exists to prevent looks like a voice problem and is not
one. It gets reported as *"the narration sounds really weird"*, and the instinct
is to try another voice, then another, then slow the rate down. None of that
fixes it, because the voice is reading prose that was written to be **read**.
Any synthetic voice — and most human ones — will sound stilted saying a sentence
nobody would say out loud.

You are especially likely to hit this when you have just been writing something
else well: documentation, code comments, a design rationale. Good written prose
uses long sentences, subordinate clauses, no contractions, and clause inversions
for emphasis. Every one of those is wrong here. The better your written register,
the more confidently you will write narration that cannot be spoken.

## The failure underneath the failure: the curse of knowledge

Sentence length is the *second* thing that goes wrong. The first is that you
have been staring at the product for hours and can no longer imagine not
knowing it. The report comes back as **"this is confusing to someone who's
never seen the product"**, and it is the more expensive note, because no
amount of rewriting sentences fixes it. You have to add material.

What it looks like, every time:

- **The video never says what the thing is or who it's for.** It opens on a
  feature. A stranger has no slot to file anything you show them into.
- **Domain words arrive unglossed.** Four unknown nouns in the first twenty
  seconds and the viewer has quietly stopped. Count them. In one cut here the
  opening was *engagement*, *three point estimates*, *critical path*, *rate
  card* — all before anything was established.
- **Product verbs get used as if they were English.** "He clicks pull." Pull
  is your word, not theirs. Either say what it does ("he clicks pull, and it
  tells him what's coming") or don't lead with it.
- **The payoff is asserted, never shown.** The narration claims the tool
  prices the work and tracks risks; the video never visits those screens. A
  claim with no picture is a claim the viewer has to take on trust, and they
  won't take four.
- **A second actor appears with no introduction.** The screen changes to
  another machine and nothing says whose it is or why.
- **Concrete numbers on screen go unsaid.** The frame shows `0% → 40%` and the
  line says "you can see what changed". Say the number. It is the difference
  between a claim and a demonstration.

The fixes are all additive, and they are the reason to accept a longer video:

1. **Ten seconds establishing what it is and who it's for**, before any
   feature. Ideally as the viewer's own situation, not a description.
2. **Visit every surface you name.** If the script says "risks", the risk
   screen gets a shot. Cutting the shot is not an option; cutting the *claim*
   is.
3. **Name the people on screen** the moment a second one appears.
4. **Read the actual numbers** off the frame you are showing.
5. **Gloss each domain term once**, in the same sentence, in plain words:
   "the critical path — the chain that decides your end date."

Length is not the constraint clarity is measured against. A 4-minute video a
stranger follows beats a 90-second one they bail on. Cut for *boredom*, never
for a target runtime.

## The rules

**One idea per sentence. 8–12 words.** This is the rule that matters most, and
the one that fails first. If a sentence has a comma-plus-and joining two
thoughts, cut it into two sentences. Count the words. Do not estimate.

**Contractions everywhere.** `it does not` → `it doesn't`. `you should not` →
`you shouldn't`. `that is` → `that's`. A demo with no contractions sounds like a
legal notice being read aloud, and this is the single easiest thing to get wrong
if your house style avoids them on the page.

**The viewer's problem first, your product second.** Open on what hurts, not on
what the thing is. `"You've got a project plan. Your colleague has a copy. By
Friday, they're different."` earns the next ninety seconds. `"This is an
engagement planner that runs as a single HTML file"` does not — nobody has a
reason to care yet.

**Say it out loud while you write it, not at the end.** If you stumble, the
voice will too, and so will the viewer. Anything you cannot say in one breath is
two lines.

**Front-load the benefit, then show the mechanism.** Not `"Click the Team menu,
then Push mine"`. Say `"Hit share, and it asks first"` — the viewer is already
watching the cursor do it.

**Cut every word that is not load-bearing.** Adverbs, "simply", "just", "easily",
"seamlessly", and any clause that restates the previous one. Over-written copy is
the number one reason a read sounds rushed: the segment stretches to fit the
voice, so extra words do not get cut — they get *hurried*.

**End with the next step.** One short line: where to get it, what to click, what
to try. It is the only sentence in the video allowed to ask for anything.

**Leave out the making-of.** How it was built, tested, or proven is fascinating
to you and is not what somebody scrolling wants from a product demo. Cut the
chapter. If the engineering is the story, that is a different video.

## The numbers

| What | Target |
|---|---|
| Words per sentence | 8–12 average, 15 hard ceiling |
| Speaking rate | 130–160 wpm (`rate: 0.85`–`0.9` on Kokoro; its default reads ~190) |
| Total script | ~150 words per finished minute |
| A 2-minute demo | ~250–300 words, all in |

**Kokoro's default rate is too fast for narration.** At `rate: 1.0` it lands
near 190 wpm, which is a newsreader clip, not a walkthrough. Set `rate` to
0.85–0.9 in the manifest's `tts` block. This alone fixes a large share of
"sounds weird" reports.

## Before and after

Both from the same demo. The left column is what a good technical writer
produces on instinct; the right is what a person says.

| Written for the eye (wrong) | Written for the ear (right) |
|---|---|
| "This is an engagement planner that runs as a single HTML file, and this month it learned how to hold more than one person." | "You've got a project plan. Your colleague has a copy. By Friday, they're different." |
| "Everybody points at one file in a folder you already sync. No server, no account, nothing uploaded anywhere." | "Pick a file. Drop it in Drive, or Dropbox. That's the setup. No server, no accounts." |
| "Sharing asks before it does anything, and it names exactly what the team is about to receive." | "Hit share, and it asks first. It shows you exactly what your team's about to get." |
| "If you both moved the same number, an unattended sync keeps yours and refuses to pick a winner." | "Then nothing gets decided behind your back. It keeps yours, and it waits." |
| "Left alone it syncs in the background, and it waits while you are typing rather than pulling the floor out from under a half finished sentence." | "So leave it alone. It syncs in the background. And it waits while you're typing." |

Note what changed: the clauses became sentences, `does not` became `doesn't`,
the clever closing image was cut, and the average sentence went from 22 words to
under 8. Nothing about the voice changed.

## Measure it before you render

Cheap, and it catches the problem while it is still a text file. Put this beside
your manifest builder:

```js
let words = 0, sentences = 0, longest = { n: 0, s: '' };
segments.forEach(seg => {
  if (/[‘’“”]/.test(seg.narration)) console.error('CURLY QUOTE: ' + seg.narration);
  seg.narration.split(/(?<=[.?!])\s+/).filter(Boolean).forEach(s => {
    const n = s.split(/\s+/).length;
    words += n; sentences++;
    if (n > longest.n) longest = { n, s };
  });
});
console.log(`${words} words in ${sentences} sentences · ` +
  `${(words / sentences).toFixed(1)} per sentence · ~${Math.round(words / 145 * 60)}s of voice`);
console.log(`longest (${longest.n} words): ${longest.s}`);
```

If words-per-sentence is above 12, or the longest is above 15, rewrite before you
spend a render on it. A full re-assembly costs minutes; this costs nothing.

**Apostrophes must be ASCII** (`'`, not `’`). The phonemizer does not reliably
handle the typographic ones, and contractions are now everywhere in your script —
which means a curly quote is no longer a rare edge case. The snippet above flags
them.

## Then phonemize

Sentence length and contractions are about how it *reads*; phonemizing is about
whether individual words come out right. Both matter, and they catch different
things. `espeak-ng -q -x -v en-us "your line"` prints exactly what the voice will
say. See the heteronym warning in SKILL.md — `lives`, `read`, `record`, `close`,
`use`, `lead` and friends resolve by lookup, not context.

## When you genuinely cannot judge it

You cannot hear your own render, and "does this sound natural" is not a question
a log answers. Render one representative line in two or three voices, send them
to the user, and ask. That is one cheap round trip, and it is far better than
shipping a two-minute cut built on a guess.

But do the writing pass **first**. If the copy is wrong, every voice sounds wrong,
and asking the user to choose between four bad options wastes their time and
teaches you nothing.
