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
  required: ['vehicle', 'ro', 'truth', 'tests', 'customer_persona'],
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
    tests: {
      type: 'array',
      // Structured outputs only accepts minItems 0 or 1, so the 10-16 count is
      // enforced in the prompt and floored below instead.
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'group', 'name', 'minutes', 'parts_cost', 'result'],
        properties: {
          id: { type: 'string' },
          group: { type: 'string', enum: ['Interview', 'Scan', 'Visual', 'Electrical', 'Mechanical', 'Road Test'] },
          name: { type: 'string', description: 'What the tech does, e.g. "Fuel pressure at rail, key on engine running".' },
          minutes: { type: 'integer', description: 'Realistic billable time for this test.' },
          parts_cost: { type: 'integer', description: 'Consumables/shop supplies in dollars, usually 0.' },
          result: { type: 'string', description: 'The literal result the tech observes. Real numbers with units, real code descriptions. Do NOT interpret it, do NOT hint at the answer. Report what the tool says.' },
        },
      },
    },
    customer_persona: { type: 'string', description: 'How this customer talks: helpful, defensive, vague, in a hurry, knows just enough to be dangerous, etc.' },
  },
};

const SYSTEM = `You are the case designer for a professional automotive diagnostic training simulator used by working shop technicians.

You write realistic repair-order scenarios. Absolute rules:

1. GROUND TRUTH FIRST. Decide the actual failure, then derive every symptom, code, and test result from it deterministically. Every test result you write must be exactly what a real scan tool, meter, scope, or gauge would show given that failure. Never write a result that contradicts the root cause.
2. NEVER TELEGRAPH. Test results are raw observations, not conclusions. Write "Fuel pressure 38 psi KOER, spec 55-62 psi" — never "Fuel pressure low, indicating a failing pump." No test result may name or hint at the root cause.
3. RED HERRINGS MUST BE REAL. A red herring is a genuine out-of-spec or ugly finding that is not causing this complaint (a weeping valve cover gasket, a stored history code from a dead battery, a cheap aftermarket part that works fine). Include failures that would show up on a real car of that age and mileage.
4. NUMBERS MUST BE RIGHT. Use real specifications, real DTC numbers with correct descriptions for that make, real live-data PIDs, real resistance and voltage values. If you are not certain of an exact spec, choose a value clearly in or out of range and state the spec alongside it.
5. TEST MENU MUST BE HONEST. Include tests that lead nowhere alongside the ones that matter, so the menu itself is not a hint. Order them naturally, not by usefulness. Include at least one test whose result is completely normal.
6. The customer complaint is written in the customer's own words with their own misunderstandings, not in technical language.`;

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

Provide 10 to 16 tests spanning the groups. The "Interview" group holds questions the tech asks the customer; their results are the customer's spoken answer.${avoidLine}

Build the ground truth first, then write every test result to be consistent with it.`,
    }],
    schema: CASE_SCHEMA,
  });

  if (!Array.isArray(json.tests) || json.tests.length < 6) {
    throw new Error('Case came back with too few tests. Try opening the work order again.');
  }
  json.tests.forEach((t, i) => { if (!t.id) t.id = `t${i}`; });
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

export async function judgeDiagnosis({ theCase, diagnosis, repair, testsRun, onProgress }) {
  const ran = theCase.tests.filter((t) => testsRun.includes(t.id));
  return ask({
    system: `You are a master technician and shop foreman evaluating a tech's diagnosis against known ground truth. You are fair but exacting: a diagnosis is correct only if it identifies the actual failed component or condition. Naming the right system but the wrong part is not correct. If a contributing fault was left unaddressed, the car comes back. Speak like a foreman on the shop floor — direct, no corporate padding, no praise the work didn't earn.`,
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

TESTS THE TECH ACTUALLY RAN (${ran.length} of ${theCase.tests.length}):
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
