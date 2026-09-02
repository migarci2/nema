/**
 * nema provider content: Line Cook Lab.
 *
 * Self contained ES module. No imports, no DOM, no side effects. It is loaded
 * by the browser UI, by the Worker (for re-grading before issuing a receipt)
 * and by the tests, so it must stay pure.
 *
 * Provider origin: https://linecook.migarci2.dev
 * Key id:          linecook-2026-09
 * Unit:            service-under-pressure, "Service Under Pressure"
 *
 * ---------------------------------------------------------------------------
 * Exports
 * ---------------------------------------------------------------------------
 *   MANIFEST            LearningManifest (contract 5.1), unsigned.
 *   ACTIVITIES          { [activityId]: activity }, insertion order = path order.
 *   ACTIVITY_ORDER      [activityId], the canonical order for the UI.
 *   GRADER_VERSION      string, goes into receipt.conditions.graderVersion.
 *   grade(id, submission) -> { result, score, feedback[], claims[] }
 *   checkPrerequisites(statuses) -> { recognized, unlocked, locked, skippable, recommendedFirst }
 *   CONTENT_HASH_INPUT  JSON.stringify(ACTIVITIES), hashed into activity.contentHash.
 *
 * ---------------------------------------------------------------------------
 * Content model (the UI renders straight from these shapes)
 * ---------------------------------------------------------------------------
 * Every activity has:
 *   { id, version, title, type, minutes, difficulty, grader, evidenceProduced,
 *     outcomes: [{ concept, ability, evidenceType }],
 *     skipIf:  [{ concept, ability, status }],      // may be empty
 *     unlock:  [{ concept, ability, minStatus }],   // may be empty
 *     whatTheLearnerDoes,                           // one sentence, plain text
 *     includeReason,                                // why the path keeps it
 *     skipReason,                                   // '' when skipIf is empty
 *     unlockReason,                                 // '' when unlock is empty
 *     lockedReason }                                // '' when unlock is empty
 *
 * The four reason strings are the copy the UI shows and the tools return.
 *   start_activity      -> whatTheLearnerDoes
 *   path panel, kept    -> includeReason
 *   path panel, skipped -> skipReason (render struck through)
 *   path panel, unlocked-> unlockReason ("Prerequisite recognised from another
 *                          provider", the story beat in contract 10)
 *   path panel, locked  -> lockedReason
 * Do not compose these strings in the UI. They live here so the page, the
 * tools and the transcript all say the same thing.
 *
 * ---------------------------------------------------------------------------
 * Rendering rule: exactly one field name means markup
 * ---------------------------------------------------------------------------
 * Only fields literally named `html` hold markup we authored and may be
 * assigned with innerHTML: lesson `sections[].html` and `scenario.html`.
 *
 * EVERY other string in this module is plain text and MUST be rendered with
 * textContent, never innerHTML. That covers trace `content`, `label`, `source`
 * and `why`, fix `label` and `detail`, incident `summary`, `evidence[]`,
 * `rationale`, option `label`, `hints[]`, `keyPoints[]`, lesson `intro`,
 * `whatTheLearnerDoes`, the four reason strings and every string in
 * grade().feedback.
 *
 * This is not a style preference, it is the lab. A service log entry is a
 * stack of timed lines: times, probe readings, batch sizes and depths, one per
 * line. Rendered with innerHTML the line structure collapses into a paragraph
 * and the learner can no longer read a temperature against a clock, which
 * destroys the exercise. Put trace content in an element with
 * `white-space: pre-wrap` (a <pre> or a div with that style) and set
 * textContent.
 *
 * type 'lesson' adds:
 *   lesson: {
 *     intro: string,                                  // one paragraph, plain text
 *     sections: [{ heading, html }],                  // html is safe markup we authored
 *     keyPoints: [string],
 *     exposureClaim: { concept, ability: 'recognize', evidenceType: 'recognition' }
 *   }
 *   Submission: { completed: true } (also accepts { acknowledged: true } or
 *   { read: true }). Result is 'passed' with one exposure claim, or 'failed'.
 *
 * type 'interactive-lab' id 'service-log-audit' adds:
 *   scenario: { html },
 *   trace: [{ id, step, actor: 'ticket'|'cook'|'pass', label, source, content,
 *             untrusted: boolean, why }],
 *          10 entries of one service section, 6 of them station steps taken by
 *          a cook. Exactly 3 of those 6 break a food safety rule. The field is
 *          still called `untrusted` because the protocol, the UI and the
 *          receipts are shared with every other provider; in this unit it
 *          means "unsafe", and only a `cook` entry can carry it.
 *          `label` is the station and the clock time and nothing else, so no
 *          label hints at the answer. `source` names who performed the step
 *          and where it was logged, and is present on every entry, safe and
 *          unsafe alike. `why` is the one sentence verdict. Show it only after
 *          grading; grade() already quotes the relevant ones.
 *   mitigations: [{ id, label, detail, kind: 'effective'|'harmful'|'neutral' }],
 *          the fixes the learner can put in place, 7 options: 3 effective,
 *          2 harmful, 2 neutral. Field names stay `mitigations`,
 *          `effectiveMitigations` and `harmfulMitigations` for the same
 *          shared-shape reason as `untrusted`.
 *   hints: [string],
 *   answerKey: { untrustedIds, effectiveMitigations, harmfulMitigations,
 *                neutralMitigations }
 *   Submission: { untrusted: [traceId], mitigations: [fixId] }
 *   Grading: 'passed' when the unsafe set matches exactly, all 3 effective
 *   fixes are picked and no harmful one is; 'partial' when the unsafe set
 *   matches exactly, at least 2 effective are picked and no harmful one is;
 *   'failed' otherwise. Neutral picks never change the result.
 *
 * type 'interactive-lab' id 'incident-triage' adds:
 *   scenario: { html },
 *   incidents: [{ id, summary, evidence: [string],
 *                 options: [{ id, label }], answerKey: optionId,
 *                 rationale: string }],            // 4 incidents, 4 options each
 *   hints: [string],
 *   answerKey: { [incidentId]: optionId }
 *   Submission: { answers: { [incidentId]: optionId } }
 *   Grading: 4 correct 'passed', 3 correct 'partial', otherwise 'failed'.
 *
 * grade() returns claims only for 'passed' and 'partial'. A 'failed' result
 * returns an empty claims array, so a Worker can never issue a receipt for it.
 * Every claim carries the activity difficulty and the result.
 *
 * ---------------------------------------------------------------------------
 * checkPrerequisites(statuses)
 * ---------------------------------------------------------------------------
 * statuses is a plain object keyed "<concept>|<ability>" with values
 * 'verified' | 'uncertain' | 'missing'. Concept ids may be written with or
 * without the "nema:" prefix; both forms are matched. Anything absent or
 * unrecognised is treated as 'missing'.
 *
 * Returns:
 *   {
 *     recognized:  [{ concept, ability, status }],        // the unit requirements
 *     unlocked:    [activityId],                          // unlock satisfied
 *     locked:      [{ activityId, missing: [{ concept, ability, needed }] }],
 *     skippable:   [activityId],                          // skipIf satisfied
 *     recommendedFirst: activityId | null                 // first unlocked, not skippable
 *   }
 *
 * Satisfaction rule (contract 5.1): 'verified' satisfies 'verified';
 * 'verified' or 'uncertain' satisfies 'uncertain'.
 */

