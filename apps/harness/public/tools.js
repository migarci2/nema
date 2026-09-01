/**
 * nema harness lab: the WebMCP tools.
 *
 * Five tools, exactly the ones in contract section 10. What is missing matters
 * as much as what is here: nothing submits an answer, nothing grades, nothing
 * writes to the learner's vault, and nothing returns an answer key. The agent
 * can describe the offer, present an assertion the learner approved, open an
 * activity, poll the attempt and ask for the signed receipt.
 *
 * Every tool changes something on screen before it returns.
 */

import { registerTools, EXPOSED_TO } from '/shared/webmcp.js';
import { verifyAssertion } from '/shared/protocol.js';

const EMPTY_SCHEMA = { type: 'object', properties: {}, required: [], additionalProperties: false };

function activitySchema(description) {
  return {
    type: 'object',
    properties: { activityId: { type: 'string', description } },
    required: ['activityId'],
    additionalProperties: false
  };
}

export async function registerHarnessTools(app) {
  const { MANIFEST, ACTIVITIES } = app;
  const activityIds = MANIFEST.activities.map((entry) => entry.id);

  const tools = [
    {
      name: 'describe_learning_offer',
      description:
        'Return the LearningManifest of this unit: outcomes, requirements, and every activity with its minutes and grader. Highlights the unit panel on screen. Nothing about the learner is read or written.',
      inputSchema: EMPTY_SCHEMA,
      async execute() {
        app.setBanner(
          `Offer described to the agent: ${MANIFEST.activities.length} activities, ` +
            `${MANIFEST.unit.estimatedMinutes} minutes, ${MANIFEST.requirements.length} requirements.`,
          'info'
        );
        app.flashUnit();
        app.scrollToUnit();
        return { status: 'ok', manifest: MANIFEST };
      }
    },

    {
      name: 'personalize_learning_path',
      description:
        'Present a ReadinessAssertion the learner approved in their vault and rebuild the path from it. Verifies the signature, the audience and the expiry, then fills the requirement pills, strikes through the activities the learner can skip with the reason for each, and updates the minutes counter on screen. Returns the personalized path. The learner must approve the disclosure in their vault before a token exists.',
      inputSchema: {
        type: 'object',
        properties: {
          assertionToken: {
            type: 'string',
            description: 'A compact nema1. ReadinessAssertion token minted for this origin.'
          }
        },
        required: ['assertionToken'],
        additionalProperties: false
      },
      async execute({ assertionToken }) {
        if (typeof assertionToken !== 'string' || assertionToken.trim() === '') {
          app.setBanner('An assertion was presented but it was empty.', 'error');
          return { status: 'rejected', reason: 'malformed' };
        }

        const verified = await verifyAssertion(assertionToken.trim(), {
          audience: location.origin,
          now: new Date()
        });

        if (!verified.ok) {
          app.setBanner(
            `Readiness assertion rejected: ${verified.reason}. The path is unchanged.`,
            'error'
          );
          app.flashUnit();
          app.scrollToUnit();
          return { status: 'rejected', reason: verified.reason };
        }

        const payload = verified.payload;
        const result = app.applyPersonalization(payload);

        return {
          status: 'personalized',
          learnerKeyId: payload.learnerKeyId,
          requirements: MANIFEST.requirements.map((requirement) => {
            const found = payload.assertions.find(
              (entry) => entry.concept === requirement.concept && entry.ability === requirement.ability
            );
            return {
              concept: requirement.concept,
              ability: requirement.ability,
              status: found ? found.status : 'missing'
            };
          }),
          path: result.path,
          skipped: result.skipped.map((item) => ({ activityId: item.activityId, reason: item.reason })),
          fullMinutes: result.fullMinutes,
          personalMinutes: result.personalMinutes
        };
      }
    },

    {
      name: 'start_activity',
      description:
        'Open one activity in the page and scroll to it, so the learner can do it. Returns what the learner has to do. This tool navigates only: there is no tool on this site that submits an answer or grades one. Poll get_attempt_status to see what the learner did.',
      inputSchema: activitySchema(`One of: ${activityIds.join(', ')}.`),
      async execute({ activityId }) {
        const activity = ACTIVITIES[activityId];
        if (!activity) {
          return { status: 'rejected', reason: 'unknown-activity', available: activityIds };
        }
        app.openActivity(activityId, { source: 'tool' });
        return {
          status: 'started',
          activityId: activity.id,
          title: activity.title,
          type: activity.type,
          minutes: activity.minutes,
          whatTheLearnerDoes: activity.whatTheLearnerDoes,
          note: 'The learner completes this in the page. Poll get_attempt_status.'
        };
      }
    },

    {
      name: 'get_attempt_status',
      description:
        'Read what the learner has done on one activity: not_started, in_progress, passed or failed, with attempts, hints used and time spent. Once the learner has submitted, the grader result and the grader feedback sentences shown on screen are returned too. Shows the poll on screen next to the activity. Never returns the learner submission, the answer or the answer key.',
      inputSchema: activitySchema(`One of: ${activityIds.join(', ')}.`),
      async execute({ activityId }) {
        const activity = ACTIVITIES[activityId];
        if (!activity) {
          return { status: 'rejected', reason: 'unknown-activity', available: activityIds };
        }
        const attempt = app.attemptFor(activityId);
        const line =
          `Agent polled get_attempt_status: ${attempt.status}, ${attempt.attempts} attempt` +
          `${attempt.attempts === 1 ? '' : 's'}, ${attempt.hintsUsed} hint${attempt.hintsUsed === 1 ? '' : 's'}.`;

        if (app.getState().openActivityId === activityId) {
          app.setAgentNote(line);
          app.flashStage();
        } else {
          app.setBanner(`${activity.title}: ${line}`, 'info');
          app.flashPath();
        }

        const out = {
          status: attempt.status,
          attempts: attempt.attempts,
          hintsUsed: attempt.hintsUsed,
          durationSeconds: attempt.durationSeconds
        };
        if (attempt.result) out.result = attempt.result;
        if (attempt.feedback && attempt.feedback.length > 0) out.feedback = attempt.feedback;
        return out;
      }
    },

    {
      name: 'issue_evidence_receipt',
      description:
        'Ask the provider to sign an EvidenceReceipt for an activity the learner passed. The worker re-grades the stored submission before it signs, so a receipt cannot be talked into existence. Renders the signed token and its decoded claims in the receipt panel. Idempotent: the stored token is returned on a repeat call.',
      inputSchema: activitySchema(`One of: ${activityIds.join(', ')}.`),
      async execute({ activityId }) {
        const activity = ACTIVITIES[activityId];
        if (!activity) {
          return { status: 'rejected', reason: 'unknown-activity', available: activityIds };
        }

        const result = await app.issueReceipt(activityId);
        if (result.status !== 'issued') {
          app.setBanner(
            `No receipt for ${activity.title}: the learner has not passed it yet.`,
            'error'
          );
          return { status: 'not-passed', activityId, reason: result.reason };
        }

        return {
          status: 'issued',
          token: result.token,
          claims: result.payload.claims,
          activity: result.payload.activity,
          hint: 'Take this token to the vault and call stage_evidence_receipt.'
        };
      }
    }
  ];

  const registered = await registerTools(tools, { exposedTo: EXPOSED_TO });
  return registered;
}
