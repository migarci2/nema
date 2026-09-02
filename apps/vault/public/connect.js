/* nema vault: the connect window (contract section 25).
 *
 * A site opens this page in a popup with a request in the hash, the learner
 * answers here, and the answer is posted back to the window that opened it.
 * That is the whole file.
 *
 * It is a popup and not an iframe for one reason: storage. A popup is a top
 * level window on the vault's own origin, so `nema.vault.v1` is the same
 * document the vault page reads. Chrome partitions third party iframe storage,
 * so an embedded vault would be a different, empty vault per site.
 *
 * What is deliberately missing:
 *
 *   - no WebMCP tools. An agent that can reach a vault reaches the vault page,
 *     which registers all of them. This window exists for the learner, and
 *     registering tools here would only give an agent a second door.
 *   - no graph, no ledgers, no needs. One question, two buttons.
 *
 * It runs the same `vault.js` as the vault page, so the consent modal, the
 * disclosure ledger, the auto approval rule and the staging pipeline are the
 * same code. The only thing this file owns is the question on the screen and
 * the `postMessage` at the end.
 */

import { markSvg, escapeHtml } from '/shared/brand/brand.js';
import { decodeToken } from '/shared/protocol.js';
import {
  ASSERTION_MESSAGE,
  RECEIPT_MESSAGE,
  decodeRequest,
  isOrigin,
  trimOrigin
} from '/shared/vault-link.js';
import * as vault from '/vault.js';

const esc = escapeHtml;

/** How long the result stays on screen before the window closes itself. */
const CLOSE_AFTER_MS = 1500;

const refs = {
  title: document.querySelector('[data-connect-title]'),
  line: document.querySelector('[data-connect-line]'),
  origin: document.querySelector('[data-connect-origin]'),
  moved: document.querySelector('[data-connect-moved]'),
  note: document.querySelector('[data-connect-note]'),
  back: document.querySelector('[data-connect-back]'),
  modal: document.querySelector('#consent-modal'),
  dialog: document.querySelector('#consent-modal .n-modal__dialog'),
  approve: document.querySelector('[data-consent-approve]'),
  deny: document.querySelector('[data-consent-deny]'),
  auto: document.querySelector('[data-consent-auto]'),
  timer: document.querySelector('[data-consent-timer]')
};

/* --------------------------------------------------------------- screen -- */

function say(title, line, { origin = '', moved = [], kind = 'info' } = {}) {
  refs.title.textContent = title;
  refs.line.textContent = line;
  refs.line.dataset.kind = kind;
  refs.origin.hidden = origin === '';
  refs.origin.textContent = origin;
  refs.moved.hidden = moved.length === 0;
  refs.moved.innerHTML = moved.map((text) => `<span>${esc(text)}</span>`).join('');
}

/** The bands a receipt moved, in the learner's words. */
function movedWords(changes) {
  return (Array.isArray(changes) ? changes : []).map(
    (change) => `${vault.shortConcept(change.concept)} ${change.ability}, now ${change.to}`
  );
}

/**
 * A window opened by hand has no opener to answer, so it says the same thing
 * and offers the way back instead of closing itself.
 */
function done() {
  if (window.opener) {
    setTimeout(() => window.close(), CLOSE_AFTER_MS);
    return;
  }
  refs.note.textContent = 'Nothing opened this window, so there is nobody to answer.';
  refs.back.hidden = false;
}

/**
 * Answer the site, and only that site. `targetOrigin` is never '*': the whole
 * point of the handshake is that the vault chooses who hears the answer.
 */
function answer(targetOrigin, message) {
  if (!window.opener || !isOrigin(targetOrigin)) return;
  try {
    window.opener.postMessage(message, targetOrigin);
  } catch (err) {
    console.warn('[nema] the site that opened this window could not be answered:', err && err.message);
  }
}

/* --------------------------------------------------- consent, compact -- */

let consentState = null;

function trapFocus(event) {
  if (!consentState) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    consentState.settle({ approved: false });
    return;
  }
  if (event.key !== 'Tab') return;
  const items = Array.from(
    refs.modal.querySelectorAll('button, input, [href], [tabindex]:not([tabindex="-1"])')
  ).filter((el) => !el.hasAttribute('disabled'));
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function statusPill(status) {
  if (status === 'verified') return 'n-pill n-pill--durable';
  if (status === 'uncertain') return 'n-pill n-pill--uncertain';
  return 'n-pill n-pill--unknown';
}

