/**
 * nema: Harness Engineering Lab content and graders.
 *
 * This module is imported by the browser page AND by the Cloudflare Worker, so
 * it is fully self contained: no imports, no DOM access, no globals beyond the
 * ES language itself. Everything here is pure data plus pure functions.
 *
 * Exports
 *   MANIFEST            LearningManifest (CONTRACT 5.1), unsigned.
 *   ACTIVITIES          { [activityId]: Activity } in path order.
 *   grade(id, sub)      -> { result, score, feedback: string[], claims: [] }
 *   CONTENT_HASH_INPUT  JSON.stringify(ACTIVITIES); the worker hashes this
 *                       into receipt.activity.contentHash.
 *   personalizePath(st) -> { path, skipped, fullMinutes, personalMinutes }
 *
 * ---------------------------------------------------------------------------
 * ACTIVITY SHAPE (read this before building the UI)
 * ---------------------------------------------------------------------------
 * Every activity has the same envelope:
 *
 *   { id, version, title, type, minutes, difficulty, grader,
 *     evidenceProduced, outcomes: [{concept, ability}],
 *     skipIf: [{concept, ability, status}], onlyIf?: [...],
 *     includeReason, skipReason, notApplicableReason?,
 *     whatTheLearnerDoes, content: <type specific> }
 *
 * content, by type:
 *
 * lesson
 *   { intro: string,
 *     sections: [{ heading: string, html: string }],
 *     keyPoints: string[],
 *     exposureClaim: { concept, ability: 'recognize', evidenceType: 'recognition' } }
 *   Submission: { completed: true }. A completed lesson produces one exposure
 *   receipt (grader weight 0.1). Reading is not mastery, and the receipt says so.
 *
 * diagnostic
 *   { prompt: string,
 *     context: { html: string },
 *     options: [{ id, html, whyWrong }],   // whyWrong is '' for the answer key
 *     answerKey: string,                    // option id
 *     explanation: string,
 *     hints: string[] }
 *   Submission: { optionId: string, hintsUsed?: number }.
 *   Reveal option.whyWrong and explanation only AFTER submission.
 *   Grading: the answer key is 'passed', anything else is 'failed'. Hints do
 *   not change the result. hintsUsed travels to the vault in the receipt
 *   conditions instead, because the vault owns the weighting of evidence and
 *   the provider should not grade the same fact twice.
 *
 * interactive-lab
 *   { scenario: { html: string },
 *     brokenHarness: { json: object },      // render as pretty printed JSON
 *     beforeRun: string[],                  // console lines, run as-is
 *     checks: [{ id, label, detail, kind: 'required'|'harmful'|'neutral' }],
 *     stages: [{ id, label }],              // learner drags these into order
 *     afterRun: string[],                   // console lines, show after a pass
 *     hints: string[],
 *     answerKey: { requiredChecks: [id], harmfulChecks: [id], stageOrder: [id] } }
 *   Submission: { checks: [id], stageOrder: [id] }.
 *   Neutral checks are free: selecting them never hurts, ignoring them never hurts.
 *   Grading: 'passed' when all required checks are selected, no harmful check is
 *   selected and the stage order is exact; 'partial' when the checks are right
 *   but the order is not; 'failed' otherwise.
 *
 * free-recall
 *   { prompt: string,
 *     rubric: [{ id, criterion, keywords: string[] }],
 *     minWords: number }
 *   Submission: { text: string }.
 *   Grading (grader 'provider-rubric', weight 0.8): a criterion is met when any
 *   of its keywords appears in the text, case insensitive, at the start of a
 *   word. The trailing boundary is deliberately open so that inflections count:
 *   the stem 'unit test' matches "unit tests" and "unit testing", 'verif'
 *   matches "verifier", "verify" and "verification". Substrings that start
 *   inside another word never count, so "unittests" is not a match.
 *   All criteria met is 'passed', one short of all is 'partial', otherwise
 *   'failed'. Answers under minWords cannot pass: they are graded 'failed'
 *   with an explicit message.
 *
 * ---------------------------------------------------------------------------
 * MINUTES ARITHMETIC (the 68 -> 27 -> 21 story)
 * ---------------------------------------------------------------------------
 *   1 agent-loop-primer      12   skipIf agent-loop.explain verified
 *   2 testing-refresher      15   skipIf software-testing.apply verified
 *   3 json-schema-diagnostic  6   onlyIf json-schema.apply uncertain
 *   4 json-schema-primer     14   skipIf json-schema.apply uncertain (or better)
 *   5 eval-anatomy            4   always
 *   6 eval-design-lab        12   always
 *   7 eval-retrieval          5   always
 *
 *   Full path (all seven):        12+15+6+14+4+12+5 = 68  = unit.estimatedMinutes
 *   Seed learner (software-testing verified, agent-loop verified,
 *   json-schema uncertain):       6+4+12+5          = 27
 *   After the diagnostic passes (json-schema verified):
 *                                 4+12+5            = 21
 *   No assertion presented yet
 *   (personalizePath(null)):      the whole offer   = 68
 *   Every requirement missing:    12+15+14+4+12+5   = 62
 *     (the diagnostic drops out: onlyIf matches a status exactly, and a learner
 *      with no JSON Schema evidence at all is sent straight to the primer, which
 *      is the cheaper thing to do for them.)
 *
 *   So 68 is the offer, not a personalized result: 62 is the longest path any
 *   real assertion can produce.
 */

/* ------------------------------------------------------------------ */
/* Manifest                                                            */
/* ------------------------------------------------------------------ */

