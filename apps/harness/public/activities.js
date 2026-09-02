/**
 * Saucier School: the activity stage.
 *
 * One renderer per activity type from content.js. Everything here is pure DOM
 * construction plus event wiring: no storage, no grading, no network. The page
 * owns the state and hands this module an attempt plus a set of handlers.
 *
 *   renderStage(activity, attempt, handlers) -> DocumentFragment
 *
 * handlers
 *   submit(submission)   the learner pressed the submit button of this activity
 *   hint()               the learner asked for the next hint
 *   draft(patch)         persist the working draft, no re-render
 *   issueReceipt()       the learner asked the page to issue the receipt
 *   announce(text)       say something in the stage's live region
 *
 * The learner types the answers. There is no code path in this file that can
 * be reached by a tool call.
 */

/* ------------------------------------------------------------- helpers -- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function html(tag, className, markup) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.innerHTML = markup;
  return node;
}

function button(label, className, onClick, attrs = {}) {
  const node = el('button', className, label);
  node.type = 'button';
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.addEventListener('click', onClick);
  return node;
}

function wordsIn(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

const TYPE_LABEL = {
  lesson: 'lesson',
  diagnostic: 'diagnostic',
  'interactive-lab': 'interactive lab',
  'free-recall': 'free recall'
};

/* A line of tasting notes is written the way a kitchen writes it:
 * "19:44 [taste] greasy film across the lip first". Anything that does not
 * match falls back to one plain sentence with no time and no tag. */
const NOTE_LINE = /^(\d{1,2}:\d{2})\s+\[([a-z]+)\]\s+(.*)$/i;

/* Two tags carry a verdict, so they are allowed a colour. The rest are the
 * neutral acts of cooking: look, taste, spoon, pan. */
const NOTE_TONE = { pass: 'good', chef: 'bad' };

/**
 * The tasting notes card. These lines are written text, not a real service,
 * and the judge guide says so; the tone classes only colour the two tags that
 * carry a verdict.
 */
function notesBlock(title, lines) {
  const box = el('figure', 'notes');
  box.append(el('figcaption', 'notes__title', title));
  const list = el('ol', 'notes__list');
  for (const line of lines) {
    const parts = NOTE_LINE.exec(line);
    const row = el('li', 'notes__row');
    if (!parts) {
      row.append(el('span', 'notes__text', line));
      row.style.gridTemplateColumns = 'minmax(0, 1fr)';
      list.append(row);
      continue;
    }
    const [, time, tag, text] = parts;
    const tone = NOTE_TONE[tag.toLowerCase()];
    if (tone) row.classList.add(`notes__row--${tone}`);
    row.append(el('span', 'notes__time', time));
    row.append(el('span', 'notes__tag', tag.toLowerCase()));
    row.append(el('span', 'notes__text', text));
    list.append(row);
  }
  box.append(list);
  return box;
}