export const PROVIDER = {
  origin: 'https://linecook.migarci2.dev',
  name: 'Line Cook Lab',
  keyId: 'linecook-2026-09'
};

export const GRADER_VERSION = '1';

const UNIT_VERSION = '1.0.0';

/* ------------------------------------------------------------------------- */
/* Lessons                                                                    */
/* ------------------------------------------------------------------------- */

const MISE_EN_PLACE_LESSON = {
  intro:
    'Mise en place is not tidiness. It is the decision, taken before the first ticket, about where every single thing you will need is going to be and how much of it there will be. A station that is set correctly lets you cook. A station that is not set turns the whole service into fetching, and fetching is where the mistakes live.',
  sections: [
    {
      heading: 'The station is the plan',
      html:
        '<p>Set your station so that the things you touch most are the things you reach first, and so that nothing makes you turn your back on the pass. Proteins go in the low boy on your weak hand side, portioned and stacked in the order the menu fires. Sauces sit in the bain marie on the strong hand side. Garnish, herbs and finishing salt go in the top rail at eye level, in the same slot every service, because you will be reaching for them without looking.</p>' +
        '<p>Two things live within a hand span of the board no matter what: a sanitiser bucket with a folded towel in it, and a dry towel for pans. Two towels, two jobs, never swapped. The bucket runs at 200 to 400 ppm for a quaternary ammonium sanitiser or 50 to 100 ppm for chlorine, checked with a test strip when you make it up and remade when the water is cloudy or cold.</p>' +
        '<p>Write the station down once and photograph it. A new commis should be able to work your station from the photograph, and you should be able to tell in one glance what is missing.</p>'
    },
    {
      heading: 'Par levels come from the numbers, not from a feeling',
      html:
        '<p>A par level is how much of an item you set up before service. Take it from the book and the mix, not from how busy last Saturday felt. Sixty covers with a thirty percent take rate on the chicken is eighteen portions, plus a buffer of about twenty percent for walk ins and refires, so twenty two portions on the station and the rest broken down but held back.</p>' +
        '<p>Portion by weight, not by eye: 160 g of protein, 90 g of garnish, a 60 ml ladle for the sauce. Written portions are what make the dish the same at 19:00 and at 22:30, and they are the only way a food cost sits still. Weigh the first three of anything, then trust your hands and re-check every twentieth.</p>' +
        '<p>Label everything you make with the product, the date, the time it was made, your initials and the use by date. Rotate first in first out, and put the older container in front so that laziness works in your favour.</p>'
    },
    {
      heading: 'Reset between covers',
      html:
        '<p>Mise en place is not finished when service starts, it is maintained through service. Every time a ticket clears, the board gets scraped and wiped with the sanitiser towel, the pans that are done go to the wash rather than back on the shelf, and the rail gets topped up from the backup in the low boy while there is a gap. A cook who tops up at 19:30 has a quiet 21:00. A cook who waits until the rail is empty at 21:00 stops cooking to go shopping in the middle of the rush.</p>' +
        '<p>Keep a running note of what you take from the walk in, because that note is tomorrow morning prep list and it is the difference between prepping what is needed and prepping what you remember. At the end of service the station is broken down, wrapped, labelled, dated and put away cold before anything else, and only then does it get cleaned.</p>'
    }
  ],
  keyPoints: [
    'Set the station by reach: most used items closest, nothing behind you.',
    'Two towels, two jobs. The sanitiser towel lives in the bucket, the pan towel stays dry.',
    'Par levels come from covers times take rate plus about twenty percent, not from memory.',
    'Portion by weight so the dish is the same at 19:00 and at 22:30.',
    'Label with product, date, time, initials and use by, and rotate first in first out.'
  ],
  exposureClaim: { concept: 'nema:mise-en-place', ability: 'recognize', evidenceType: 'recognition' }
};

const FOOD_SAFETY_LESSON = {
  intro:
    'Almost every food safety rule in a professional kitchen is one of three things: keep food out of the temperature range where bacteria multiply, stop raw food touching anything that will be eaten as it is, and make sure the plate that goes to an allergic guest contains only what the ticket says. The rules are short. The failures are almost always a moment of speed on a busy Saturday.',
  sections: [
    {
      heading: 'The danger zone, 5 to 63 C',
      html:
        '<p>Between 5 and 63 C bacteria multiply, fastest of all between about 20 and 45 C where a single cell can become two every twenty minutes. So cold food is held at or below 5 C and hot food at or above 63 C, and anything that has to sit between those two numbers sits there on a clock. Once food leaves temperature control, four hours is the outside limit before it is thrown away, and that clock is cumulative across the day, not reset every time the tray goes back in the fridge.</p>' +
        '<p>Cooking is a pair of numbers, a temperature and a time held at it, not a single number. For poultry, mince, rolled joints and reheated food the reference cook is 75 C for 30 seconds in the thickest part. The equivalents are 70 C for 2 minutes, 65 C for 10 minutes and 60 C for 45 minutes. This is why a breast that probes 60 C after seven minutes on the grill is not cooked: it has the temperature for a moment and nothing like the time.</p>' +
        '<p>Probe the thickest part, wait for the reading to settle, and sanitise the probe between pieces. Calibrate it in iced water at 0 C and in boiling water at 100 C, weekly and after every time it hits the floor, and retire it when it drifts more than 1 C.</p>'
    },
    {
      heading: 'Cooling is the step that gets people ill',
      html:
        '<p>More outbreaks come from bad cooling than from bad cooking. Hot food has to move through the danger zone quickly, and a stockpot in a walk in does the opposite: it warms the whole fridge and stays warm in the middle for hours. Two stage cooling is the standard to work to. Get from 60 C down to 21 C within two hours, then from 21 C to 5 C within a further four hours. Six hours total, and both legs get probed, not guessed.</p>' +
        '<p>To make that happen, cut the depth. Move the stock into gastronorms no more than 5 cm deep, put an ice paddle or a frozen bottle in each, sit them in an ice bath or a blast chiller, and leave them uncovered until they are cold. Break large joints down before chilling, and stir liquids every twenty minutes. Cover, label and date once the food is at 5 C, and never stack hot containers on top of each other.</p>' +
        '<p>Reheating is a cook, not a warm up: back to 75 C for 30 seconds all the way through, once. Food that has already been reheated goes in the bin.</p>'
    },
    {
      heading: 'Boards, cloths and the fourteen allergens',
      html:
        '<p>Colour coded boards exist so that a decision made in a hurry is still the right one. Red for raw meat, blue for raw fish, yellow for cooked meat, green for salad and fruit, brown for vegetables, white for bakery and dairy. One board, one task, then the board and the knife go to the wash. A wipe with a service towel is not cleaning: it spreads campylobacter and salmonella across the board and onto the towel, and the towel then travels. Wash hands at the dedicated basin for twenty seconds with soap and hot water after handling raw protein, after the bin, and before touching anything ready to eat.</p>' +
        '<p>Fourteen allergens have to be declared: cereals containing gluten, crustaceans, eggs, fish, peanuts, soybeans, milk, tree nuts, celery, mustard, sesame, sulphur dioxide and sulphites above 10 mg per kg, lupin and molluscs. An allergen order is not a preference and it is not a level of risk you get to judge. Cooking does not destroy an allergenic protein, a rinse does not remove it, and traces are enough: for a peanut or a shellfish allergy the amount that fits on a spoon has put people in intensive care.</p>' +
        '<p>Work allergen tickets on a dedicated station: its own board, its own utensils, a clean pan, freshly washed hands, ingredients taken from a sealed or dedicated container rather than the open mise. Call the allergen plate separately at the pass, carry it separately, and hand it to the guest by seat number rather than sliding it onto the table with the rest.</p>'
    }
  ],
  keyPoints: [
    'Cold at or below 5 C, hot at or above 63 C, and a four hour cumulative clock in between.',
    'A cook is a temperature and a time: 75 C for 30 seconds, or 70 C for 2 minutes, or 65 C for 10.',
    'Two stage cooling: 60 to 21 C in two hours, 21 to 5 C in four more, in pans no deeper than 5 cm.',
    'One board, one task, then the wash. Wiping a board with a service towel spreads what was on it.',
    'Allergen orders get their own station, utensils and pan, because heat and rinsing do not remove the protein.'
  ],
  exposureClaim: { concept: 'nema:food-safety', ability: 'recognize', evidenceType: 'recognition' }
};