const PROVIDER_ORIGIN = 'https://nema-harness.migarci2.dev';

/* ------------------------------------------------------------------ */
/* Activities                                                          */
/* ------------------------------------------------------------------ */

export const ACTIVITIES = {
  'agent-loop-primer': {
    id: 'agent-loop-primer',
    version: '1.0.0',
    title: 'How an agent loop actually runs',
    type: 'lesson',
    minutes: 12,
    difficulty: 'introductory',
    grader: 'exposure',
    evidenceProduced: 'recognition',
    outcomes: [{ concept: 'nema:agent-loop', ability: 'recognize' }],
    skipIf: [{ concept: 'nema:agent-loop', ability: 'explain', status: 'verified' }],
    includeReason: 'Included: no verified evidence that you can explain the agent loop.',
    skipReason: 'Skipped: your vault already proves you can explain the agent loop.',
    whatTheLearnerDoes: 'Reads three short sections and marks the lesson complete.',
    content: {
      intro:
        'An agent is not a model with a personality. It is a loop. The model proposes an action, a tool executes it, the result is appended as text, and the loop runs again. Every lever you have as an engineer lives in that loop, not in the adjectives you put in the prompt.',
      sections: [
        {
          heading: 'The loop is three moves',
          html:
            '<p>Whatever the vendor calls it, a coding agent repeats three moves. It reads the current context. It emits either a final answer or a tool call. The harness runs the tool and appends the result to the context. That is the entire machine.</p>' +
            '<p>The model has no memory between runs and no senses beyond what the harness writes down. If the build failed and nothing appended the failure, the agent does not know it failed. It is not being stubborn. It is reading the only world it has.</p>'
        },
        {
          heading: 'The harness owns everything the model does not',
          html:
            '<p>Four decisions belong to you, and none of them are prompt engineering.</p>' +
            '<ul>' +
            '<li><b>Tool surface.</b> What the agent is allowed to touch, and at what granularity.</li>' +
            '<li><b>Result shape.</b> What the agent learns after each action, especially when the action fails.</li>' +
            '<li><b>Budget.</b> How many turns, tokens and seconds the loop may spend before it stops.</li>' +
            '<li><b>Termination.</b> Who decides that the work is done. The honest answer is never the agent.</li>' +
            '</ul>' +
            '<p>A blunt prompt inside a strict harness beats an elegant prompt inside a loose one, reliably enough that you should plan for it.</p>'
        },
        {
          heading: 'Where loops go wrong',
          html:
            '<p>Three shapes cover most incidents. The agent stops early because it believes its own summary. The agent thrashes, repeating a failing action because the error text is byte identical every time and carries no new information. The agent succeeds locally and breaks something that no tool result ever mentioned.</p>' +
            '<p>All three are feedback problems before they are model problems. A loop that reports the real outcome of the real task can recover from a bad first attempt. A loop that reports only "tests passed" can only be lucky.</p>' +
            '<p>The practical consequence is where you spend your afternoon. Rewriting the system prompt for the fourth time changes what the agent intends. Adding one tool result that names the actual failure changes what the agent can know, and a loop can only act on what it knows. When a run goes wrong, read the transcript as the agent received it, not as you imagine it. The answer is almost always a turn where the agent was told nothing useful and had to guess.</p>'
        }
      ],
      keyPoints: [
        'An agent is a loop: context, action, result, repeat.',
        'The model knows exactly what the harness wrote into the context, and nothing else.',
        'Tool surface, result shape, budget and termination are engineering decisions.',
        'Most agent failures are missing feedback rather than missing intelligence.'
      ],
      exposureClaim: {
        concept: 'nema:agent-loop',
        ability: 'recognize',
        evidenceType: 'recognition'
      }
    }
  },

  'testing-refresher': {
    id: 'testing-refresher',
    version: '1.0.0',
    title: 'Testing, refreshed for agents',
    type: 'lesson',
    minutes: 15,
    difficulty: 'introductory',
    grader: 'exposure',
    evidenceProduced: 'recognition',
    outcomes: [{ concept: 'nema:software-testing', ability: 'recognize' }],
    skipIf: [{ concept: 'nema:software-testing', ability: 'apply', status: 'verified' }],
    includeReason: 'Included: no verified evidence that you can apply software testing.',
    skipReason: 'Skipped: your vault already proves you can apply software testing.',
    whatTheLearnerDoes: 'Reads three short sections and marks the lesson complete.',
    content: {
      intro:
        'You already know how to write a test. This refresher is about what a test is evidence of, because that is the question an agent harness forces you to answer out loud.',
      sections: [
        {
          heading: 'What a unit test actually buys you',
          html:
            '<p>A unit test is a claim about one function under inputs you chose. It buys you a fast, precise signal about a small piece of the system, and it buys you the courage to refactor. That is a lot. It is also all.</p>' +
            '<p>The claim never extends past the boundary you drew. A green suite says the parts you thought to check behave the way you thought to check them. It says nothing about the parts you did not think of, and nothing at all about whether the user got what they asked for.</p>'
        },
        {
          heading: 'The gap a test double leaves',
          html:
            '<p>Every mock, stub and fake is a small lie you agree to tell so the test can run fast. The lie is usually harmless and occasionally load bearing: the payment gateway that returns a shape the real one stopped returning last quarter, the database that never enforces a constraint, the migration that only exists in the fixture.</p>' +
            '<p>Coverage counts lines the tests executed. It cannot count assumptions the doubles absorbed. This is why a suite can be at ninety percent and the deploy can still page you at midnight.</p>'
        },
        {
          heading: 'From assertions to acceptance',
          html:
            '<p>Testing has always had two levels, and agents make the difference expensive to ignore.</p>' +
            '<ul>' +
            '<li><b>Assertions</b> check a unit against inputs the author imagined.</li>' +
            '<li><b>Acceptance</b> checks the delivered system against what somebody asked for.</li>' +
            '</ul>' +
            '<p>A human who makes the assertions pass while missing the request gets caught in review. An agent will happily ship the same work, announce success in fluent prose, and move on. If the only gate is the unit suite, that prose is your acceptance criteria.</p>' +
            '<p>So keep both levels and be honest about what each one is for. Unit tests stay fast, numerous and close to the code, and they are the reason a refactor is safe. Acceptance runs on a restored fixture, calls the system the way a caller would, and is the reason a release is safe. Agents do not change that split. They change the cost of getting it wrong, because an agent can produce a large, plausible, green diff faster than anyone can read it.</p>'
        }
      ],
      keyPoints: [
        'A unit test is evidence about one function, under inputs someone chose.',
        'Test doubles trade fidelity for speed, and the missing fidelity is where incidents live.',
        'Coverage measures executed lines, not the assumptions your fakes absorbed.',
        'Acceptance asks a different question from assertion: did the requested outcome happen.'
      ],
      exposureClaim: {
        concept: 'nema:software-testing',
        ability: 'recognize',
        evidenceType: 'recognition'
      }
    }
  },

  'json-schema-diagnostic': {
    id: 'json-schema-diagnostic',
    version: '1.0.0',
    title: 'Which schema holds the line',
    type: 'diagnostic',
    minutes: 6,
    difficulty: 'intermediate',
    grader: 'deterministic',
    evidenceProduced: 'application',
    outcomes: [{ concept: 'nema:json-schema', ability: 'apply' }],
    skipIf: [],
    onlyIf: [{ concept: 'nema:json-schema', ability: 'apply', status: 'uncertain' }],
    includeReason:
      'Included: JSON Schema is uncertain in your vault. Six minutes here can replace the fourteen minute primer.',
    skipReason: 'Skipped: your vault already proves you can apply JSON Schema.',
    notApplicableReason:
      'Not applicable: this check only runs when JSON Schema is uncertain. With no evidence at all, the primer is the cheaper route.',
    whatTheLearnerDoes: 'Reads four candidate schemas and picks the one that satisfies both requirements.',
    content: {
      prompt:
        'A print service exposes one tool input. The schema must reject the first payload and accept the second. Which of the four schemas does both?',
      context: {
        html:
          '<p>The tool input validator sits in front of the print queue. Two payloads decide whether it is correct:</p>' +
          '<pre><code>reject: { "copies": 0 }\naccept: { "copies": 3, "pageSize": "A4" }</code></pre>' +
          '<p>Every candidate below is valid JSON Schema. Three of them let one of those two payloads through the wrong door.</p>'
      },
      options: [
        {
          id: 'schema-a',
          html:
            '<pre><code>{\n  "type": "object",\n  "properties": {\n    "copies": { "type": "integer" },\n    "pageSize": { "type": "string", "enum": ["A4", "Letter"] }\n  },\n  "required": ["copies"],\n  "additionalProperties": false\n}</code></pre>',
          whyWrong:
            'No lower bound on copies. Zero is a perfectly good integer, so { "copies": 0 } is accepted and the print queue receives a job that prints nothing.'
        },
        {
          id: 'schema-b',
          html:
            '<pre><code>{\n  "type": "object",\n  "properties": {\n    "copies": { "type": "integer", "minimum": 1 },\n    "pageSize": { "type": "string", "enum": ["A4", "Letter"] }\n  },\n  "required": ["copies"],\n  "additionalProperties": false\n}</code></pre>',
          whyWrong: ''
        },
        {
          id: 'schema-c',
          html:
            '<pre><code>{\n  "type": "object",\n  "properties": {\n    "copies": { "type": "string", "minLength": 1 },\n    "pageSize": { "type": "string", "enum": ["A4", "Letter"] }\n  },\n  "required": ["copies"],\n  "additionalProperties": false\n}</code></pre>',
          whyWrong:
            'The type is wrong. This one does reject { "copies": 0 }, but it rejects { "copies": 3 } too, because 3 is a number and the schema demands a string. A validator that refuses valid work is still a broken validator.'
        },
        {
          id: 'schema-d',
          html:
            '<pre><code>{\n  "type": "object",\n  "properties": {\n    "copies": { "type": "integer" },\n    "pageSize": { "type": "string", "enum": ["A4", "Letter"], "minimum": 1 }\n  },\n  "required": ["copies"],\n  "additionalProperties": false\n}</code></pre>',
          whyWrong:
            'The minimum is on the wrong property. Numeric keywords are ignored on a string, so this schema constrains nothing and { "copies": 0 } sails through.'
        }
      ],
      answerKey: 'schema-b',
      explanation:
        'Schema B is the only one that closes both doors. "type": "integer" with "minimum": 1 rejects 0 while still accepting 3, the enum keeps pageSize to values the printer understands, and additionalProperties: false stops an agent from smuggling in a field the service never validates. The other three fail in the three ways schemas usually fail: a missing constraint, a constraint on the wrong type, and a constraint on the wrong property.',
      hints: [
        'Two payloads, two questions. Ask each schema: does it say no to zero, and does it still say yes to three.',
        'A keyword only does work when it matches the type it is attached to. Numeric keywords on a string are decoration.'
      ]
    }
  },

  'json-schema-primer': {
    id: 'json-schema-primer',
    version: '1.0.0',
    title: 'JSON Schema for tool inputs',
    type: 'lesson',
    minutes: 14,
    difficulty: 'introductory',
    grader: 'exposure',
    evidenceProduced: 'recognition',
    outcomes: [{ concept: 'nema:json-schema', ability: 'recognize' }],
    skipIf: [{ concept: 'nema:json-schema', ability: 'apply', status: 'uncertain' }],
    includeReason: 'Included: your vault has no usable evidence for JSON Schema.',
    skipReason: 'Skipped: your vault already has evidence for JSON Schema at this level.',
    whatTheLearnerDoes: 'Reads three short sections and marks the lesson complete.',
    content: {
      intro:
        'For an agent, the input schema is not documentation. It is the only thing standing between a confidently generated payload and your production database. Write it like a gate, because that is what it is.',
      sections: [
        {
          heading: 'A schema is a gate, not documentation',
          html:
            '<p>Models read schemas and mostly respect them, which is exactly why a permissive schema is dangerous. The agent will produce something the schema allows, and everything the schema allows is what you promised to handle.</p>' +
            '<p>Descriptions steer the model. Constraints stop the request. Do not use one where you need the other. A field described as "a positive number of copies" with no <code>minimum</code> is a suggestion, and suggestions do not survive contact with a retry loop.</p>'
        },
        {
          heading: 'Constraints that actually reject',
          html:
            '<p>The keywords that earn their place are the ones that turn a payload away.</p>' +
            '<ul>' +
            '<li><code>type</code> plus <code>minimum</code>, <code>maximum</code> or <code>exclusiveMinimum</code> for numbers.</li>' +
            '<li><code>enum</code> or <code>pattern</code> for strings that stand for a closed set.</li>' +
            '<li><code>minItems</code>, <code>maxItems</code> and <code>uniqueItems</code> for arrays that feed a loop.</li>' +
            '</ul>' +
            '<p>Keywords only apply to the type they belong to. <code>minimum</code> on a string is silently ignored, and a validator that ignores you is worse than no validator, because it looks green.</p>'
        },
        {
          heading: 'Close the object',
          html:
            '<p>Two lines do most of the work: <code>required</code> for the fields you truly need, and <code>additionalProperties: false</code> so an invented field is a validation error instead of a silent no-op.</p>' +
            '<p>Then make the failure useful. Return the failing path, the constraint that failed and the value received. An agent that reads "copies: 0 violates minimum 1" fixes itself on the next turn. An agent that reads "400 Bad Request" tries the same payload again, slower.</p>' +
            '<p>Two habits keep tool schemas honest as they grow. First, write the schema against the payloads you must refuse, not only the ones you expect: one accepted example and one rejected example per field, kept next to the schema as a test. Second, treat any field the model invents as a signal. If the agent keeps sending <code>pages</code> and your service wants <code>pageSize</code>, the fix is usually a clearer name, not a stricter regex. A schema is where the model and the service agree, and both sides get a vote.</p>'
        }
      ],
      keyPoints: [
        'The schema is the enforcement boundary, the description is only guidance.',
        'Prefer keywords that reject: type with minimum, enum, pattern, minItems.',
        'A keyword attached to the wrong type is ignored, not applied.',
        'required plus additionalProperties: false closes the object.',
        'Validation errors are agent feedback: name the path, the constraint and the value.'
      ],
      exposureClaim: {
        concept: 'nema:json-schema',
        ability: 'recognize',
        evidenceType: 'recognition'
      }
    }
  },

  'eval-anatomy': {
    id: 'eval-anatomy',
    version: '1.0.0',
    title: 'Anatomy of an agent eval',
    type: 'lesson',
    minutes: 4,
    difficulty: 'intermediate',
    grader: 'exposure',
    evidenceProduced: 'recognition',
    outcomes: [{ concept: 'nema:agent-evals', ability: 'recognize' }],
    skipIf: [],
    includeReason: 'Included: this is the core lesson of the unit.',
    skipReason: '',
    whatTheLearnerDoes: 'Reads three short sections and marks the lesson complete.',
    content: {
      intro:
        'A unit test asks whether a function is correct. An agent eval asks whether a task got done. The second question needs different parts, and forgetting one of them is how teams end up with green dashboards and angry users.',
      sections: [
        {
          heading: 'Fixture, task, verifier',
          html:
            '<p>An agent eval has exactly three parts, and each one is a piece of engineering.</p>' +
            '<ul>' +
            '<li><b>Fixture.</b> A repository, database and service state you can restore byte for byte. If the fixture drifts, the eval measures the drift.</li>' +
            '<li><b>Task.</b> The request in the words a user would use, not the diff you expect. The moment you specify the diff, you are testing obedience instead of outcome.</li>' +
            '<li><b>Verifier.</b> A program that inspects the world after the run and decides. It calls the endpoint, queries the table, runs the migration. It does not read the agent report.</li>' +
            '</ul>'
        },
        {
          heading: 'The verifier writes to the agent, not only to you',
          html:
            '<p>This is the part most harnesses miss. The verifier output is not a dashboard entry, it is the next message in the loop. When it says "POST /print with copies 0 returned 500, expected 400", the agent has something to act on and can self-correct inside the same run.</p>' +
            '<p>A boolean cannot do that. Pass or fail tells the agent that it is wrong, and nothing about which wrong it is. Feedback quality is the single variable that separates an agent that recovers from one that thrashes.</p>'
        },
        {
          heading: 'The acceptance gate',
          html:
            '<p>The gate runs last and is the only thing allowed to say done. It checks the task eval, the scope of the diff and the state of the system: migrations applied, no files touched outside the declared scope, no unrelated service broken.</p>' +
            '<p>Keep it deterministic and keep it out of the agent reach. The moment the agent can mark its own work accepted, you no longer have an eval. You have a self assessment with extra steps.</p>' +
            '<p>The gate is also where you decide what done means for your team, so write it down as code rather than as a habit. Ours says: the task eval passes on a restored fixture, the diff stays inside the declared scope, no migration is left pending, and the run cost stayed inside budget. Every clause was added the day an incident taught us it was missing, which is the only sound reason to add one.</p>'
        }
      ],
      keyPoints: [
        'An eval is fixture, task and verifier. All three or it is not an eval.',
        'State the task the way a user would, never as the diff you expect.',
        'Verifier output is agent feedback first and a metric second.',
        'The acceptance gate is deterministic, runs last, and the agent cannot touch it.'
      ],
      exposureClaim: {
        concept: 'nema:agent-evals',
        ability: 'recognize',
        evidenceType: 'recognition'
      }
    }
  },

  'eval-design-lab': {
    id: 'eval-design-lab',
    version: '1.0.0',
    title: 'Fix the broken harness',
    type: 'interactive-lab',
    minutes: 12,
    difficulty: 'intermediate',
    grader: 'deterministic',
    evidenceProduced: 'application',
    outcomes: [
      { concept: 'nema:agent-evals', ability: 'apply' },
      { concept: 'nema:feedback-loops', ability: 'discriminate' }
    ],
    skipIf: [],
    includeReason: 'Included: this lab is where the unit outcome is earned.',
    skipReason: '',
    whatTheLearnerDoes:
      'Selects the checks to add to a broken harness and orders the three stages, then runs the harness again.',
    content: {
      scenario: {
        html:
          '<p>The print service team runs a coding agent on a real ticket: <i>make copies default to 1 and reject copies: 0</i>.</p>' +
          '<p>The agent finishes in four minutes. The unit suite is green, 128 passed. The harness prints "acceptance: passed". Twenty minutes later the on-call engineer gets a page: submitting a job with <code>copies: 0</code> returns a 500, the billing invoice template has changed, and migration <code>004_print_defaults.sql</code> is sitting in the repository unapplied.</p>' +
          '<p>Nothing lied. The harness was asked one question, it answered that question honestly, and that question had nothing to do with the ticket. Below is the harness. Pick the checks that close the gap, drop the ones that would make it worse, then order the stages.</p>'
      },
      brokenHarness: {
        json: {
          name: 'print-service-agent-harness',
          version: 3,
          stages: [{ id: 'unit-tests', run: 'npm test -- --silent' }],
          scope: { allow: ['src/print/**', 'migrations/**'], enforced: false },
          verifier: { source: 'agent-final-message' },
          migrations: { check: false },
          acceptance: { requires: ['unit-tests'] }
        }
      },
      beforeRun: [
        '$ harness run --task "make copies default to 1 and reject copies: 0"',
        '[agent] edited src/print/options.js',
        '[agent] edited src/billing/invoice.js (outside declared scope, not enforced)',
        '[agent] wrote migrations/004_print_defaults.sql (never applied)',
        '[harness] stage unit-tests: 128 passed, 0 failed',
        '[harness] acceptance: passed, verifier source agent-final-message',
        '[production] POST /print {"copies":0} -> 500 Internal Server Error'
      ],
      checks: [
        {
          id: 'task-eval',
          label: 'Task eval against the running service',
          detail:
            'Restore the fixture, run the agent on the ticket, then call POST /print with {"copies":0} and with {"copies":3,"pageSize":"A4"} and assert the status codes.',
          kind: 'required'
        },
        {
          id: 'scope-diff',
          label: 'Scope check on the diff',
          detail:
            'Fail the run when the agent changes files outside the declared scope, and report every offending path back into the loop.',
          kind: 'required'
        },
        {
          id: 'migration-state',
          label: 'Migration state assertion',
          detail:
            'Assert that no migration is pending after the run, so a file written but never applied cannot pass as finished work.',
          kind: 'required'
        },
        {
          id: 'retry-until-green',
          label: 'Retry until the suite is green',
          detail:
            'Re-run the agent up to ten times and accept the first attempt where the unit suite passes.',
          kind: 'harmful'
        },
        {
          id: 'agent-self-accept',
          label: 'Trust the agent completion report',
          detail:
            'Let the agent mark the task accepted when its final message says the work is done.',
          kind: 'harmful'
        },
        {
          id: 'format-lint',
          label: 'Formatter check on changed files',
          detail: 'Run the formatter over the diff and fail on style drift.',
          kind: 'neutral'
        },
        {
          id: 'step-timing',
          label: 'Per step timing log',
          detail: 'Record wall clock duration and token spend for every step of the loop.',
          kind: 'neutral'
        },
        {
          id: 'coverage-badge',
          label: 'Coverage badge in the README',
          detail: 'Publish the unit test coverage percentage as a badge on every merge.',
          kind: 'neutral'
        }
      ],
      stages: [
        { id: 'task-eval-stage', label: 'Task eval' },
        { id: 'self-correction-loop', label: 'Self-correction loop' },
        { id: 'acceptance-gate', label: 'Acceptance gate' }
      ],
      afterRun: [
        '$ harness run --task "make copies default to 1 and reject copies: 0"',
        '[harness] stage task-eval: POST /print {"copies":0} -> expected 400, got 500 [FAIL]',
        '[harness] feedback to agent: schema allows copies: 0, migration 004 pending, 1 file outside scope',
        '[agent] added minimum: 1 to copies, applied migration 004, reverted src/billing/invoice.js',
        '[harness] stage task-eval: {"copies":0} -> 400, {"copies":3,"pageSize":"A4"} -> 201 [PASS]',
        '[harness] scope check: 2 files, all inside declared scope [PASS], migrations: 0 pending [PASS]',
        '[harness] acceptance gate: passed'
      ],
      hints: [
        'The unit suite was never wrong. It answered a question nobody asked. What question does the ticket ask, and what would it take to answer it against the running service?',
        'Two of these checks make the harness better at hiding a failure. Ask which of them lets a bad run end with a green result.',
        'Feedback has to reach the agent before anything is allowed to say done, so the gate cannot run in the middle.'
      ],
      answerKey: {
        requiredChecks: ['task-eval', 'scope-diff', 'migration-state'],
        harmfulChecks: ['retry-until-green', 'agent-self-accept'],
        stageOrder: ['task-eval-stage', 'self-correction-loop', 'acceptance-gate']
      }
    }
  },

  'eval-retrieval': {
    id: 'eval-retrieval',
    version: '1.0.0',
    title: 'Explain it without the diagram',
    type: 'free-recall',
    minutes: 5,
    difficulty: 'intermediate',
    grader: 'provider-rubric',
    evidenceProduced: 'explanation',
    outcomes: [{ concept: 'nema:agent-evals', ability: 'explain' }],
    skipIf: [],
    includeReason: 'Included: retrieval is what makes the lab stick.',
    skipReason: '',
    whatTheLearnerDoes: 'Writes a short paragraph from memory, with the lesson closed.',
    content: {
      prompt:
        'Close the lesson. In your own words, explain to a teammate why a green unit suite is not evidence that a coding agent finished its task, what an agent eval checks instead, and how the harness gets the agent to fix itself. Write at least 40 words and include one concrete failure you would expect to see.',
      rubric: [
        {
          id: 'task-outcome',
          criterion:
            'Says that an agent eval checks the end to end outcome of the real task rather than an internal unit.',
          keywords: [
            'end to end',
            'end-to-end',
            'task outcome',
            'task level',
            'task-level',
            'real task',
            'actual task',
            'user task',
            'outcome of the task',
            'whole task',
            'task was done',
            'task got done',
            'task was completed',
            'task actually'
          ]
        },
        {
          id: 'unit-boundary',
          criterion:
            'Contrasts unit level checks with task level evaluation, or names what the unit suite cannot see.',
          keywords: [
            'unit test',
            'unit-test',
            'unit level',
            'unit-level',
            'unit suite',
            'unit check',
            'test suite',
            'isolation',
            'single function',
            'individual function',
            'per function'
          ]
        },
        {
          id: 'feedback-gate',
          criterion:
            'Mentions verifier feedback reaching the agent, or an acceptance gate that decides instead of the agent.',
          keywords: [
            'verif',
            'feedback',
            'self-correct',
            'self correct',
            'self correction',
            'corrects itself',
            'fix itself',
            'fixes itself',
            'acceptance',
            'accepts the run',
            'gate'
          ]
        }
      ],
      minWords: 40
    }
  }
};