/**
 * The same question the vault page asks, in a window the size of the question.
 * `vault.createAssertion` awaits this before it signs anything, so no token
 * exists until a human clicks Approve here.
 */
function askForConsent(request, { signal }) {
  return new Promise((resolve) => {
    if (consentState !== null) {
      resolve({ approved: false, busy: true });
      return;
    }

    document.querySelector('[data-consent-title]').textContent = `${request.audienceName} asks to know`;
    document.querySelector('[data-consent-origin]').textContent = request.audience;
    document.querySelector('[data-consent-purpose]').textContent = `Purpose: ${request.purpose}`;
    document.querySelector('[data-consent-shared]').innerHTML = request.shared.map((item) => `
      <div class="n-ledger__row">
        <span class="n-ledger__main">
          <span class="n-ledger__title">${esc(item.title)}</span>
          <span class="n-ledger__meta"><span class="mono">${esc(item.concept)}.${esc(item.ability)}</span>${item.alignedTo ? ` read as <span class="mono">${esc(item.alignedTo)}</span>` : ''}${item.reason === 'unaligned' ? ', a name this vault has not aligned' : ''}</span>
        </span>
        <span class="n-ledger__end"><span class="${statusPill(item.status)}">${esc(item.status)}</span></span>
      </div>`).join('');
    document.querySelector('[data-consent-withheld]').innerHTML = request.withheld
      .map((item) => `<li>${esc(item)}</li>`).join('');
    document.querySelector('[data-consent-expiry]').textContent = `Expires in ${request.ttlMinutes} minutes`;
    refs.auto.checked = false;

    refs.modal.hidden = false;
    refs.dialog.focus();

    let countdown = Math.round(vault.CONSENT_TIMEOUT_MS / 1000);
    const paint = () => {
      refs.timer.textContent = `${countdown} s to decide`;
    };
    paint();
    const timer = setInterval(() => {
      countdown = Math.max(0, countdown - 1);
      paint();
    }, 1000);

    const settle = (result) => {
      if (consentState === null) return;
      consentState = null;
      clearInterval(timer);
      refs.modal.hidden = true;
      document.removeEventListener('keydown', trapFocus, true);
      refs.approve.removeEventListener('click', onApprove);
      refs.deny.removeEventListener('click', onDeny);
      resolve(result);
    };

    function onApprove() {
      settle({ approved: true, autoApprove: refs.auto.checked });
    }
    function onDeny() {
      settle({ approved: false });
    }

    consentState = { settle };
    refs.approve.addEventListener('click', onApprove);
    refs.deny.addEventListener('click', onDeny);
    document.addEventListener('keydown', trapFocus, true);
    signal.addEventListener('abort', () => settle({ approved: false, timedOut: true }), { once: true });
  });
}

/* ---------------------------------------------------------- the request -- */

async function runAssertion(encoded, returnOrigin) {
  let request;
  try {
    request = decodeRequest(encoded);
  } catch {
    say('That request could not be read', 'The address this window was opened with is not a nema request.', { kind: 'bad' });
    done();
    return;
  }

  /* The one check that makes the handshake safe: the answer goes to the site
   * the request is addressed to, so a page cannot open this window with
   * somebody else's request and collect the token. */
  if (trimOrigin(request.audience) !== returnOrigin) {
    say(
      'This request is not addressed to the site that opened it',
      `The request names ${request.audience || 'no audience'}, and this window was opened by ${returnOrigin}. Nothing was shared.`,
      { kind: 'bad' }
    );
    done();
    return;
  }

  say('Connect your vault', `${vault.audienceName(request.audience)} opened this window to ask. Read the question, then decide.`, {
    origin: request.audience
  });

  const result = await vault.createAssertion({
    audience: request.audience,
    purpose: request.purpose,
    requirements: request.requirements
  });

  if (result.status === 'approved') {
    answer(request.audience, { type: ASSERTION_MESSAGE, status: 'approved', token: result.token });
    say('Shared. You can close this window', `${vault.audienceName(request.audience)} was told your bands for ${result.shared.length} thing${result.shared.length === 1 ? '' : 's'}, and nothing else.`, {
      origin: request.audience,
      moved: result.shared.map((item) => `${vault.shortConcept(item.concept)} ${item.ability}: ${item.status}`)
    });
  } else if (result.status === 'denied') {
    answer(request.audience, { type: ASSERTION_MESSAGE, status: 'denied' });
    say('Nothing was shared', 'You said no, so no token was signed and the site was told only that.', {
      origin: request.audience
    });
  } else {
    answer(request.audience, {
      type: ASSERTION_MESSAGE,
      status: result.status,
      reason: result.hint || result.error || 'the vault could not answer'
    });
    say('Nothing was shared', result.hint || result.error || 'The vault could not answer that request.', {
      origin: request.audience,
      kind: 'bad'
    });
  }
  done();
}