const HEAT_CONTROL_LESSON = {
  intro:
    'During service, heat control is recovery control. Every cold portion, crowded pan and lifted lid changes the cooking surface, and the useful question is not where the dial sits but what the pan is doing now.',
  sections: [
    {
      heading: 'Recover before the next portion',
      html:
        '<p>A pan loses heat when food lands in it. Give it time to recover between batches and leave space for steam to escape. If the sizzle collapses into a wet hiss, stop adding food: the surface has fallen towards the boiling point of water and the station is steaming instead of browning.</p>' +
        '<p>Use the smallest batch that lets the pan recover before the next ticket. A heavy pan stores more energy, but it still needs time. Wiping out burnt fat and reheating a clean film of oil is faster than carrying bitter fond through the rest of service.</p>'
    },
    {
      heading: 'Read the pan, not the knob',
      html:
        '<p>Sound, steam and colour are faster than a dial. A steady sharp sizzle means moisture is leaving and the surface is hot enough to brown. Pools of liquid mean crowding. Smoke before colour means the pan or the fat is too hot.</p>' +
        '<p>Move the pan as well as the knob. Pull it half off the flame to slow a reduction, lift it completely to mount butter, and return it only when the surface has settled. The burner changes input; the pan tells you the result.</p>'
    },
    {
      heading: 'Hold without continuing to cook',
      html:
        '<p>The pass is a holding problem. Protein keeps climbing after it leaves the pan, fried food softens under a tight cover, and a butter emulsion can split above about 90 C. Rest meat, vent crisp food and hold mounted sauces warm rather than simmering.</p>' +
        '<p>When a ticket stalls, name a ceiling and a clock. A sauce can sit near 65 C for a short hold; it cannot sit over a live flame indefinitely. If quality has crossed the ceiling, remake it instead of hiding the damage.</p>'
    }
  ],
  keyPoints: [
    'Let the pan recover between batches and leave room for steam to escape.',
    'Sound, steam and colour describe the surface better than the burner dial.',
    'Move the pan off the flame when reducing or mounting needs to slow down.',
    'Hold mounted sauces warm, near 65 C, rather than simmering them.'
  ],
  exposureClaim: { concept: 'nema:heat-control', ability: 'recognize', evidenceType: 'recognition' }
};

const PAN_SAUCE_SERVICE_LESSON = {
  intro:
    'A pan sauce survives service when the station treats it as a sequence, not a last minute improvisation: preserve the fond, dissolve it, reduce the liquid, mount off the heat and hold only as long as the emulsion stays sound.',
  sections: [
    {
      heading: 'Build from what the pan left behind',
      html:
        '<p>Pour off excess fat and keep the brown fond. Deglaze with wine, stock or water while the pan is hot enough to release it, then scrape every useful brown patch into the liquid. Black patches are burnt and should not be rescued.</p>' +
        '<p>Reduce before enrichment. The reduced stock supplies flavour and gelatin; cold butter supplies fat, water and milk solids. If the liquid is still thin when the butter goes in, the cook will be tempted to boil the finished sauce and split it.</p>'
    },
    {
      heading: 'Mount for the pass',
      html:
        '<p>Take the pan off the flame and swirl in cold butter a few cubes at a time. The movement breaks the fat into droplets while the butter milk solids help keep those droplets apart. Stop when the sauce coats a spoon and still moves freely.</p>' +
        '<p>Season after mounting. Reduction concentrates salt, so seasoning early can make the final sauce harsh. A few drops of acid at the end make a rich sauce readable without thinning it back into stock.</p>'
    },
    {
      heading: 'Know when to rescue and when to remake',
      html:
        '<p>A sauce that is merely too thick can be loosened with warm water. A sauce beginning to look oily may come back with a spoon of cold water and gentle whisking off the heat. A sauce boiled into separate pools of fat has crossed the useful line.</p>' +
        '<p>For a long service, hold the reduction and mount small batches to order. That keeps the fragile emulsion out of the bain marie until the ticket needs it and makes the fastest rescue a fresh finish, not a larger batch of damage.</p>'
    }
  ],
  keyPoints: [
    'Fond, deglaze, reduce, mount and adjust is the sequence.',
    'Reduce before butter so the finished emulsion never needs to boil.',
    'Mount cold butter off the flame and season only after reduction.',
    'For long service, hold the reduction and mount small batches to order.'
  ],
  exposureClaim: { concept: 'nema:pan-sauces', ability: 'recognize', evidenceType: 'recognition' }
};

/* ------------------------------------------------------------------------- */
/* Lab 1: service-log-audit                                                   */
/* ------------------------------------------------------------------------- */

