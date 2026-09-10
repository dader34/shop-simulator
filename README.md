# Shop Tech Simulator

A diagnostic training simulator for working automotive technicians. Claude generates
a repair order root-cause-first, then plays the customer and the shop foreman while
you work the job like a real ticket.

## Running it

```bash
./start.sh          # serves on http://localhost:877 and opens a browser
./start.sh 8080     # or pick your own port
```

ES modules require `http://`, so opening `index.html` from the filesystem will not work.

## API key

Paste your Anthropic API key into the box on the setup screen. It is stored in your
browser's localStorage, is sent only to `api.anthropic.com`, and never touches this
repository. There is no key file to manage.

Roughly $0.15–0.40 per job at current Opus rates.

## How a case is built

Every case is generated ground-truth-first: Claude decides the actual failure, then
derives every fault code, sensor reading, and customer answer from it. Results are
raw observations — `Fuel pressure 38 psi KOER, spec 55-62` — never conclusions, and
every DTC carries its full scan-tool description.

There is no test menu. You are given the complaint and the vehicle, and you decide
what to check — describe any procedure the way you'd write it on a ticket and the
car answers with what the tool actually reads, billed at realistic time for the job.
Requests that try to skip the work ("what's wrong with it?") are refused and bill
nothing.

Red herrings are real: a weeping gasket, a stored code from a dead battery, a cheap
aftermarket part that works fine. They are the kind of ugly-but-irrelevant findings
that show up on any car with miles on it.

## Difficulty

| Level | Name | What changes |
|---|---|---|
| 1 | Lot Tech | Single obvious fault, codes point right at it |
| 2 | B Tech | Codes are a symptom, not the cause |
| 3 | A Tech | Real testing required; codes may mislead or be absent |
| 4 | Master Tech | Intermittent or load-dependent; possibly two faults |
| 5 | Dealer Hell | Multiple interacting faults, prior-repair damage, contradictory evidence |

Vehicle pool is either all makes (BMWs mixed in) or BMW-only, which uses real chassis
and engine codes and BMW-specific fault codes and module names (DME, DDE, CAS, FRM, EGS).

## Scoring

Commit a diagnosis and the repair you performed. The foreman checks it against ground
truth, and sees every test you devised. Name the right system but the wrong part and it counts as a miss. Leave a
contributing fault unaddressed and the car comes back days later with a new complaint.

Rating is Elo-style: each difficulty is a fixed opponent, so beating a level above your
rating gains more than beating one below it. A comeback always costs rating, regardless
of how hard the job was. Rating, job history, and any in-progress work order persist in
localStorage across reloads.

## Files

- `index.html` — markup and screens
- `app.js` — game loop, state, persistence
- `cases.js` — case generation, judging, customer role-play (prompts + schemas)
- `api.js` — Claude API calls
- `rating.js` — Elo rating and scoring