/* ------------------------------------------------------------------ */
/* Manifest, derived from ACTIVITIES so the numbers cannot drift        */
/* ------------------------------------------------------------------ */

const ACTIVITY_LIST = Object.values(ACTIVITIES);
const FULL_MINUTES = ACTIVITY_LIST.reduce((sum, a) => sum + a.minutes, 0); // 68

export const MANIFEST = {
  protocol: 'nema/0.1',
  provider: {
    origin: PROVIDER_ORIGIN,
    name: 'Harness Engineering Lab',
    keyId: 'harness-2026-09'
  },
  unit: {
    id: 'agent-evals-foundations',
    version: '1.0.0',
    title: 'Designing Agent Evals',
    estimatedMinutes: FULL_MINUTES,
    language: 'en',
    price: 'free'
  },
  outcomes: [
    { concept: 'nema:agent-evals', ability: 'apply' },
    { concept: 'nema:agent-evals', ability: 'explain' },
    { concept: 'nema:feedback-loops', ability: 'discriminate' },
    { concept: 'nema:json-schema', ability: 'apply' }
  ],
  requirements: [
    { concept: 'nema:software-testing', ability: 'apply' },
    { concept: 'nema:agent-loop', ability: 'explain' },
    { concept: 'nema:json-schema', ability: 'apply' }
  ],
  activities: ACTIVITY_LIST.map((a) => {
    const entry = {
      id: a.id,
      type: a.type,
      title: a.title,
      minutes: a.minutes,
      evidenceProduced: a.evidenceProduced,
      grader: a.grader,
      outcomes: a.outcomes,
      skipIf: a.skipIf
    };
    if (a.onlyIf) entry.onlyIf = a.onlyIf;
    return entry;
  })
};