const SERVICE_LOG = [
  {
    id: 's1',
    step: 1,
    actor: 'ticket',
    label: 'Table 12, 19:04',
    source: 'The kitchen display system, sent from the dining room terminal',
    content:
      '2x chicken paillard\n' +
      '1x asparagus, hollandaise\n' +
      '1x garden salad\n' +
      'No allergy flagged on this ticket.',
    untrusted: false,
    why: 'a ticket records what the guests asked for, it is not work anybody performed at a station'
  },
  {
    id: 's2',
    step: 2,
    actor: 'pass',
    label: 'Expo call, 19:04',
    source: 'The expeditor at the pass',
    content:
      'Ordering table 12: two chicken, one asparagus, one salad.\n' +
      'Grill on the chicken, sauce on the hollandaise, larder on the salad.\n' +
      'All away together, fourteen minutes.',
    untrusted: false,
    why: 'the pass allocated the work and set the timing, and neither of those touches food'
  },
  {
    id: 's3',
    step: 3,
    actor: 'cook',
    label: 'Grill station, 19:06',
    source: 'Commis on grill, logged at the station terminal',
    content:
      'Two chicken breasts butterflied and beaten to 1 cm on the red board.\n' +
      'Board and knife sent straight to the pot wash, fresh red board taken from the rack.\n' +
      'Hands washed at the dedicated basin, twenty seconds, soap and hot water.\n' +
      'Breasts on the grill at 19:06.',
    untrusted: false,
    why: 'raw poultry stayed on the red board, the board left for the wash rather than being reused, and hands were washed before anything else was touched'
  },
  {
    id: 's4',
    step: 4,
    actor: 'cook',
    label: 'Larder station, 19:09',
    source: 'Commis on larder, logged at the station terminal',
    content:
      'Red board from the rail wiped down with the service towel and used for the garden salad.\n' +
      'Gem leaves, tomato and cucumber cut on it, salad built straight from that board.\n' +
      'Board wiped again and put back on the rail.',
    untrusted: true,
    why: 'a dry wipe moves campylobacter and salmonella around instead of removing them, and a salad is served raw, so nothing downstream ever gets hot enough to kill what the board left behind'
  },
  {
    id: 's5',
    step: 5,
    actor: 'ticket',
    label: 'Table 9, 19:11',
    source: 'The kitchen display system, sent from the dining room terminal',
    content:
      '1x asparagus, hollandaise\n' +
      '1x garden salad\n' +
      'TREE NUT ALLERGY, seat 2. Confirmed with the guest by the floor manager.',
    untrusted: false,
    why: 'the ticket carried the allergy declaration correctly, which is exactly what a ticket is for'
  },
  {
    id: 's6',
    step: 6,
    actor: 'cook',
    label: 'Sauce station, 19:12',
    source: 'Saucier, logged at the station terminal',
    content:
      'Hollandaise from the pre service batch made at 17:10: 6 yolks, 30 ml reduction, 250 g clarified butter.\n' +
      'Held in the bain marie on the shelf over the pass. Bain switched off at 17:20 to stop the sauce splitting.\n' +
      'Sauce probed now at 24 C. Spooned over both asparagus plates.',
    untrusted: true,
    why: 'an egg yolk emulsion sat two hours between 5 and 63 C with the heat off, which is the exact condition salmonella needs, and a hollandaise cannot be reheated to put that right'
  },
  {
    id: 's7',
    step: 7,
    actor: 'cook',
    label: 'Grill station, 19:14',
    source: 'Commis on grill, logged at the station terminal',
    content:
      'Probe into the thickest part of each breast: 76.2 C and 75.4 C, readings held for 30 seconds.\n' +
      'Probe wiped and sanitised between the two.\n' +
      'Rested two minutes, plated on hot plates.',
    untrusted: false,
    why: '75 C held for 30 seconds is the reference cook for poultry, and sanitising the probe between pieces stopped it carrying raw juices into a cooked breast'
  },
  {
    id: 's8',
    step: 8,
    actor: 'cook',
    label: 'Larder station, 19:15',
    source: 'Commis on larder, logged at the station terminal',
    content:
      'Table 9 salad dressed with the dressing spoon kept in the mise container.\n' +
      'Same spoon dressed the walnut and blue cheese salad two tickets earlier.\n' +
      'Plate sent under a normal cloche, no separate call at the pass.',
    untrusted: true,
    why: 'walnut protein transfers on the spoon, heat and rinsing do not destroy it, and a trace is enough to put a tree nut allergic guest into anaphylaxis'
  },
  {
    id: 's9',
    step: 9,
    actor: 'cook',
    label: 'Stock station, 19:20',
    source: 'Chef de partie, logged at the station terminal',
    content:
      'Chicken stock pulled at 18:30 at 82 C, strained into two gastronorms 4 cm deep, ice paddle in each, uncovered in the blast chiller.\n' +
      'Probed 21 C at 19:20, fifty minutes in. Moving to the walk in to finish, target 5 C by 23:20.\n' +
      'Labelled: chicken stock, made 2026-09-02 18:30, JR, use by 2026-09-04.',
    untrusted: false,
    why: 'two stage cooling asks for 60 to 21 C inside two hours and 21 to 5 C inside four more, and shallow pans, ice paddles and a probed reading show both legs on track'
  },
  {
    id: 's10',
    step: 10,
    actor: 'pass',
    label: 'Expo call, 19:21',
    source: 'The expeditor at the pass',
    content:
      'Table 12 away complete 19:21, seventeen minutes on the ticket.\n' +
      'Table 9 away 19:22, eleven minutes.\n' +
      'Both inside the twenty minute target for the section.',
    untrusted: false,
    why: 'the pass only recorded what left the kitchen, and every decision that made those plates unsafe was taken earlier at a station'
  }
];

const SERVICE_LOG_FIXES = [
  {
    id: 'f-colour-coded-boards',
    label: 'One colour coded board per task, straight to the wash after raw protein',
    kind: 'effective',
    detail:
      'Red for raw meat, blue for raw fish, yellow for cooked meat, green for salad and fruit, brown for vegetables, white for bakery and dairy, with enough boards racked that nobody has to choose between the right board and a fast one. The rule that makes it work is the second half: after raw protein the board and the knife go to the pot wash, not back on the rail. Wiping is not cleaning, and the towel that did the wiping is now carrying the same bacteria to the next surface it touches.'
  },
  {
    id: 'f-hold-or-remake-sauce',
    label: 'Hold emulsified sauces above 63 C, or work in small batches and remake every hour',
    kind: 'effective',
    detail:
      'Pick one of the two and write it on the station. Either the sauce sits in a thermostatically controlled bain at 63 to 65 C, loosened with a spoon of warm water so the emulsion survives the heat and probed at every check, or it is made in thirty to sixty minute batches, timed on a clock, poured away on the hour and the pan sent to the wash. What is not allowed is the middle option this service used: a warm sauce with the heat switched off and nobody holding the clock.'
  },
  {
    id: 'f-allergen-station',
    label: 'A dedicated allergen station with its own board, utensils and pans',
    kind: 'effective',
    detail:
      'One shelf, one purple board, its own tongs, spoons and pan, and ingredients taken from sealed or dedicated containers rather than the open mise. Freshly washed hands before it is touched, the plate called separately at the pass, carried separately and handed to the guest by seat number. This removes the decision from the moment of pressure: there is no shared spoon within reach of the allergen plate, so a tired commis cannot reach for one.'
  },
  {
    id: 'f-rinse-the-chicken',
    label: 'Rinse the chicken under the tap before it goes on the grill',
    kind: 'harmful',
    detail:
      'Harmful. Rinsing does not meaningfully reduce campylobacter on the bird, and it aerosolises it up to about half a metre around the sink, onto taps, cloths, hands and any ready to eat food nearby. The only thing that makes chicken safe is the cook: 75 C for 30 seconds in the thickest part. This one also feels like diligence, which is why it survives in kitchens that have already been told.'
  },
  {
    id: 'f-boil-the-sauce',
    label: 'Bring the held hollandaise up to a boil to make it safe',
    kind: 'harmful',
    detail:
      'Harmful. Boiling scrambles the yolks and breaks the emulsion, so you lose the sauce, and it does not undo the two hours. Heat kills vegetative bacteria but not the heat stable enterotoxin Staphylococcus aureus produces while a hand whisked sauce sits warm, and hands are the classic route for S. aureus into that sauce. It ends with a broken sauce, a hazard that is still there, and a station that believes the problem was handled.'
  },
  {
    id: 'f-better-probes',
    label: 'Buy a new probe thermometer for every station',
    kind: 'neutral',
    detail:
      'Neutral. Calibrated probes are worth having, checked in iced water at 0 C and boiling water at 100 C weekly and after every drop, retired past 1 C of drift. But a better probe changes nothing about a board that was wiped instead of washed, or a sauce nobody put a clock on. A probe measures, it does not decide, and the three unsafe steps in this log were all decisions.'
  },
  {
    id: 'f-end-of-service-log',
    label: 'Add a temperature log sheet at the pass and fill it in at the end of service',
    kind: 'neutral',
    detail:
      'Neutral for prevention, useful for everything after. Records are how you find a pattern, and how you show an environmental health officer what the kitchen actually does. A sheet filled in at 23:30 from memory is a reconstruction rather than a check, and nothing written on it at 23:30 stopped the salad leaving at 19:09. Keep the sheet, but log at the moment of the check.'
  }
];

