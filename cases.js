import { ask } from './api.js';

export const DIFFICULTY = {
  1: { name: 'Lot Tech',    desc: 'Single obvious fault, codes point straight at it, customer describes it well.' },
  2: { name: 'B Tech',      desc: 'Single fault, codes are a symptom rather than the cause. Some interpretation needed.' },
  3: { name: 'A Tech',      desc: 'Fault requires real testing to isolate. Codes may be misleading or absent. Possible prior misdiagnosis.' },
  4: { name: 'Master Tech', desc: 'Intermittent or load-dependent. Possibly two related faults. Vague customer, parts already thrown at it.' },
  5: { name: 'Dealer Hell', desc: 'Intermittent, multiple interacting faults, aftermarket/prior-repair damage, contradictory evidence, red-herring codes.' },
};

const CASE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['vehicle', 'ro', 'truth', 'par_minutes', 'key_findings', 'customer_persona'],
  properties: {
    vehicle: {
      type: 'object',
      additionalProperties: false,
      required: ['year', 'make', 'model', 'engine', 'trans', 'mileage', 'vin'],
      properties: {
        year: { type: 'integer' },
        make: { type: 'string' },
        model: { type: 'string' },
        engine: { type: 'string' },
        trans: { type: 'string' },
        mileage: { type: 'integer' },
        vin: { type: 'string', description: '17 characters, plausible but fictional' },
      },
    },
    ro: {
      type: 'object',
      additionalProperties: false,
      required: ['complaint', 'writer_notes', 'history', 'labor_rate'],
      properties: {
        complaint: { type: 'string', description: "Customer's own words, verbatim, as written on the RO." },
        writer_notes: { type: 'string', description: 'One line from the service writer.' },
        history: {
          type: 'array',
          items: { type: 'string' },
          description: 'Prior repairs/visits relevant or misleadingly irrelevant. May be empty.',
        },
        labor_rate: { type: 'integer', description: 'Shop door rate in dollars per hour, 110-220.' },
      },
    },
    truth: {
      type: 'object',
      additionalProperties: false,
      required: ['root_cause', 'mechanism', 'contributing', 'red_herrings', 'correct_repair', 'why_missed'],
      properties: {
        root_cause: { type: 'string', description: 'The single actual failed component/condition. Be specific.' },
        mechanism: { type: 'string', description: 'How that root cause produces the observed symptoms.' },
        contributing: { type: 'array', items: { type: 'string' }, description: 'Secondary faults that must ALSO be fixed for the comeback not to happen. Empty for easy cases.' },
        red_herrings: { type: 'array', items: { type: 'string' }, description: 'Findings that look damning but are not the cause.' },
        correct_repair: { type: 'string', description: 'The repair that actually fixes it.' },
        why_missed: { type: 'string', description: 'Why a competent tech commonly misdiagnoses this.' },
      },
    },
    par_minutes: { type: 'integer', description: 'Total billable minutes a competent technician needs to isolate this fault by the most direct sound diagnostic path, including the initial scan and verification. Do not pad it.' },
    key_findings: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['procedure', 'minutes', 'result'],
        properties: {
          procedure: { type: 'string', description: 'A test a technician might perform on this vehicle, e.g. "Fuel pressure at rail, KOER".' },
          minutes: { type: 'integer', description: 'Realistic billable time for it.' },
          result: { type: 'string', description: 'The literal observation with real numbers, units, and spec. Every DTC must include its full scan-tool description and status, e.g. "P0304 - Cylinder 4 Misfire Detected (current)". Never interpreted, never hinting at the cause.' },
        },
      },
      description: 'Pre-derived results for 8-14 procedures a tech is likely to attempt: the decisive path, several dead ends, and anything exposing a red herring. NEVER shown to the technician as a menu - used only to keep answers consistent when they devise their own tests.',
    },
    customer_persona: { type: 'string', description: 'How this customer talks: helpful, defensive, vague, in a hurry, knows just enough to be dangerous, etc.' },
  },
};