export const CONTENT_HASH_INPUT = JSON.stringify(ACTIVITIES);

/* ------------------------------------------------------------------ */
/* Path personalization                                                */
/* ------------------------------------------------------------------ */

const STATUS_RANK = { missing: 0, uncertain: 1, verified: 2 };

function statusOf(statuses, concept, ability) {
  const value = statuses[concept + '|' + ability];
  return Object.prototype.hasOwnProperty.call(STATUS_RANK, value) ? value : 'missing';
}

/**
 * skipIf semantics (CONTRACT 5.1): a required status is satisfied by that
 * status or anything stronger. verified satisfies verified; verified or
 * uncertain satisfies uncertain.
 */
function satisfiesSkip(actual, required) {
  return STATUS_RANK[actual] >= (STATUS_RANK[required] ?? 0);
}

function pathEntry(activity, reason) {
  return {
    activityId: activity.id,
    title: activity.title,
    type: activity.type,
    minutes: activity.minutes,
    reason
  };
}

/**
 * personalizePath(statuses)
 *
 * statuses: { "<concept>|<ability>": 'verified' | 'uncertain' | 'missing' }
 * A key that is absent, or carries a value outside the three bands, is treated
 * as 'missing'.
 *
 * Pass null (or nothing) for "no readiness assertion has been presented yet":
 * that returns the whole offer, 68 minutes, with an empty skipped list. This is
 * the call the page makes before personalization. An empty object is accepted
 * as the same thing for callers that have no assertion to hand, but null is the
 * explicit form and the one the UI should use, because an assertion that
 * genuinely reports every requirement missing is a different answer: it keeps
 * the remedial lessons and drops the diagnostic, 62 minutes.
 *
 * Returns { path, skipped, fullMinutes, personalMinutes }.
 */