const SERVICE_LOG_LAB = {
  scenario: {
    html:
      '<p>One section of a Saturday service is logged below: ten entries from the kitchen display system, from the first ticket to the last plate away. Six of them are work a cook actually did at a station. The rest are tickets from the dining room and calls from the pass.</p>' +
      '<p>Two tasks. First, mark every station step that breaks a food safety rule, whether or not the plate that came out of it looked right. The rule decides this, not the plate: a step can send out a beautiful dish and still be the one that puts a guest in hospital. Every entry names the station, the clock time and who logged it. Second, choose the fixes you would actually put in place tomorrow. Some options on that list would make the kitchen worse.</p>'
  },
  trace: SERVICE_LOG,
  mitigations: SERVICE_LOG_FIXES,
  hints: [
    'Read each station step against a rule you can state out loud. If you cannot name the rule it breaks, it is not a finding.',
    'The safe steps are the same jobs done properly, so the tell is in the numbers: the times, the probe readings and the depth of the pans.',
    'A fix that asks the line to be more careful is not a fix. Look for the ones that change what is physically within reach of the station.'
  ],
  answerKey: {
    untrustedIds: ['s4', 's6', 's8'],
    effectiveMitigations: ['f-colour-coded-boards', 'f-hold-or-remake-sauce', 'f-allergen-station'],
    harmfulMitigations: ['f-rinse-the-chicken', 'f-boil-the-sauce'],
    neutralMitigations: ['f-better-probes', 'f-end-of-service-log']
  }
};

/* ------------------------------------------------------------------------- */
/* Lab 2: incident-triage                                                     */
/* ------------------------------------------------------------------------- */

const TRIAGE_INCIDENTS = [
  {
    id: 'inc-1',
    summary: 'The beurre blanc for four plates on the pass has split, and a table of eight is ordering behind it.',
    evidence: [
      '19:48 Sauce probed at 71 C on the corner of the flat top. Oily, separated, no longer coating the back of a spoon.',
      'Made at 19:31 from a 60 ml white wine and shallot reduction with 200 g of cold cubed butter mounted off the heat.',
      'A butter emulsion breaks above roughly 58 C, and this one has been pushed well past that.',
      'The sauce has been at or above 63 C since it was made, so it never entered the danger zone, and nothing raw has touched it since mounting.',
      'There is cold butter in the low boy, a clean pan and about ninety seconds before the plates have to leave.'
    ],
    options: [
      {
        id: 'inc-1-rescue',
        label:
          'Rescue and continue: off the heat, whisk 20 ml of cold cream or cold water in a clean pan, then mount the broken sauce into that base a ladle at a time.'
      },
      {
        id: 'inc-1-reprobe',
        label: 'Cook further and re probe: put it back on the flat top, hold it at 63 C and keep whisking until it comes together.'
      },
      {
        id: 'inc-1-stop',
        label: 'Stop, tell the chef and remake: pull the plates, tell the chef they are late, and start a new reduction from scratch.'
      },
      {
        id: 'inc-1-discard',
        label: 'Discard and log: bin the sauce as a food safety incident and record it in the corrective action log.'
      }
    ],
    answerKey: 'inc-1-rescue',
    rationale:
      'A split emulsion is a technique fault, not a safety fault. The sauce never left temperature control and nothing unsafe went into it, so there is nothing to log and nothing to bin. It broke because it got too hot, which is exactly why more heat is the wrong answer: a fresh cold base drops the temperature and gives the butterfat somewhere to disperse, and the sauce comes back in under a minute. A new reduction costs six minutes nobody has.'
  },
  {
    id: 'inc-2',
    summary: 'Two chicken breasts on the pass probe at 60 C in the thickest part, and both plates are already garnished.',
    evidence: [
      '20:12 Probe into the thickest part of each breast: 60.4 C and 60.1 C. The probe was calibrated this morning at 0.2 C in iced water.',
      'The breasts went on the grill at 20:05 and were rested for one minute, so they have been near 60 C for under two minutes.',
      '60 C is a legal cook only when the food is held there for 45 minutes. The reference is 75 C for 30 seconds.',
      'Carry over in a rested breast on a cold plate is a degree or two, nowhere near the gap.',
      'Nothing has left the kitchen. The grill has space and the salamander is hot.'
    ],
    options: [
      {
        id: 'inc-2-reprobe',
        label: 'Cook further and re probe: back on the heat, finish through, and probe the thickest part again until it holds 75 C for 30 seconds.'
      },
      {
        id: 'inc-2-rescue',
        label: 'Rescue and continue: rest them under foil for five minutes and let carry over heat finish the job.'
      },
      {
        id: 'inc-2-stop',
        label: 'Stop, tell the chef and remake: scrape the plates, fire two new breasts and tell the chef the table is delayed.'
      },
      {
        id: 'inc-2-discard',
        label: 'Discard and log: treat undercooked poultry as a food safety incident, bin both breasts and record it.'
      }
    ],
    answerKey: 'inc-2-reprobe',
    rationale:
      'Undercooked chicken that never left the kitchen is not an incident, it is chicken that needs more time. A cook is a temperature and a time held at it, and these have neither, so put them back and probe again. Waiting for carry over gambles a degree or two against a fifteen degree gap. Refiring costs the table eight minutes and two portions for nothing, and binning food that is one minute from being perfectly safe is waste dressed up as caution.'
  },
  {
    id: 'inc-3',
    summary: 'A shellfish allergy plate is on the pass and the commis cannot say whether the tongs that plated it had been in the mussel pan.',
    evidence: [
      'Ticket 214, table 6, seat 3: SHELLFISH ALLERGY, confirmed by the floor manager, guest carries an adrenaline auto injector.',
      'The commis took tongs from the rail rather than the allergen station set. The mussel pan was worked with tongs from the same rail earlier in service.',
      'The rail holds four identical pairs and nobody can say which pair was which.',
      'Cooking does not destroy shellfish tropomyosin, and a rinse or a wipe does not reliably remove it.',
      'The plate has not left the pass. A remake on the allergen station is a six minute delay.'
    ],
    options: [
      {
        id: 'inc-3-stop',
        label:
          'Stop, tell the chef and remake: pull the plate, tell the chef so the floor can speak to the guest, and rebuild it on the allergen station with clean utensils and a clean pan.'
      },
      {
        id: 'inc-3-rescue',
        label: 'Rescue and continue: swap the garnish, wipe the rim, and send the plate with a word to the waiter.'
      },
      {
        id: 'inc-3-reprobe',
        label: 'Cook further and re probe: put the protein back on the heat, take it through 75 C and send it.'
      },
      {
        id: 'inc-3-discard',
        label: 'Discard and log: bin the plate, write up the near miss, and take the dish off the menu for the rest of service.'
      }
    ],
    answerKey: 'inc-3-stop',
    rationale:
      'Allergen calls are decided on certainty, not on likelihood. Nobody can say the tongs were clean and there is no check on the pass that could settle it, so the plate is treated as contaminated. Heat does not denature tropomyosin into something safe and a wipe moves protein rather than removing it, so both the rescue and the re cook answer the wrong question. Binning the plate is half right, but stopping at the bin leaves the chef and the floor uninformed and pulls a dish that is fine for every other table.'
  },
  {
    id: 'inc-4',
    summary: 'The walk in display has read 8 C since the morning delivery, and the probe readings inside the food are worse.',
    evidence: [
      'Walk in air temperature logged at 8 C at 06:00, 10:00, 14:00 and 18:00. The set point is 3 C.',
      '18:05 Probe into the centre of the cooked chicken, the creme patissiere and the opened cured ham: 11 C, 12 C and 11 C.',
      'That is twelve hours of ready to eat, high risk food above 5 C, measured in the product rather than in the air.',
      'The refrigeration engineer has been called. The blast chiller and a second walk in are both working and have space.',
      'Nothing from this walk in has gone out to a guest tonight.'
    ],
    options: [
      {
        id: 'inc-4-discard',
        label:
          'Discard and log: bin the high risk ready to eat stock, write down the readings and the disposal, move what is still sound into the working walk in, and keep the unit out of service until the engineer signs it off.'
      },
      {
        id: 'inc-4-rescue',
        label: 'Rescue and continue: move everything into the working walk in, let it pull back down to 3 C and carry on with it.'
      },
      {
        id: 'inc-4-reprobe',
        label: 'Cook further and re probe: cook the high risk items through to 75 C tonight and serve them.'
      },
      {
        id: 'inc-4-stop',
        label: 'Stop, tell the chef and remake: hold every dish that uses this walk in until the chef has decided what to do.'
      }
    ],
    answerKey: 'inc-4-discard',
    rationale:
      'Twelve hours at 11 C in the product is not a borderline call. Cold holding runs at or below 5 C as good practice, and these readings are not air temperatures that a door opening could explain. Ready to eat, high risk food that has spent a working day there goes in the bin, with the readings and the disposal written down, because that record is what the environmental health officer and your own root cause both need. Chilling it back down hides the history without undoing it, and cooking to 75 C kills vegetative bacteria while leaving any heat stable toxin behind. Telling the chef is right and it is already happening, but on its own it is a delay rather than a decision.'
  }
];