/** "fatLeftInPan" reads as "Fat left in pan" on a card a cook can use. */
function humanKey(key) {
  const words = String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The method card the commis worked from, written out the way a kitchen
 * writes one: a row per heading, the steps as a list. The same object a
 * console would have printed as JSON, read as a card instead.
 */
function methodCard(json) {
  const card = el('div', 'method');
  const list = el('dl', 'method__list');
  for (const [key, value] of Object.entries(json)) {
    list.append(el('dt', 'method__key', humanKey(key)));
    if (Array.isArray(value)) {
      const dd = el('dd', 'method__value');
      const steps = el('ul', 'method__steps');
      for (const step of value) steps.append(el('li', null, step));
      dd.append(steps);
      list.append(dd);
    } else if (value && typeof value === 'object') {
      list.append(
        el(
          'dd',
          'method__value',
          Object.entries(value)
            .map(([k, v]) => `${humanKey(k).toLowerCase()}, ${v}`)
            .join('. ')
        )
      );
    } else {
      list.append(el('dd', 'method__value', String(value)));
    }
  }
  card.append(list);
  return card;
}

function head(activity) {
  const wrap = el('div', 'stage__head');
  const title = el('h3', 'stage__title', activity.title);
  title.tabIndex = -1;
  title.setAttribute('data-stage-title', '');
  wrap.append(title);
  wrap.append(
    el(
      'p',
      'stage__meta',
      `${TYPE_LABEL[activity.type] || activity.type}, ${activity.minutes} min. ` +
        `Worth ${activity.evidenceProduced} evidence, graded in our kitchen.`
    )
  );
  return wrap;
}

/** The hints the learner has already opened, plus the button to open one more. */
function hintsBlock(activity, attempt, handlers) {
  const hints = (activity.content && activity.content.hints) || [];
  if (hints.length === 0) return null;

  const used = Math.min(attempt.hintsUsed || 0, hints.length);
  const wrap = el('div', 'stack stack--tight stage__hints');
  wrap.setAttribute('data-hints', '');

  for (let i = 0; i < used; i += 1) {
    const item = el('p', 'stage__hint');
    item.append(el('span', 'stage__hint-index', `Hint ${i + 1}`));
    item.append(el('span', null, hints[i]));
    wrap.append(item);
  }

  if (used < hints.length) {
    wrap.append(
      button(
        used === 0 ? `Show a hint (${hints.length} available)` : `Show hint ${used + 1} of ${hints.length}`,
        'n-btn n-btn--secondary n-btn--sm stage__hint-btn',
        () => handlers.hint()
      )
    );
  } else {
    wrap.append(el('p', 'lab-note', 'Every hint is open. Hints never change the grade, and your vault sees how many you used.'));
  }
  return wrap;
}

/** Result banner plus the grader's sentences. */
function feedbackBlock(attempt) {
  const wrap = el('div', 'stage__feedback');
  wrap.setAttribute('data-feedback', '');
  wrap.setAttribute('role', 'status');
  wrap.setAttribute('aria-live', 'polite');
  wrap.tabIndex = -1;

  if (!attempt || !attempt.result) return wrap;

  const result = attempt.result;
  wrap.dataset.result = result;
  const bandClass =
    result === 'passed' ? 'n-pill--usable' : result === 'partial' ? 'n-pill--uncertain' : 'n-pill--danger';

  const headRow = el('div', 'row row--tight');
  headRow.append(el('span', `n-pill ${bandClass}`, result));
  headRow.append(
    el(
      'span',
      'mono stage__feedback-meta',
      `attempt ${attempt.attempts}, ${attempt.hintsUsed || 0} hint${(attempt.hintsUsed || 0) === 1 ? '' : 's'}, ${attempt.durationSeconds || 0} s`
    )
  );
  wrap.append(headRow);

  const list = el('ul', 'lab-list');
  for (const line of attempt.feedback || []) list.append(el('li', null, line));
  wrap.append(list);
  return wrap;
}

/** The row of actions under an activity: submit, and the receipt affordance. */
function actionsBlock(activity, attempt, handlers, submitLabel, onSubmit) {
  const row = el('div', 'row stage__actions');
  const passed = attempt.status === 'passed';
  const label = passed && activity.type === 'lesson' ? 'Read again' : passed ? 'Try it again' : submitLabel;
  row.append(button(label, `n-btn ${passed ? 'n-btn--secondary' : 'n-btn--primary'}`, onSubmit));

  if (passed && !attempt.receiptToken) {
    /* One request at a time. The page also holds an in-flight promise per
     * activity, so a tool call and this button can never sign two receipts. */
    const issue = button('Issue evidence receipt', 'n-btn n-btn--secondary', () => {
      issue.disabled = true;
      issue.textContent = 'Signing the receipt...';
      Promise.resolve(handlers.issueReceipt()).finally(() => {
        issue.disabled = false;
        issue.textContent = 'Issue evidence receipt';
      });
    });
    row.append(issue);
  }
  if (attempt.receiptToken) {
    const note = el('span', 'stage__receipt-note');
    note.append(el('span', 'n-pill n-pill--durable', 'receipt issued'));
    note.append(
      el(
        'span',
        null,
        passed
          ? 'It is in the receipt panel below.'
          : 'The receipt below still describes the attempt that passed.'
      )
    );
    row.append(note);
  }
  return row;
}

/* -------------------------------------------------------------- lesson -- */

function renderLesson(activity, attempt, handlers) {
  const frag = document.createDocumentFragment();
  const content = activity.content;

  frag.append(head(activity));
  frag.append(el('p', 'stage__intro', content.intro));

  const article = el('article', 'lesson');
  for (const section of content.sections) {
    const block = el('section', 'lesson__section');
    block.append(el('h4', 'lesson__heading', section.heading));
    block.append(html('div', 'prose', section.html));
    article.append(block);
  }
  frag.append(article);

  const key = el('div', 'lesson__key');
  key.append(el('span', 'lab-cap', 'Key points'));
  const list = el('ul', 'lab-list');
  for (const point of content.keyPoints) list.append(el('li', null, point));
  key.append(list);
  frag.append(key);

  frag.append(
    el(
      'p',
      'lab-note',
      'Marking this read records exposure evidence, weight 0.1 in your vault. Reading is not cooking.'
    )
  );

  frag.append(
    actionsBlock(activity, attempt, handlers, 'Mark as read', () => handlers.submit({ completed: true }))
  );
  frag.append(feedbackBlock(attempt));
  return frag;
}

/* ---------------------------------------------------------- diagnostic -- */

function renderDiagnostic(activity, attempt, handlers) {
  const frag = document.createDocumentFragment();
  const content = activity.content;
  const draft = attempt.draft || {};
  const answered = Boolean(attempt.result);
  const passed = attempt.status === 'passed';

  frag.append(head(activity));
  frag.append(el('p', 'stage__intro', content.prompt));
  frag.append(html('div', 'prose', content.context.html));

  const fieldset = el('fieldset', 'opts');
  const legend = el('legend', 'sr-only', content.prompt);
  fieldset.append(legend);

  for (const option of content.options) {
    const card = el('label', 'opt');
    card.setAttribute('data-option', option.id);
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'diagnostic-option';
    input.value = option.id;
    input.className = 'opt__input';
    if (draft.optionId === option.id) input.checked = true;
    input.addEventListener('change', () => {
      handlers.draft({ optionId: option.id });
      card.closest('.opts').querySelectorAll('.opt').forEach((other) => {
        other.classList.toggle('opt--selected', other === card);
      });
    });

    const body = el('div', 'opt__body');
    const letter = option.id.split('-').pop().toUpperCase();
    body.append(el('span', 'opt__id', `Build ${letter}`));
    body.append(html('div', 'prose prose--tight', option.html));

    const isKey = option.id === content.answerKey;
    if (passed) {
      body.append(el('span', `n-pill ${isKey ? 'n-pill--usable' : 'n-pill--danger'}`, isKey ? 'correct' : 'rejected'));
      if (!isKey) body.append(el('p', 'opt__why', option.whyWrong));
    } else if (answered && draft.optionId === option.id && !isKey) {
      body.append(el('span', 'n-pill n-pill--danger', 'not this one'));
      body.append(el('p', 'opt__why', option.whyWrong));
    }

    card.append(input, body);
    if (draft.optionId === option.id) card.classList.add('opt--selected');
    fieldset.append(card);
  }
  frag.append(fieldset);

  const hints = hintsBlock(activity, attempt, handlers);
  if (hints) frag.append(hints);

  frag.append(
    actionsBlock(activity, attempt, handlers, 'Submit answer', () => {
      const checked = document.querySelector('input[name="diagnostic-option"]:checked');
      handlers.submit({ optionId: checked ? checked.value : '' });
    })
  );

  /* The explanation is already the grader's feedback on a pass, so it is not
   * repeated here: gradeDiagnostic returns content.explanation verbatim. */
  frag.append(feedbackBlock(attempt));
  return frag;
}

/* ------------------------------------------------------ interactive lab -- */

function renderLab(activity, attempt, handlers) {
  const frag = document.createDocumentFragment();
  const content = activity.content;
  const passed = attempt.status === 'passed';
  const draft = attempt.draft || {};
  const selected = new Set(Array.isArray(draft.checks) ? draft.checks : []);
  const order = Array.isArray(draft.stageOrder) && draft.stageOrder.length === content.stages.length
    ? draft.stageOrder.slice()
    : content.stages.map((s) => s.id).slice(-1).concat(content.stages.map((s) => s.id).slice(0, -1));

  frag.append(head(activity));
  frag.append(html('div', 'prose', content.scenario.html));

  frag.append(notesBlock('Tasting notes, as it came to the pass', content.beforeRun));

  const harness = el('div', 'stack stack--tight');
  harness.append(el('span', 'lab-cap', 'The method card, as the commis cooked it'));
  harness.append(methodCard(content.brokenHarness.json));
  frag.append(harness);

  /* Checks -------------------------------------------------------------- */
  const checksField = el('fieldset', 'checks');
  checksField.append(el('legend', 'lab-cap', 'Steps for the remake'));
  checksField.append(
    el('p', 'lab-note', 'Three of these make the sauce. Two would break it again. The rest are free either way.')
  );

  for (const check of content.checks) {
    const card = el('label', 'check');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = check.id;
    input.className = 'check__input';
    input.checked = selected.has(check.id);
    input.addEventListener('change', () => {
      if (input.checked) selected.add(check.id);
      else selected.delete(check.id);
      card.classList.toggle('check--selected', input.checked);
      handlers.draft({ checks: Array.from(selected) });
    });

    const body = el('div', 'check__body');
    const titleRow = el('div', 'row row--tight');
    titleRow.append(el('span', 'check__label', check.label));
    if (passed) {
      const kindPill =
        check.kind === 'required'
          ? 'n-pill--usable'
          : check.kind === 'harmful'
            ? 'n-pill--danger'
            : 'n-pill--unknown';
      const kindText = check.kind === 'required' ? 'necessary' : check.kind === 'harmful' ? 'harmful' : 'optional';
      titleRow.append(el('span', `n-pill ${kindPill}`, kindText));
    }
    body.append(titleRow);
    body.append(el('p', 'check__detail', check.detail));

    card.append(input, body);
    if (input.checked) card.classList.add('check--selected');
    checksField.append(card);
  }
  frag.append(checksField);

  /* Stage order --------------------------------------------------------- */
  const orderWrap = el('div', 'stack stack--tight');
  orderWrap.append(el('span', 'lab-cap', 'The three stages, in order'));
  orderWrap.append(
    el('p', 'lab-note', 'Put the three stages in the order they happen in the pan.')
  );

  const list = el('ol', 'order');
  const labelOf = (id) => (content.stages.find((s) => s.id === id) || { label: id }).label;

  function paint() {
    list.textContent = '';
    order.forEach((id, index) => {
      const row = el('li', 'order__row');
      row.append(el('span', 'order__index mono', String(index + 1)));
      const main = el('div', 'order__main');
      main.append(el('span', 'order__label', labelOf(id)));
      row.append(main);

      const controls = el('div', 'row row--tight order__controls');
      const up = button('Up', 'n-btn n-btn--secondary n-btn--sm', () => move(index, -1), {
        'aria-label': `Move ${labelOf(id)} up`
      });
      const down = button('Down', 'n-btn n-btn--secondary n-btn--sm', () => move(index, 1), {
        'aria-label': `Move ${labelOf(id)} down`
      });
      up.disabled = index === 0;
      down.disabled = index === order.length - 1;
      up.dataset.orderBtn = `${id}:up`;
      down.dataset.orderBtn = `${id}:down`;
      controls.append(up, down);
      row.append(controls);
      list.append(row);
    });
  }

  function move(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const moved = order[index];
    order.splice(index, 1);
    order.splice(target, 0, moved);
    handlers.draft({ stageOrder: order.slice() });
    paint();
    const wanted = list.querySelector(`[data-order-btn="${moved}:${delta < 0 ? 'up' : 'down'}"]`);
    const fallback = list.querySelector(`[data-order-btn="${moved}:${delta < 0 ? 'down' : 'up'}"]`);
    const next = wanted && !wanted.disabled ? wanted : fallback;
    if (next) next.focus();
    handlers.announce(`${labelOf(moved)} moved to position ${target + 1} of ${order.length}.`);
  }

  paint();
  orderWrap.append(list);
  frag.append(orderWrap);

  const hints = hintsBlock(activity, attempt, handlers);
  if (hints) frag.append(hints);

  frag.append(
    actionsBlock(activity, attempt, handlers, 'Run the remake', () => {
      handlers.submit({ checks: Array.from(selected), stageOrder: order.slice() });
    })
  );

  frag.append(feedbackBlock(attempt));

  /* The console has to agree with the grade. Only a full pass earns the run
   * where the agent repairs its own work; a partial gets the run it actually
   * described, which decides before the feedback reaches the agent. */
  if (attempt.result === 'passed') {
    frag.append(notesBlock('Tasting notes, after your remake', content.afterRun));
  } else if (attempt.result === 'partial') {
    frag.append(
      notesBlock('Tasting notes, in the order you sent it', partialRunLines(content, attempt))
    );
  } else {
    frag.append(
      el('p', 'lab-note', 'The second tasting appears here once the remake works.')
    );
  }
  return frag;
}

/**
 * A partial grade on the lab means one thing only: the three steps are right
 * and the stages are not in a workable order. The notes below are composed
 * from the order the learner sent, so the second tasting says what the grader
 * says instead of describing a sauce that came together.
 */
function partialRunLines(content, attempt) {
  const stages = content.stages;
  const labelOf = (id) => (stages.find((stage) => stage.id === id) || { label: id }).label;
  const submitted =
    attempt.submission && Array.isArray(attempt.submission.stageOrder)
      ? attempt.submission.stageOrder
      : stages.map((stage) => stage.id);
  const at = (id) => submitted.indexOf(id);

  let verdict;
  if (at('mount') < at('reduce')) {
    verdict =
      `19:56 [taste] the butter went in at step ${at('mount') + 1}, into a sauce that was ` +
      'still thin. To thicken it you boil it, and the boil splits it again';
  } else if (at('reduce') < at('deglaze')) {
    verdict =
      `19:56 [taste] the reduction ran at step ${at('reduce') + 1}, before the fond was ` +
      'lifted. It tastes of raw wine and there is no body behind it';
  } else {
    verdict =
      `19:56 [taste] deglazing at step ${at('deglaze') + 1} washes the pan after the work ` +
      'is done. The brown welded to the base never reaches the sauce';
  }

  return [
    '19:52 [pan] the three steps are right: fat poured off, cold butter waiting',
    `19:53 [pan] stages run in the order you sent, ${submitted.map(labelOf).join(', then ')}`,
    verdict,
    '19:57 [chef] the remake ends where the first one ended, two layers in the pan'
  ];
}

/* --------------------------------------------------------- free recall -- */

function renderFreeRecall(activity, attempt, handlers) {
  const frag = document.createDocumentFragment();
  const content = activity.content;
  const draft = attempt.draft || {};
  const graded = Boolean(attempt.result);

  frag.append(head(activity));
  frag.append(el('p', 'stage__intro', content.prompt));

  const field = el('div', 'n-field');
  const label = el('label', 'n-label', 'Your explanation');
  label.setAttribute('for', 'recall-text');
  const textarea = el('textarea', 'n-textarea recall__text');
  textarea.id = 'recall-text';
  textarea.rows = 8;
  textarea.value = draft.text || '';
  textarea.placeholder = 'Write it the way you would explain it to a commis at the pass.';
  const count = el('p', 'n-help recall__count');
  count.setAttribute('role', 'status');
  count.setAttribute('aria-live', 'polite');

  function paintCount() {
    const words = wordsIn(textarea.value);
    count.textContent = `${words} word${words === 1 ? '' : 's'}, ${content.minWords} minimum`;
    count.dataset.short = words < content.minWords ? 'true' : 'false';
  }
  paintCount();
  textarea.addEventListener('input', () => {
    paintCount();
    handlers.draft({ text: textarea.value });
  });

  field.append(label, textarea, count);
  frag.append(field);

  /* Rubric checklist: criteria are revealed with the grade, never before. */
  const rubric = el('div', 'stack stack--tight rubric');
  rubric.append(el('span', 'lab-cap', `Rubric, ${content.rubric.length} criteria`));
  if (!graded) {
    rubric.append(
      el('p', 'lab-note', 'The criteria are revealed with your grade. Writing to a checklist is not recall.')
    );
    for (let i = 0; i < content.rubric.length; i += 1) {
      const row = el('div', 'rubric__row rubric__row--blank');
      row.append(el('span', 'n-pill n-pill--unknown', 'ungraded'));
      row.append(el('span', 'rubric__text', `Criterion ${i + 1}`));
      rubric.append(row);
    }
  } else {
    /* Which criteria were met is read back from the grader's own sentences, so
     * the checklist can never disagree with the grade. gradeFreeRecall emits
     * one "Still missing: <criterion>" line per unmet criterion, and a single
     * "Too short to grade" line when the answer is under minWords. */
    const lines = attempt.feedback || [];
    const tooShort = lines.some((line) => line.startsWith('Too short to grade'));
    const missing = new Set(
      lines.filter((line) => line.startsWith('Still missing: ')).map((line) => line.slice(15))
    );
    for (const criterion of content.rubric) {
      const met = !tooShort && !missing.has(criterion.criterion);
      const row = el('div', 'rubric__row');
      row.append(el('span', `n-pill ${met ? 'n-pill--usable' : 'n-pill--unknown'}`, met ? 'met' : 'not met'));
      row.append(el('span', 'rubric__text', criterion.criterion));
      rubric.append(row);
    }
    rubric.append(
      el('p', 'lab-note', 'Graded by a keyword rubric in our kitchen, and worth 0.8 of a full assessment in your vault.')
    );
  }
  frag.append(rubric);

  frag.append(
    actionsBlock(activity, attempt, handlers, 'Submit for grading', () => {
      handlers.submit({ text: textarea.value });
    })
  );
  frag.append(feedbackBlock(attempt));
  return frag;
}

/* ------------------------------------------------------------- exports -- */

const RENDERERS = {
  lesson: renderLesson,
  diagnostic: renderDiagnostic,
  'interactive-lab': renderLab,
  'free-recall': renderFreeRecall
};

/**
 * Render one activity into a fragment ready to be dropped into the stage.
 *
 * @param {object} activity an entry of ACTIVITIES
 * @param {object} attempt the stored attempt for it
 * @param {object} handlers submit, hint, draft, issueReceipt, announce
 * @returns {DocumentFragment}
 */
export function renderStage(activity, attempt, handlers) {
  const render = RENDERERS[activity.type];
  if (!render) {
    const frag = document.createDocumentFragment();
    frag.append(el('p', 'lab-line', `No renderer for activity type ${activity.type}.`));
    return frag;
  }
  return render(activity, attempt, handlers);
}

export { TYPE_LABEL, wordsIn };