export function personalizePath(statuses) {
  const known = statuses && typeof statuses === 'object' ? statuses : {};
  const hasAssertion = Object.keys(known).length > 0;

  const path = [];
  const skipped = [];

  for (const activity of ACTIVITY_LIST) {
    if (!hasAssertion) {
      path.push(pathEntry(activity, 'Included: no readiness assertion presented yet.'));
      continue;
    }

    // onlyIf: every entry must match the reported status exactly.
    if (Array.isArray(activity.onlyIf) && activity.onlyIf.length > 0) {
      const applies = activity.onlyIf.every(
        (entry) => statusOf(known, entry.concept, entry.ability) === entry.status
      );
      if (!applies) {
        // Two different learners fall out of an onlyIf gate and they deserve
        // two different sentences. One is past the activity (every entry is
        // stronger than the gate asks for), the other never needed it.
        const outranked = activity.onlyIf.every(
          (entry) =>
            STATUS_RANK[statusOf(known, entry.concept, entry.ability)] >
            (STATUS_RANK[entry.status] ?? 0)
        );
        skipped.push({
          activityId: activity.id,
          title: activity.title,
          minutes: activity.minutes,
          reason: outranked
            ? activity.skipReason || 'Skipped: your vault already covers this.'
            : activity.notApplicableReason || 'Not applicable to your current state.'
        });
        continue;
      }
    }

    // skipIf: every entry must be satisfied for the activity to be skipped.
    const skipRules = Array.isArray(activity.skipIf) ? activity.skipIf : [];
    const shouldSkip =
      skipRules.length > 0 &&
      skipRules.every((entry) =>
        satisfiesSkip(statusOf(known, entry.concept, entry.ability), entry.status)
      );

    if (shouldSkip) {
      skipped.push({
        activityId: activity.id,
        title: activity.title,
        minutes: activity.minutes,
        reason: activity.skipReason || 'Skipped: your vault already covers this.'
      });
    } else {
      path.push(pathEntry(activity, activity.includeReason || 'Included.'));
    }
  }

  return {
    path,
    skipped,
    fullMinutes: FULL_MINUTES,
    personalMinutes: path.reduce((sum, item) => sum + item.minutes, 0)
  };
}

