/* nema vault: the WebMCP surface.
 *
 * Nine imperative tools, registered through /shared/webmcp.js so every call is
 * timed, normalized and pushed into the activity strip. A tenth tool, the
 * declarative `set_learning_goal_form`, lives in index.html.
 *
 * What is deliberately missing is as much of the design as what is here. There
 * is no set_mastery, no get_full_history, no submit_answer_for_learner, no
 * disable_review and no export_vault. An agent cannot write a band, read the
 * evidence history of another site, answer for the learner, or lift the whole
 * document out of the browser.
 */

import { registerTools, EXPOSED_TO } from '/shared/webmcp.js';
import { ABILITIES } from '/shared/inference.js';
import * as vault from '/vault.js';

const PRIVACY = 'Only bands are returned. Evidence history never leaves the vault.';

/** Tell the page which panel a tool call just touched, so the screen moves. */
function highlight(panel, note) {
  document.dispatchEvent(new CustomEvent('nema:vault-highlight', { detail: { panel, note } }));
}

function minutesUntil(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round((ms - Date.now()) / 60000));
}

function stateRows(ids) {
  const { state, now } = vault.derived();
  const asked = Array.isArray(ids) && ids.length > 0;
  const wanted = asked ? ids : Object.keys(state).sort();
  return wanted.map((concept) => {
    const abilities = state[concept] || {};
    const bands = {};
    /* A concept the caller named explicitly answers for every ability, so
     * "no evidence" comes back as `unknown` rather than as an absent key that
     * an agent could read as an omission. An unfiltered listing stays terse
     * and only names the abilities that have evidence. */
    if (asked) {
      for (const ability of ABILITIES) bands[ability] = 'unknown';
    }
    let soonest = null;
    let due = false;
    for (const [ability, entry] of Object.entries(abilities)) {
      bands[ability] = entry.band;
      if (entry.nextReview && (soonest === null || entry.nextReview < soonest)) soonest = entry.nextReview;
      if (entry.reviewDue) due = true;
    }
    return {
      concept,
      title: vault.conceptTitle(concept),
      bands,
      nextReview: soonest,
      reviewDue: due || (soonest !== null && soonest < now)
    };
  });
}

function signatureOf(entry) {
  if (entry.status === 'pending') return 'pending';
  if (entry.payload && entry.payload.keyId === 'agent') return 'agent';
  return 'verified';
}

export function evidenceRows(limit) {
  const receipts = vault.getReceipts();
  const rows = receipts.slice().reverse();
  const capped = Number.isFinite(limit) && limit > 0 ? rows.slice(0, limit) : rows;
  return capped.map((entry) => ({
    receiptId: entry.receiptId,
    issuerName: vault.issuerName(entry.payload),
    activity: entry.payload && entry.payload.activity ? entry.payload.activity.title : 'unknown activity',
    claims: (entry.payload && entry.payload.claims ? entry.payload.claims : []).map((claim) => ({
      concept: claim.concept,
      ability: claim.ability,
      result: claim.result
    })),
    grader: entry.payload && entry.payload.conditions && entry.payload.conditions.grader
      ? entry.payload.conditions.grader
      : 'unspecified',
    signature: signatureOf(entry),
    trust: vault.trustOf(entry),
    receivedAt: entry.receivedAt,
    effect: entry.effect || []
  }));
}

export function disclosureRows() {
  return vault.getDisclosures().slice().reverse().map((entry) => ({
    audience: entry.audience,
    audienceName: entry.audienceName,
    purpose: entry.purpose,
    shared: entry.shared,
    withheld: entry.withheld,
    sharedAt: entry.sharedAt,
    expiresAt: entry.expiresAt,
    expiresInMinutes: minutesUntil(entry.expiresAt)
  }));
}