const SYSTEM = `You are the case designer for a professional automotive diagnostic training simulator used by working shop technicians.

You write realistic repair-order scenarios. Absolute rules:

1. GROUND TRUTH FIRST. Decide the actual failure, then derive every symptom, code, and test result from it deterministically. Every test result you write must be exactly what a real scan tool, meter, scope, or gauge would show given that failure. Never write a result that contradicts the root cause.
2. NEVER TELEGRAPH. Test results are raw observations, not conclusions. Write "Fuel pressure 38 psi KOER, spec 55-62 psi" — never "Fuel pressure low, indicating a failing pump." No test result may name or hint at the root cause.
3. RED HERRINGS MUST BE REAL. A red herring is a genuine out-of-spec or ugly finding that is not causing this complaint (a weeping valve cover gasket, a stored history code from a dead battery, a cheap aftermarket part that works fine). Include failures that would show up on a real car of that age and mileage.
4. NUMBERS MUST BE RIGHT. Use real specifications, real live-data PIDs, real resistance and voltage values. If you are not certain of an exact spec, choose a value clearly in or out of range and state the spec alongside it.
5. ALWAYS WRITE THE CODE DESCRIPTION. Every DTC must be followed by its real description as the scan tool displays it, plus its status. Write "P0304 - Cylinder 4 Misfire Detected (current)" — never a bare "P0304". This applies everywhere a code appears, including the customer's own vague references. For BMW, give both forms: "29CD - Misfire cylinder 4 (2A87 in DME memory)". A technician must be able to read the result without already knowing the code.
6. TEST MENU MUST BE HONEST. Include tests that lead nowhere alongside the ones that matter, so the menu itself is not a hint. Order them naturally, not by usefulness. Include at least one test whose result is completely normal.
7. The customer complaint is written in the customer's own words with their own misunderstandings, not in technical language.`;

export async function generateCase({ difficulty, focus, avoid = [], onProgress }) {
  const d = DIFFICULTY[difficulty];
  const avoidLine = avoid.length
    ? `\n\nThe technician has recently worked these root causes — pick something clearly different:\n${avoid.map((a) => `- ${a}`).join('\n')}`
    : '';

  const focusLine = focus === 'bmw'
    ? `Vehicle scope: BMW only. Use real chassis codes (E46, E60, E9x, F10, F30, G20, etc.) with the correct engine for that chassis (M54, N52, N54, N55, B58, N20, S65, M57, N47...). Use BMW-specific fault code formats (both the 5-digit hex/decimal BMW codes such as 2A82, 29CD, 30FF and their descriptions) and BMW-specific module names (DME, DDE, CAS, FRM, JBE, EGS, ELV, IHKA). Reference real BMW-known failure patterns and their diagnostic quirks.`
    : `Vehicle scope: any make sold in the US, weighted toward what actually rolls into an independent shop — domestic trucks, Toyota/Honda, Ford, GM, Subaru, Nissan, plus European. Roughly one case in four should be a BMW, and when it is a BMW use real chassis/engine codes and BMW-specific fault codes and module names (DME, DDE, CAS, FRM, EGS).`;

  const json = await ask({
    system: SYSTEM,
    effort: 'high',
    maxTokens: 12000,
    stream: true,
    onProgress,
    messages: [{
      role: 'user',
      content: `Create one diagnostic case at difficulty ${difficulty}/5 — "${d.name}".

Difficulty ${difficulty} means: ${d.desc}

${focusLine}

The technician is NOT given a list of tests — they must decide what to check themselves. Supply key_findings as your own private consistency notes: 8 to 14 procedures a tech would plausibly attempt on this complaint, each with the literal result. Cover the decisive diagnostic path, several reasonable dead ends that reveal nothing, and anything that would surface a red herring. Set par_minutes to the time the most direct sound path would take.${avoidLine}

Build the ground truth first, then write every test result to be consistent with it.`,
    }],
    schema: CASE_SCHEMA,
  });

  if (!Array.isArray(json.key_findings) || json.key_findings.length < 4) {
    throw new Error('Case came back underspecified. Try opening the work order again.');
  }
  if (!json.par_minutes || json.par_minutes < 15) json.par_minutes = 90;
  return json;
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['correct', 'root_cause_found', 'completeness', 'accuracy_note', 'customer_reaction', 'comeback', 'teaching', 'missed_steps'],
  properties: {
    correct: { type: 'boolean', description: 'True only if the diagnosis identifies the actual root cause, allowing for different wording.' },
    root_cause_found: { type: 'boolean', description: 'True if they named the root cause even if their proposed repair is wrong or incomplete.' },
    completeness: { type: 'integer', description: '0-100. Did they also catch every contributing fault that must be fixed?' },
    accuracy_note: { type: 'string', description: 'Two or three sentences to the tech, plain shop language, on what their diagnosis got right and wrong.' },
    customer_reaction: { type: 'string', description: "The customer's spoken reaction at pickup, in character, 1-3 sentences." },
    comeback: {
      type: 'object',
      additionalProperties: false,
      required: ['happens', 'days_later', 'new_complaint'],
      properties: {
        happens: { type: 'boolean' },
        days_later: { type: 'integer' },
        new_complaint: { type: 'string', description: "The customer's words when they return, or empty if no comeback." },
      },
    },
    teaching: { type: 'string', description: 'The diagnostic lesson: what the decisive test was and how the evidence pointed to the answer. 3-6 sentences.' },
    missed_steps: { type: 'array', items: { type: 'string' }, description: 'Tests they did not run that would have nailed it faster.' },
  },
};