/* ------------------------------------------------------------------ */
/* Graders                                                             */
/* ------------------------------------------------------------------ */

function claim(concept, ability, evidenceType, result, difficulty) {
  return { concept, ability, evidenceType, result, difficulty };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function uniqueStrings(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (typeof item === 'string' && !out.includes(item)) out.push(item);
  }
  return out;
}

/**
 * Keywords are stems, not whole words: the match is anchored at a word
 * boundary on the left and left open on the right, so 'unit test' also
 * matches "unit tests" and "unit testing", and 'verif' matches "verifier",
 * "verify" and "verification". Anchoring on the left is what keeps
 * "unittests" and "taskoutcomes" from counting.
 */
function keywordHit(text, keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('\\b' + escaped, 'i').test(text);
}

function gradeLesson(activity, submission) {
  const completed = submission && submission.completed === true;
  if (!completed) {
    return {
      result: 'failed',
      score: 0,
      feedback: ['Mark the lesson complete once you have read all three sections.'],
      claims: []
    };
  }
  const exposure = activity.content.exposureClaim;
  return {
    result: 'passed',
    score: 1,
    feedback: [
      'Lesson complete. This produces an exposure receipt, the weakest kind of evidence: it records that you read the material, not that you can use it.'
    ],
    claims: [
      claim(exposure.concept, exposure.ability, exposure.evidenceType, 'passed', activity.difficulty)
    ]
  };
}