const TRIAGE_LAB = {
  scenario: {
    html:
      '<p>You are running the pass on a Saturday night. Four things have gone wrong in the last half hour and each one is waiting on you, with the evidence the kitchen actually has and nothing more.</p>' +
      '<p>Pick one action per incident. Over reacting costs something real: a remake is six minutes and a table waiting, and a kitchen that bins food every time something looks odd stops telling you when something looks odd.</p>'
  },
  incidents: TRIAGE_INCIDENTS,
  hints: [
    'Two questions settle most of these: has anything reached a guest, and is this a technique fault or a safety fault.',
    'A sauce that broke is a technique fault. Time spent in the danger zone is not, and no amount of heat afterwards undoes it.',
    'Allergens are decided on certainty. If nobody can say the utensil was clean, then for this plate it was not.'
  ],
  answerKey: TRIAGE_INCIDENTS.reduce((acc, incident) => {
    acc[incident.id] = incident.answerKey;
    return acc;
  }, {})
};

/* ------------------------------------------------------------------------- */
/* Activities                                                                 */
/* ------------------------------------------------------------------------- */

export const ACTIVITIES = {
  'mise-en-place-intro': {
    id: 'mise-en-place-intro',
    version: UNIT_VERSION,
    title: 'Setting a station you can cook from',
    type: 'lesson',
    minutes: 7,
    difficulty: 'introductory',
    grader: 'exposure',
    evidenceProduced: 'recognition',
    outcomes: [{ concept: 'nema:mise-en-place', ability: 'recognize', evidenceType: 'recognition' }],
    skipIf: [{ concept: 'nema:mise-en-place', ability: 'explain', status: 'verified' }],
    unlock: [],
    whatTheLearnerDoes: 'Reads three short sections and marks the lesson complete.',
    includeReason: 'Included: no verified evidence that you can explain mise en place.',
    skipReason: 'Skipped: your vault already proves you can explain mise en place.',
    unlockReason: '',
    lockedReason: '',
    lesson: MISE_EN_PLACE_LESSON
  },
  'food-safety-intro': {
    id: 'food-safety-intro',
    version: UNIT_VERSION,
    title: 'The danger zone, cooling and allergens',
    type: 'lesson',
    minutes: 9,
    difficulty: 'introductory',
    grader: 'exposure',
    evidenceProduced: 'recognition',
    outcomes: [{ concept: 'nema:food-safety', ability: 'recognize', evidenceType: 'recognition' }],
    skipIf: [{ concept: 'nema:food-safety', ability: 'apply', status: 'verified' }],
    unlock: [],
    whatTheLearnerDoes: 'Reads three short sections and marks the lesson complete.',
    includeReason: 'Included: no verified evidence that you can apply food safety.',
    skipReason: 'Skipped: your vault already proves you can apply food safety.',
    unlockReason: '',
    lockedReason: '',
    lesson: FOOD_SAFETY_LESSON
  },
  'heat-control-on-the-line': {
    id: 'heat-control-on-the-line',
    version: UNIT_VERSION,
    title: 'Heat control when tickets land',
    type: 'lesson',
    minutes: 6,
    difficulty: 'introductory',
    grader: 'exposure',
    evidenceProduced: 'recognition',
    outcomes: [{ concept: 'nema:heat-control', ability: 'recognize', evidenceType: 'recognition' }],
    skipIf: [{ concept: 'nema:heat-control', ability: 'recognize', status: 'uncertain' }],
    unlock: [],
    whatTheLearnerDoes: 'Reads how a busy station recovers, reads the pan and holds food without overcooking it.',
    includeReason: 'Included: nema has no record that you already covered heat control.',
    skipReason: 'Done via nema: your vault already records this heat control lesson from another course.',
    unlockReason: '',
    lockedReason: '',
    lesson: HEAT_CONTROL_LESSON
  },
  'pan-sauces-during-service': {
    id: 'pan-sauces-during-service',
    version: UNIT_VERSION,
    title: 'Pan sauces during service',
    type: 'lesson',
    minutes: 6,
    difficulty: 'intermediate',
    grader: 'exposure',
    evidenceProduced: 'recognition',
    outcomes: [{ concept: 'nema:pan-sauces', ability: 'recognize', evidenceType: 'recognition' }],
    skipIf: [{ concept: 'nema:pan-sauces', ability: 'recognize', status: 'uncertain' }],
    unlock: [],
    whatTheLearnerDoes: 'Reads how to build, hold and rescue a pan sauce through a live service.',
    includeReason: 'Included: nema has no record that you already covered pan sauces.',
    skipReason: 'Done via nema: your vault already records this pan sauce lesson from another course.',
    unlockReason: '',
    lockedReason: '',
    lesson: PAN_SAUCE_SERVICE_LESSON
  },
  'service-log-audit': {
    id: 'service-log-audit',
    version: UNIT_VERSION,
    title: 'Audit a service log',
    type: 'interactive-lab',
    minutes: 12,
    difficulty: 'intermediate',
    grader: 'deterministic',
    evidenceProduced: 'application',
    outcomes: [
      { concept: 'nema:food-safety', ability: 'apply', evidenceType: 'application' },
      { concept: 'nema:cross-contamination', ability: 'discriminate', evidenceType: 'discrimination' }
    ],
    skipIf: [],
    unlock: [{ concept: 'nema:emulsions', ability: 'explain', minStatus: 'uncertain' }],
    whatTheLearnerDoes:
      'Marks which station steps in a ten entry service log break a food safety rule, then picks the fixes worth putting in place.',
    includeReason: 'Included: this lab is where the unit outcome is earned.',
    skipReason: '',
    unlockReason: 'Unlocked. Prerequisite recognised from another provider.',
    lockedReason: 'Locked: needs evidence that you can explain emulsions, at least uncertain.',
    ...SERVICE_LOG_LAB
  },
  'incident-triage': {
    id: 'incident-triage',
    version: UNIT_VERSION,
    title: 'Triage four incidents on the pass',
    type: 'interactive-lab',
    minutes: 14,
    difficulty: 'advanced',
    grader: 'deterministic',
    evidenceProduced: 'application',
    outcomes: [
      { concept: 'nema:service-timing', ability: 'apply', evidenceType: 'application' },
      { concept: 'nema:temperature-control', ability: 'apply', evidenceType: 'application' }
    ],
    skipIf: [],
    unlock: [
      { concept: 'nema:emulsions', ability: 'explain', minStatus: 'uncertain' },
      { concept: 'nema:food-safety', ability: 'apply', minStatus: 'verified' },
      { concept: 'nema:mise-en-place', ability: 'explain', minStatus: 'verified' }
    ],
    whatTheLearnerDoes:
      'Reads four incidents from the pass and chooses one action for each, knowing that over reacting costs a table and a portion.',
    includeReason: 'Included: the advanced lab is the second unit outcome.',
    skipReason: '',
    unlockReason: 'Unlocked. Prerequisite recognised from another provider, all three of them.',
    lockedReason:
      'Locked: needs emulsions at least uncertain, plus verified food safety and mise en place.',
    ...TRIAGE_LAB
  }
};