export const TOOLS = [
  {
    name: 'get_vault_summary',
    description:
      'Read the counts the vault shows in its summary strip: concepts with evidence, how many are durable, usable or fragile, how many reviews are due, and how many receipts, pending receipts, disclosures and goals the vault holds. Updates the summary panel on screen. ' + PRIVACY,
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    execute() {
      const { summary } = vault.derived();
      const receipts = vault.getReceipts();
      highlight('summary', 'summary read by the agent');
      return {
        status: 'ok',
        concepts: summary.concepts,
        durable: summary.durable,
        usable: summary.usable,
        fragile: summary.fragile,
        uncertain: summary.uncertain,
        reviewsDue: summary.reviewsDue,
        goals: vault.getGoals().map((goal) => ({ goalId: goal.goalId, title: goal.title })),
        receipts: receipts.length,
        pendingReceipts: receipts.filter((entry) => entry.status === 'pending').length,
        disclosures: vault.getDisclosures().length
      };
    }
  },

  {
    name: 'get_learner_state',
    description:
      'Read the learner state table: one row per concept with a band per ability and the next review date. Pass concept ids to narrow it. Highlights the state table and the learning graph on screen. ' + PRIVACY,
    inputSchema: {
      type: 'object',
      properties: {
        concepts: {
          type: 'array',
          items: { type: 'string' },
          description: 'Concept ids such as nema:pan-sauces. Omit for every concept that has evidence.'
        }
      },
      required: [],
      additionalProperties: false
    },
    execute(args) {
      const rows = stateRows(args.concepts);
      highlight('state', `${rows.length} concept${rows.length === 1 ? '' : 's'} read by the agent`);
      return { status: 'ok', state: rows };
    }
  },

  {
    name: 'set_learning_goal',
    description:
      'Set an active learning goal from a title and a list of concept ids. Goals only re-order learning needs: they never create evidence and never move a band. Adds the goal to the goals panel on screen.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short title of the goal, in the words the learner used.' },
        concepts: {
          type: 'array',
          items: { type: 'string' },
          description: 'Concept ids from the nema registry, for example nema:pan-sauces.'
        }
      },
      required: ['title', 'concepts'],
      additionalProperties: false
    },
    execute(args) {
      const result = vault.addGoal({ title: args.title, concepts: args.concepts });
      highlight('goals', result.status === 'ok' ? 'goal set by the agent' : 'goal rejected');
      return result;
    }
  },

  {
    name: 'create_readiness_assertion',
    description:
      'Ask the learner to disclose status bands for the concepts a site needs, and return a signed, audience bound assertion that expires in 30 minutes. The learner must approve the disclosure in the page before a token is returned. Opens the consent modal on screen and waits up to 120 seconds. ' + PRIVACY,
    inputSchema: {
      type: 'object',
      properties: {
        audience: { type: 'string', description: 'Origin of the site that will verify the token, for example https://saucier.migarci2.dev.' },
        purpose: { type: 'string', description: 'Short machine readable purpose, for example personalize-pan-sauces-path.' },
        requirements: {
          type: 'array',
          description: 'The concept and ability pairs the site asked about. Nothing outside this list can be disclosed.',
          items: {
            type: 'object',
            properties: {
              concept: { type: 'string' },
              ability: { type: 'string' }
            },
            required: ['concept', 'ability'],
            additionalProperties: false
          }
        }
      },
      required: ['audience', 'purpose', 'requirements'],
      additionalProperties: false
    },
    async execute(args) {
      highlight('disclosures', 'waiting for the learner to decide');
      const result = await vault.createAssertion(args);
      highlight('disclosures', `disclosure ${result.status}`);
      return result;
    }
  },

  {
    name: 'stage_evidence_receipt',
    description:
      'Hand a signed evidence receipt to the vault. The vault checks the issuer against its trusted list, verifies the signature, rejects duplicates, recomputes the learner state and returns the exact bands that moved. The result names the trust tier it earned: registered (a key in the trusted list), origin (a key the issuer publishes at /.well-known/nema-issuer.json), self (a key the receipt carries, worth a self report at most) or pending (nothing could check it, so nothing moved). Adds a row to the evidence ledger on screen.',
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'A compact nema1 evidence receipt token issued by a provider.' }
      },
      required: ['token'],
      additionalProperties: false
    },
    async execute(args) {
      const result = await vault.stageReceipt(args.token, { source: 'agent' });
      /* The inbox panel reports the outcome of a staged receipt whether a
       * person pasted it or an agent handed it over, so a rejection is visible
       * on screen and not only in a tool result the learner never sees. */
      document.dispatchEvent(new CustomEvent('nema:vault-staged', { detail: result }));
      highlight('evidence', `receipt ${result.status}`);
      return result;
    }
  },

  {
    name: 'get_learning_needs',
    description:
      'Ask the vault what to study next. Returns ordered learning needs derived from the state, the active goals and the recorded misconceptions, each with a kind, a reason, minutes and a rubric. Pass budgetMinutes to fill a session of that length. Updates the needs panel on screen. ' + PRIVACY,
    inputSchema: {
      type: 'object',
      properties: {
        budgetMinutes: { type: 'number', description: 'Minutes the learner has right now. Omit for the full ordered list.' }
      },
      required: [],
      additionalProperties: false
    },
    execute(args) {
      const budget = Number.isFinite(args.budgetMinutes) ? args.budgetMinutes : undefined;
      const needs = vault.getNeeds(budget);
      highlight('needs', `${needs.length} need${needs.length === 1 ? '' : 's'} planned`);
      document.dispatchEvent(new CustomEvent('nema:vault-needs', { detail: { budgetMinutes: budget ?? null, needs } }));
      return { status: 'ok', budgetMinutes: budget ?? null, needs };
    }
  },

  {
    name: 'record_agent_assessment',
    description:
      'Record the result of an assessment the agent ran against the vault rubric for one learning need. The learner answers, the agent grades criterion by criterion, and the vault stores it as an unsigned receipt with grader agent-assessed, weight 0.6, labelled as agent evidence in the ledger. Needs an id from get_learning_needs: an unknown need id is rejected. Adds a row to the evidence ledger on screen.',
    inputSchema: {
      type: 'object',
      properties: {
        needId: { type: 'string', description: 'The needId returned by get_learning_needs.' },
        rubricResults: {
          type: 'array',
          description: 'One entry per rubric criterion of that need, with the judgement the agent made.',
          items: {
            type: 'object',
            properties: {
              criterion: { type: 'string' },
              met: { type: 'boolean' }
            },
            required: ['criterion', 'met'],
            additionalProperties: false
          }
        },
        learnerAnswerSummary: { type: 'string', description: 'One or two sentences summarising what the learner actually said.' }
      },
      required: ['needId', 'rubricResults', 'learnerAnswerSummary'],
      additionalProperties: false
    },
    async execute(args) {
      const result = await vault.recordAgentAssessment(args);
      highlight('evidence', `agent assessment ${result.status}`);
      return result;
    }
  },

  {
    name: 'get_disclosure_ledger',
    description:
      'List every disclosure the learner approved: audience, purpose, the exact bands shared, when it was shared and when it expires. This is the audit trail the learner keeps of what left the vault. Highlights the disclosure ledger on screen.',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    execute() {
      const disclosures = disclosureRows();
      highlight('disclosures', 'disclosure ledger read');
      return { status: 'ok', disclosures };
    }
  },

  {
    name: 'get_evidence_ledger',
    description:
      'List the receipts the vault holds, newest first: issuer, activity, claims, grader, signature state, trust tier and the effect each one had on the learner state. This is the view the learner has of their own ledger, and it is never included in a disclosure. Highlights the evidence ledger on screen.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'How many receipts to return, newest first. Omit for all of them.' }
      },
      required: [],
      additionalProperties: false
    },
    execute(args) {
      const limit = Number.isFinite(args.limit) ? args.limit : undefined;
      const receipts = evidenceRows(limit);
      highlight('evidence', `${receipts.length} receipt${receipts.length === 1 ? '' : 's'} read`);
      return { status: 'ok', receipts };
    }
  }
];

/** Register the nine imperative tools. The declarative form is in the HTML. */
export async function register() {
  return registerTools(TOOLS, { exposedTo: EXPOSED_TO });
}