function gradeDiagnostic(activity, submission) {
  const { answerKey, options } = activity.content;
  const optionId = submission && typeof submission.optionId === 'string' ? submission.optionId : '';
  const chosen = options.find((o) => o.id === optionId);

  if (!chosen) {
    return {
      result: 'failed',
      score: 0,
      feedback: ['Pick one of the four schemas.'],
      claims: []
    };
  }

  if (chosen.id !== answerKey) {
    return {
      result: 'failed',
      score: 0,
      feedback: [chosen.whyWrong, 'Read the two payloads again and try once more.'],
      claims: []
    };
  }

  // Hints are not a penalty here. How many were open travels to the vault in
  // conditions.hintsUsed, and the vault decides what that is worth.
  return {
    result: 'passed',
    score: 1,
    feedback: [activity.content.explanation],
    claims: [claim('nema:json-schema', 'apply', 'application', 'passed', activity.difficulty)]
  };
}

function gradeLab(activity, submission) {
  const { answerKey, checks, stages } = activity.content;
  const validCheckIds = checks.map((c) => c.id);
  const selected = uniqueStrings(submission && submission.checks).filter((id) =>
    validCheckIds.includes(id)
  );
  const order = uniqueStrings(submission && submission.stageOrder).filter((id) =>
    stages.some((s) => s.id === id)
  );

  const requiredHit = answerKey.requiredChecks.filter((id) => selected.includes(id));
  const harmfulHit = answerKey.harmfulChecks.filter((id) => selected.includes(id));
  const allRequired = requiredHit.length === answerKey.requiredChecks.length;
  const noHarmful = harmfulHit.length === 0;
  const orderOk =
    order.length === answerKey.stageOrder.length &&
    order.every((id, i) => id === answerKey.stageOrder[i]);

  const feedback = [];

  if (allRequired && noHarmful && orderOk) {
    feedback.push(
      'The harness now answers the question the ticket asked. The task eval calls the real endpoint, the scope check catches the billing file, and the migration assertion refuses to call an unapplied migration finished work.'
    );
    feedback.push(
      'Order matters as much as content: the verifier feedback reaches the agent first, so the agent repairs its own work, and only then does the gate decide.'
    );
    return {
      result: 'passed',
      score: 1,
      feedback,
      claims: [
        claim('nema:agent-evals', 'apply', 'application', 'passed', activity.difficulty),
        claim('nema:feedback-loops', 'discriminate', 'discrimination', 'passed', activity.difficulty)
      ]
    };
  }

  if (allRequired && noHarmful) {
    feedback.push('The three checks are right. The stages are not in a workable order.');
    feedback.push(
      'A gate that runs before the feedback reaches the agent decides on a run the agent never had the chance to repair.'
    );
    return {
      result: 'partial',
      score: 0.7,
      feedback,
      claims: [claim('nema:agent-evals', 'apply', 'application', 'partial', activity.difficulty)]
    };
  }

  if (!allRequired) {
    const missing = answerKey.requiredChecks.length - requiredHit.length;
    feedback.push(
      missing === 1
        ? 'One necessary check is still missing. Walk the incident again: which of the three symptoms is nothing in the harness watching for.'
        : missing + ' necessary checks are still missing. Walk the incident again, symptom by symptom.'
    );
  }
  if (!noHarmful) {
    feedback.push(
      'At least one selected check makes the harness better at hiding a failure rather than finding one. Remove anything that lets a bad run end green.'
    );
  }
  if (!orderOk) {
    feedback.push('The three stages also need an order that lets the agent act on feedback before the gate decides.');
  }

  const score = round2(
    Math.max(
      0,
      (requiredHit.length / answerKey.requiredChecks.length) * 0.6 -
        harmfulHit.length * 0.2 +
        (orderOk ? 0.2 : 0)
    )
  );

  return { result: 'failed', score, feedback, claims: [] };
}