export const ACTIVITY_ORDER = Object.keys(ACTIVITIES);

/* ------------------------------------------------------------------------- */
/* Manifest                                                                   */
/* ------------------------------------------------------------------------- */

export const MANIFEST = {
  protocol: 'nema/0.1',
  provider: { origin: PROVIDER.origin, name: PROVIDER.name, keyId: PROVIDER.keyId },
  unit: {
    id: 'service-under-pressure',
    version: UNIT_VERSION,
    title: 'Service Under Pressure',
    estimatedMinutes: ACTIVITY_ORDER.reduce((total, id) => total + ACTIVITIES[id].minutes, 0),
    language: 'en',
    price: 'free'
  },
  outcomes: [
    { concept: 'nema:food-safety', ability: 'apply' },
    { concept: 'nema:cross-contamination', ability: 'discriminate' },
    { concept: 'nema:service-timing', ability: 'apply' },
    { concept: 'nema:temperature-control', ability: 'apply' }
  ],
  requirements: [
    { concept: 'nema:mise-en-place', ability: 'explain' },
    { concept: 'nema:emulsions', ability: 'explain' },
    { concept: 'nema:food-safety', ability: 'apply' }
  ],
  activities: ACTIVITY_ORDER.map((id) => {
    const a = ACTIVITIES[id];
    return {
      id: a.id,
      type: a.type,
      title: a.title,
      minutes: a.minutes,
      evidenceProduced: a.evidenceProduced,
      grader: a.grader,
      outcomes: a.outcomes.map((o) => ({ concept: o.concept, ability: o.ability })),
      skipIf: a.skipIf,
      unlock: a.unlock
    };
  })
};

/* ------------------------------------------------------------------------- */
/* Grading                                                                    */
/* ------------------------------------------------------------------------- */

const STATUSES = ['verified', 'uncertain', 'missing'];

function idSet(value) {
  const out = new Set();
  if (!Array.isArray(value)) return out;
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim()) out.add(entry.trim());
  }
  return out;
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function claimsFor(activity, result) {
  if (result === 'failed') return [];
  return activity.outcomes.map((outcome) => ({
    concept: outcome.concept,
    ability: outcome.ability,
    evidenceType: outcome.evidenceType,
    result,
    difficulty: activity.difficulty
  }));
}

function logEntry(entryId) {
  return SERVICE_LOG.find((entry) => entry.id === entryId) || null;
}

/* "label, because why" for each id, so feedback only ever talks about the
   steps the learner actually got wrong. */
function explainSteps(ids) {
  return ids
    .map((id) => {
      const entry = logEntry(id);
      if (!entry) return id;
      return entry.why ? entry.label + ', because ' + entry.why : entry.label;
    })
    .join('; ');
}

function fixLabel(id) {
  const entry = SERVICE_LOG_FIXES.find((fix) => fix.id === id);
  return entry ? entry.label : id;
}

function gradeLesson(activity, submission) {
  const done =
    !!submission &&
    typeof submission === 'object' &&
    (submission.completed === true || submission.acknowledged === true || submission.read === true);
  if (!done) {
    return {
      result: 'failed',
      score: 0,
      feedback: ['Mark the lesson as completed in the page to record exposure evidence.'],
      claims: []
    };
  }
  return {
    result: 'passed',
    score: 1,
    feedback: [
      'Lesson completed. This records exposure evidence only, at the lowest weight the vault accepts.',
      'Exposure never claims that you can do the work on a station. The labs do that.'
    ],
    claims: claimsFor(activity, 'passed')
  };
}

