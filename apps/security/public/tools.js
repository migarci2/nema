/**
 * nema WebMCP tools: Agent Security provider (contract section 10).
 *
 * Five tools, registered through the shared helper so every call is normalized,
 * broadcast on `nema:toolcall` and drawn in the activity strip. The controller
 * functions live in app.js: a tool call and a click take the same path and
 * repaint the same screen.
 *
 * What is deliberately absent: nothing here submits an answer, marks mastery or
 * reads the learner's history. The agent can describe the unit, present an
 * assertion the learner approved, open an activity, poll it and collect the
 * receipt once the learner passed. The work stays with the human.
 */

import { registerTools, EXPOSED_TO } from '/shared/webmcp.js';

const NO_INPUT = { type: 'object', properties: {}, required: [], additionalProperties: false };

const ACTIVITY_INPUT = {
  type: 'object',
  properties: {
    activityId: {
      type: 'string',
      description:
        'Activity id from the manifest: tool-calling-intro, threat-modeling-intro, feedback-loop-attack-surface or injection-triage-advanced.'
    }
  },
  required: ['activityId'],
  additionalProperties: false
};

/**
 * Register the five provider tools.
 * @param {object} controller functions exported by app.js
 * @returns {Promise<string[]>} the names that registered
 */
export async function registerSecurityTools(controller) {
  const tools = [
    {
      name: 'describe_learning_offer',
      description:
        'Return the learning manifest for the unit "Feedback Loop Attack Surface": activities, outcomes, requirements and minutes. The page notes on screen that the manifest was handed to the agent. Read only, nothing is stored.',
      inputSchema: NO_INPUT,
      execute: () => controller.describeOffer()
    },
    {
      name: 'check_prerequisites',
      description:
        'Verify a readiness assertion minted for this origin and unlock the unit against it. The prerequisites panel fills in with the recognised concepts, their status bands and the source, and every activity gains a lock state. Returns the recognised requirements, the unlocked, locked and skippable activities, and which one to do first. The learner approves the disclosure in the vault before the agent can pass a token here.',
      inputSchema: {
        type: 'object',
        properties: {
          assertionToken: {
            type: 'string',
            description: 'A compact nema1. readiness assertion whose audience is this provider origin.'
          }
        },
        required: ['assertionToken'],
        additionalProperties: false
      },
      execute: (args) => controller.presentAssertion(String(args.assertionToken || ''))
    },
    {
      name: 'start_activity',
      description:
        'Open one activity in the activity stage and scroll the page to it. Navigation only: it returns what the learner has to do, and it cannot answer anything. A locked activity opens on its lock screen and the tool reports what is missing. Poll get_attempt_status afterwards.',
      inputSchema: ACTIVITY_INPUT,
      execute: (args) => controller.startActivity(String(args.activityId || ''))
    },
    {
      name: 'get_attempt_status',
      description:
        'Report where the learner is on one activity: not_started, in_progress, passed or failed, with attempts, hints used, seconds spent and the grader feedback once it exists. Read only.',
      inputSchema: ACTIVITY_INPUT,
      execute: (args) => controller.attemptStatus(String(args.activityId || ''))
    },
    {
      name: 'issue_evidence_receipt',
      description:
        'Ask this provider to sign an evidence receipt for an activity the learner already passed. The worker re-grades the stored submission before signing, so a receipt can never claim more than the learner did. The signed token appears in the receipt panel with its decoded claims and a link to the vault. Idempotent: the same activity returns the same token. Returns not-passed when there is nothing to certify.',
      inputSchema: ACTIVITY_INPUT,
      execute: (args) => controller.issueReceipt(String(args.activityId || ''))
    }
  ];

  return registerTools(tools, { exposedTo: EXPOSED_TO });
}