function gradeFreeRecall(activity, submission) {
  const { rubric, minWords } = activity.content;
  const text = submission && typeof submission.text === 'string' ? submission.text : '';
  const words = text.trim().split(/\s+/).filter(Boolean);
  const met = rubric.filter((criterion) => criterion.keywords.some((k) => keywordHit(text, k)));
  const metIds = met.map((c) => c.id);
  const missed = rubric.filter((c) => !metIds.includes(c.id));

  if (words.length < minWords) {
    return {
      result: 'failed',
      score: 0,
      feedback: [
        'Too short to grade. Write at least ' +
          minWords +
          ' words, this answer has ' +
          words.length +
          '.'
      ],
      claims: []
    };
  }

  const feedback = [];
  if (metIds.length === rubric.length) {
    feedback.push(
      'All ' + rubric.length + ' rubric criteria are covered. This is recorded as a rubric graded explanation.'
    );
  } else {
    feedback.push(metIds.length + ' of ' + rubric.length + ' rubric criteria are covered.');
    for (const criterion of missed) {
      feedback.push('Still missing: ' + criterion.criterion);
    }
  }

  // Every criterion is a pass, one short is a partial, anything less is a fail.
  const result =
    metIds.length === rubric.length
      ? 'passed'
      : metIds.length > 0 && metIds.length === rubric.length - 1
        ? 'partial'
        : 'failed';
  const score = round2(metIds.length / rubric.length);

  return {
    result,
    score,
    feedback,
    claims:
      result === 'failed'
        ? []
        : [claim('nema:agent-evals', 'explain', 'explanation', result, activity.difficulty)]
  };
}

/**
 * grade(activityId, submission) -> { result, score, feedback, claims }
 *
 * Deterministic and side effect free. The worker re-grades every submission
 * before it signs a receipt, so the browser can never talk a receipt into
 * existence by posting a result.
 */
export function grade(activityId, submission) {
  const activity = ACTIVITIES[activityId];
  if (!activity) {
    return {
      result: 'failed',
      score: 0,
      feedback: ['Unknown activity: ' + String(activityId)],
      claims: []
    };
  }

  switch (activity.type) {
    case 'lesson':
      return gradeLesson(activity, submission);
    case 'diagnostic':
      return gradeDiagnostic(activity, submission);
    case 'interactive-lab':
      return gradeLab(activity, submission);
    case 'free-recall':
      return gradeFreeRecall(activity, submission);
    default:
      return {
        result: 'failed',
        score: 0,
        feedback: ['No grader for activity type ' + activity.type + '.'],
        claims: []
      };
  }
}