export async function judgeDiagnosis({ theCase, diagnosis, repair, testsRun, custom = [], onProgress }) {
  const ran = custom;
  return ask({
    system: `You are a master technician and shop foreman evaluating a tech's diagnosis against known ground truth. You are fair but exacting: a diagnosis is correct only if it identifies the actual failed component or condition. Naming the right system but the wrong part is not correct. If a contributing fault was left unaddressed, the car comes back. Speak like a foreman on the shop floor — direct, no corporate padding, no praise the work didn't earn. Whenever you cite a DTC, include its full description, e.g. "P0304 - Cylinder 4 Misfire Detected", never a bare code.`,
    effort: 'high',
    stream: true,
    onProgress,
    messages: [{
      role: 'user',
      content: `GROUND TRUTH
Root cause: ${theCase.truth.root_cause}
Mechanism: ${theCase.truth.mechanism}
Must also be addressed: ${theCase.truth.contributing.join('; ') || '(nothing else)'}
Correct repair: ${theCase.truth.correct_repair}
Red herrings: ${theCase.truth.red_herrings.join('; ') || '(none)'}

CUSTOMER PERSONA: ${theCase.customer_persona}
COMPLAINT: "${theCase.ro.complaint}"

TESTS THE TECH DEVISED AND RAN (${ran.length}):
${ran.map((t) => `- ${t.name}\n  -> ${t.result}`).join('\n') || '(none — they diagnosed blind)'}

TECH'S DIAGNOSIS:
${diagnosis}

REPAIR THEY PERFORMED:
${repair}

Evaluate. A comeback happens if the root cause was not fixed, or if a contributing fault was left unaddressed.`,
    }],
    schema: VERDICT_SCHEMA,
  });
}

export async function askCustomer({ theCase, question, asked }) {
  return ask({
    system: `You are role-playing a customer at an auto repair shop. Stay in character, answer only what a car owner would plausibly know, and never use technical language beyond what this persona would use. Never reveal the diagnosis — you do not know it. If asked something you would not know, say so the way a real person would. Answer in 1-3 sentences. Output only the customer's spoken words, no quotation marks, no narration.

Persona: ${theCase.customer_persona}
Your car: ${theCase.vehicle.year} ${theCase.vehicle.make} ${theCase.vehicle.model}, ${theCase.vehicle.mileage.toLocaleString()} miles.
Your complaint as written up: "${theCase.ro.complaint}"
Prior history you know about: ${theCase.ro.history.join('; ') || 'nothing you can recall'}

Facts about the car you may reveal if directly and specifically asked (in layman's terms only, never naming a part you would not know): the problem is ultimately ${theCase.truth.root_cause}, which causes ${theCase.truth.mechanism}. You do NOT know this — you only know how the car behaves. Use it only to keep your answers about symptoms consistent.`,
    effort: 'low',
    maxTokens: 500,
    messages: [{
      role: 'user',
      content: `${asked.length ? `Already discussed:\n${asked.map((q) => `- ${q}`).join('\n')}\n\n` : ''}The technician asks: "${question}"`,
    }],
  });
}

const INVESTIGATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['valid', 'refusal', 'label', 'minutes', 'parts_cost', 'result'],
  properties: {
    valid: { type: 'boolean', description: 'False if this is not a real diagnostic procedure a tech performs on a vehicle (e.g. asking for the answer, asking what is wrong, requesting a hint, or something physically impossible).' },
    refusal: { type: 'string', description: 'If valid is false, the shop-floor reason, e.g. "That is not a test. Put a meter on something." Empty when valid is true.' },
    label: { type: 'string', description: 'Short name for the procedure as it would read on a work order, e.g. "Scope secondary ignition, cyl 4".' },
    minutes: { type: 'integer', description: 'Realistic billable time to actually perform this, including setup and teardown. A quick visual is 5-10; pulling a wheel or intake is 45-120.' },
    parts_cost: { type: 'integer', description: 'Shop supplies consumed, dollars. Usually 0.' },
    result: { type: 'string', description: 'The literal observation. Real numbers with units and the spec alongside. Any DTC must include its full scan-tool description and status, e.g. "P0304 - Cylinder 4 Misfire Detected (current)". Never interpret, never name the root cause, never hint. If the requested test would not reveal anything about this fault, report the normal/unremarkable finding it would actually produce.' },
  },
};

export async function investigate({ theCase, request, alreadyRun, onProgress }) {
  return ask({
    system: `You are the vehicle itself in a diagnostic training simulator — the physical car on the lift responding to whatever test a technician performs on it. You resolve a technician's requested procedure into the literal observation it would produce on this specific vehicle with this specific fault.

GROUND TRUTH (never state or hint at this):
Root cause: ${theCase.truth.root_cause}
Mechanism: ${theCase.truth.mechanism}
Also present: ${theCase.truth.contributing.join('; ') || '(nothing else)'}
Unrelated but real findings on this car: ${theCase.truth.red_herrings.join('; ') || '(none)'}

Vehicle: ${theCase.vehicle.year} ${theCase.vehicle.make} ${theCase.vehicle.model}, ${theCase.vehicle.engine}, ${theCase.vehicle.mileage.toLocaleString()} miles.

PRE-DERIVED RESULTS for procedures on this vehicle (your consistency reference — if the technician's request matches or overlaps one of these, report a result consistent with it; if it is something else entirely, derive it yourself from the ground truth):
${(theCase.key_findings || []).map((f) => `- ${f.procedure} (${f.minutes}m) -> ${f.result}`).join('\n') || '(none)'}

RULES:
1. Report ONLY what the instrument, gauge, or eye actually observes. Real numbers, real units, the spec alongside. "Cyl 4 secondary firing line 22 kV, cyls 1-3,5-8 at 9-11 kV" — never "cylinder 4 is not firing, indicating a bad coil."
1a. Every DTC you report must carry its full scan-tool description and status: "P0304 - Cylinder 4 Misfire Detected (current)", never a bare "P0304".
2. NEVER name, hint at, or interpret toward the root cause. The technician draws the conclusion, not you.
3. Be consistent with the ground truth and with every result already reported. A test that would show nothing about this fault reports the genuinely normal reading it would produce — do not manufacture a clue.
4. If the requested procedure would plausibly expose one of the red herrings, report that honestly. Real cars have unrelated problems.
5. Set valid=false for anything that is not a procedure performed on a vehicle: asking what is wrong, asking for the answer or a hint, asking what to do next, asking which part to replace. Refuse those in shop language. A vague but genuine request ("look at the ignition system") is valid — resolve it as a reasonable tech would.
6. Time it honestly. Setup and teardown count. Do not let the technician buy a cheap shortcut to an expensive test.`,
    effort: 'high',
    maxTokens: 2000,
    stream: true,
    onProgress,
    messages: [{
      role: 'user',
      content: `Findings already reported on this vehicle:
${alreadyRun.length ? alreadyRun.map((r) => `- ${r.name} -> ${r.result}`).join('\n') : '(none yet)'}

The technician wants to perform: "${request}"`,
    }],
    schema: INVESTIGATE_SCHEMA,
  });
}