/* ---------------------------------------------------------- the receipt -- */

function receiptLine(token) {
  try {
    const { payload } = decodeToken(token);
    if (payload && payload.type === 'evidence-receipt') {
      return `${vault.issuerName(payload)} signed this for "${payload.activity ? payload.activity.title : 'an activity'}".`;
    }
  } catch {
    /* An unreadable token is still staged, and staging is what names the fault. */
  }
  return 'A site handed your vault a receipt.';
}

async function runReceipt(token, returnOrigin) {
  say('Keeping this in your vault', receiptLine(token), { origin: returnOrigin });

  /* A receipt is the learner's data whoever hands it over, so it is staged
   * whatever origin opened this window. The answer, though, goes to that
   * origin and nowhere else. */
  const result = await vault.stageReceipt(token, { source: 'site' });

  const message = { type: RECEIPT_MESSAGE, status: result.status };
  if (result.receiptId) message.receiptId = result.receiptId;
  if (result.trust) message.trust = result.trust;
  if (result.changes) message.changes = result.changes;
  if (result.reason) message.reason = result.reason;
  if (result.pendingAlignment) message.pendingAlignment = result.pendingAlignment;
  answer(returnOrigin, message);

  if (result.status === 'accepted') {
    const moved = movedWords(result.changes);
    say(
      moved.length > 0 ? 'Kept in your vault' : 'Kept in your vault, nothing moved',
      moved.length > 0
        ? 'The signature checked out and these bands moved.'
        : result.pendingAlignment
          ? `${result.pendingAlignment.join(', ')} ${result.pendingAlignment.length === 1 ? 'is a name' : 'are names'} this vault has not aligned yet, so nothing moved. Say what ${result.pendingAlignment.length === 1 ? 'it means' : 'they mean'} under Alignments.`
          : 'The signature checked out. This one repeats what your vault already knew.',
      { origin: returnOrigin, moved }
    );
  } else if (result.status === 'pending') {
    say('Kept, unverified', 'Nobody your vault knows signed this, so it sits in the ledger and moves nothing.', {
      origin: returnOrigin
    });
  } else {
    const reasons = {
      'bad-signature': 'The signature does not match the receipt.',
      duplicate: 'This receipt is already in your ledger.',
      malformed: 'That is not a readable nema receipt token.'
    };
    say('Not kept', reasons[result.reason] || 'Your vault refused this receipt.', {
      origin: returnOrigin,
      kind: 'bad'
    });
  }
  done();
}

/* ------------------------------------------------------------------ boot -- */

async function boot() {
  document.querySelector('[data-nema-mark]').innerHTML = markSvg('connect');

  const params = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  const returnOrigin = trimOrigin(params.get('return') || '');
  const encoded = params.get('request');
  const token = params.get('receipt');

  if (!encoded && !token) {
    say('Nothing to answer', 'This window is opened by a site that wants to talk to your vault. There is no request in its address.');
    done();
    return;
  }

  if (!isOrigin(returnOrigin)) {
    say('That site could not be identified', 'This window was opened without a valid return origin, so there is nowhere safe to answer.', { kind: 'bad' });
    done();
    return;
  }

  await vault.init();
  vault.setConsentHandler(askForConsent);

  if (encoded) await runAssertion(encoded, returnOrigin);
  else await runReceipt(token, returnOrigin);
}

boot().catch((err) => {
  console.error('[nema] the connect window failed:', err);
  say('Your vault could not answer', 'Something went wrong in this window. Nothing was shared.', { kind: 'bad' });
});