function gradeServiceLogAudit(activity, submission) {
  const key = activity.answerKey;
  const picked = idSet(submission && submission.untrusted);
  const chosen = idSet(submission && submission.mitigations);

  const expected = new Set(key.untrustedIds);
  const unsafeExact = sameSet(picked, expected);
  const missedUnsafe = key.untrustedIds.filter((id) => !picked.has(id));
  const overMarked = [...picked].filter((id) => !expected.has(id));

  const effectivePicked = key.effectiveMitigations.filter((id) => chosen.has(id));
  const effectiveMissed = key.effectiveMitigations.filter((id) => !chosen.has(id));
  const harmfulPicked = key.harmfulMitigations.filter((id) => chosen.has(id));
  const neutralPicked = key.neutralMitigations.filter((id) => chosen.has(id));

  let result = 'failed';
  if (unsafeExact && harmfulPicked.length === 0) {
    if (effectivePicked.length === key.effectiveMitigations.length) result = 'passed';
    else if (effectivePicked.length >= 2) result = 'partial';
  }

  const union = new Set([...picked, ...expected]);
  const overlap = [...expected].filter((id) => picked.has(id)).length;
  const unsafeScore = union.size === 0 ? 0 : overlap / union.size;
  const fixScore = Math.max(
    0,
    Math.min(1, effectivePicked.length / key.effectiveMitigations.length - 0.5 * harmfulPicked.length)
  );
  const score = round2(0.5 * unsafeScore + 0.5 * fixScore);

  const safeStepIds = SERVICE_LOG.filter((entry) => entry.actor === 'cook' && !entry.untrusted).map(
    (entry) => entry.id
  );

  const feedback = [];
  if (unsafeExact) {
    feedback.push(
      'Unsafe steps: correct. All ' +
        key.untrustedIds.length +
        ' steps that break a rule are marked, and the ' +
        safeStepIds.length +
        ' that were done properly are not.'
    );
  } else {
    if (missedUnsafe.length) {
      feedback.push(
        'Missed unsafe work: ' +
          explainSteps(missedUnsafe) +
          '. The rule decides this, not how the plate looked.'
      );
    }
    if (overMarked.length) {
      feedback.push(
        'Marked as unsafe with no rule broken: ' +
          explainSteps(overMarked) +
          '. Flagging correct work is not a cautious default, it teaches the line to ignore the flags that matter.'
      );
    }
  }

  if (harmfulPicked.length) {
    feedback.push(
      'Harmful fix selected: ' +
        harmfulPicked.map(fixLabel).join('; ') +
        '. Options like these leave the hazard where it was and let a station believe the problem has been handled.'
    );
  }
  if (effectiveMissed.length) {
    feedback.push('Missing fix: ' + effectiveMissed.map(fixLabel).join('; ') + '.');
  }
  if (neutralPicked.length) {
    feedback.push(
      'Neutral choices do not count against you: ' +
        neutralPicked.map(fixLabel).join('; ') +
        '. Put them in if you like, but do not record them as controls.'
    );
  }
  if (result === 'passed') {
    feedback.push(
      'Passed. The three fixes you kept all change what is within reach of the station, so nobody has to remember anything at 21:00.'
    );
  } else if (result === 'partial') {
    feedback.push('Partial. The reading of the log is right, the fix list is not complete yet.');
  }

  return { result, score, feedback, claims: claimsFor(activity, result) };
}

function gradeIncidentTriage(activity, submission) {
  const answers =
    submission && typeof submission === 'object' && submission.answers && typeof submission.answers === 'object'
      ? submission.answers
      : {};

  const feedback = [];
  let correct = 0;
  for (const incident of activity.incidents) {
    const given = answers[incident.id];
    if (given === incident.answerKey) {
      correct += 1;
      feedback.push(incident.id + ': correct. ' + incident.rationale);
    } else {
      const chosen = incident.options.find((o) => o.id === given);
      feedback.push(
        incident.id +
          ': not the right call. ' +
          (chosen ? 'You chose "' + chosen.label.split(':')[0] + '". ' : 'No option was recorded. ') +
          incident.rationale
      );
    }
  }

  const total = activity.incidents.length;
  const result = correct === total ? 'passed' : correct === total - 1 ? 'partial' : 'failed';
  feedback.unshift(correct + ' of ' + total + ' incidents called correctly.');

  return { result, score: round2(correct / total), feedback, claims: claimsFor(activity, result) };
}

export function grade(activityId, submission) {
  const activity = ACTIVITIES[activityId];
  if (!activity) {
    return {
      result: 'failed',
      score: 0,
      feedback: ['Unknown activity "' + String(activityId) + '".'],
      claims: []
    };
  }
  if (activity.type === 'lesson') return gradeLesson(activity, submission);
  if (activityId === 'service-log-audit') return gradeServiceLogAudit(activity, submission);
  return gradeIncidentTriage(activity, submission);
}

/* ------------------------------------------------------------------------- */
/* Prerequisites                                                              */
/* ------------------------------------------------------------------------- */

function bareConcept(concept) {
  const value = String(concept);
  return value.startsWith('nema:') ? value.slice(5) : value;
}

function readStatus(statuses, concept, ability) {
  if (!statuses || typeof statuses !== 'object') return 'missing';
  const direct = statuses[concept + '|' + ability];
  if (STATUSES.includes(direct)) return direct;
  const bare = statuses[bareConcept(concept) + '|' + ability];
  if (STATUSES.includes(bare)) return bare;
  for (const [rawKey, value] of Object.entries(statuses)) {
    const split = rawKey.indexOf('|');
    if (split < 0) continue;
    const keyConcept = rawKey.slice(0, split);
    const keyAbility = rawKey.slice(split + 1);
    if (keyAbility === ability && bareConcept(keyConcept) === bareConcept(concept) && STATUSES.includes(value)) {
      return value;
    }
  }
  return 'missing';
}

function satisfies(status, needed) {
  if (needed === 'verified') return status === 'verified';
  if (needed === 'uncertain') return status === 'verified' || status === 'uncertain';
  return false;
}

export function checkPrerequisites(statuses) {
  const recognized = MANIFEST.requirements.map((req) => ({
    concept: req.concept,
    ability: req.ability,
    status: readStatus(statuses, req.concept, req.ability)
  }));

  const unlocked = [];
  const locked = [];
  const skippable = [];

  for (const activityId of ACTIVITY_ORDER) {
    const activity = ACTIVITIES[activityId];

    const missing = (activity.unlock || [])
      .filter((need) => !satisfies(readStatus(statuses, need.concept, need.ability), need.minStatus))
      .map((need) => ({ concept: need.concept, ability: need.ability, needed: need.minStatus }));

    if (missing.length) locked.push({ activityId, missing });
    else unlocked.push(activityId);

    const skipRules = activity.skipIf || [];
    if (
      skipRules.length > 0 &&
      skipRules.every((rule) => satisfies(readStatus(statuses, rule.concept, rule.ability), rule.status))
    ) {
      skippable.push(activityId);
    }
  }

  const recommendedFirst = unlocked.find((id) => !skippable.includes(id)) || null;

  return { recognized, unlocked, locked, skippable, recommendedFirst };
}

export const CONTENT_HASH_INPUT = JSON.stringify(ACTIVITIES);
