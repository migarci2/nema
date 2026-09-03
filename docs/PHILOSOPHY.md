# Philosophy

> **Learn it once. It counts everywhere.**
>
> Learn something on one site, and the next one already knows. You decide what
> gets shared, every time. The picture is on
> [the hub](https://nema.migarci2.dev/).

> The web teaches. Your vault remembers. Your agent connects the two.

Most of what I know came from pages that will never know me again. A blog post
about browning meat. A chapter on syscalls. A forum reply from 2014 by somebody
who has since deleted the account. None of them knew what I understood when I
arrived, and none found out whether it worked.

## Learning state belongs to the learner

Every course platform builds a model of you. Which lessons you opened, which
question you failed twice. That model is the most valuable thing your studying
produced and the one thing you cannot take with you. Cancel the subscription and
it is gone. Open a second site and you start at zero, watching a video about
something you used at work last week.

The fix is not a bigger platform. It is moving the state. The learner holds a
vault: a page on an origin they control, storing signed evidence and deriving
state from it. Sites ask it a question, and it answers with the smallest true
answer, after the learner approves. Nothing else leaves.

## Learning fast is not reading fast

The learner model is not ours. Kris Abdelmessih's essay
[The Principles of Learning Fast](https://moontowermeta.com/the-principles-of-learning-fast/)
collects the argument, and most of it comes from Justin Skycak, who
[writes it out at length](https://www.justinmath.com/the-pedagogically-optimal-way-to-learn-math/)
and built it into Math Academy.

Their definition is narrow and useful. Learning fast means knowledge acquired,
retained and usable per unit of effort, which has nothing to do with how quickly
you get through the material. What an exceptional tutor removes, Skycak argues,
is the years spent practising the wrong thing, building on weak prerequisites,
and forgetting.

Working memory is the bottleneck underneath. A basketball player still thinking
about the dribble has nothing left for the play. Automaticity in the lower
skills frees the capacity to hold a harder problem.

## Reading it again is not remembering it

Skycak separates two things that feel alike. Re-exposure is opening the page
again, and it produces familiarity. Retrieval is producing the answer with the
material closed, and it produces memory. Rereading measures recognition, which
is why it feels good and predicts little.

nema is built around that split. Marking an article read counts 0.1 against 1.0
for a graded answer, and exposure alone never carries a concept past
`uncertain`. When a concept has nothing else behind it the vault says so
plainly: you have read about this, you have not retrieved it yet.

Memory decays, so the vault schedules a return. Following
[the spacing work Skycak summarises](https://www.justinmath.com/cognitive-science-of-learning-spaced-repetition/),
the moment to retrieve something is when it has gone effortful but is still
recoverable, and each success buys a longer interval.

## Practising something hard repeats everything under it

This is the part that changed the design most, and it is Skycak's:
[knowledge is hierarchical](https://www.justinmath.com/individualized-spaced-repetition-in-hierarchical-knowledge-structures/).
Flashcards treat facts as independent units. Mathematics and programming are not
like that. Practising D also practises C, B and A, so the prerequisite graph has
a mirror image: an encompassing graph of what you rehearse while doing something
advanced. Math Academy credits those partial repetitions and calls it Fractional
Implicit Repetition.

The vault does the same. A passed claim credits each prerequisite at a fraction
and extends its stability as half a pass, so new learning is the spaced
repetition of everything below it. Review in nema costs less than people fear,
and costs less the harder you work.

## The edge, not the middle

Mastery learning says do not teach something until its prerequisites are held.
There is no class level, only a distribution of knowledge profiles, and the
useful next task sits just outside what you can already do.

That is why a site asks your vault before it plans. When a concept's
prerequisites are weak, the vault proposes the weakest one instead, and names
the goal it is blocking.

## Short cycles beat hard problems

Deliberate practice is many cycles of attempt, feedback and adjustment. Thirty
calibrated problems teach more than one olympiad problem, and an hour stuck on
one question teaches close to nothing.

We mirrored two articles by other people, one on AES-GCM and one chapter of
cpu.land. Neither ends with an exam and we did not add one. nema adds
a retrieval question after each section, graded in the page. The session planner
does the rest: it never puts two needs on one concept next to each other, and it
keeps confusable concepts apart unless telling them apart is the point.

## Evidence, not mastery

A number called "mastery: 78%" is a claim with no author. You cannot check it,
dispute it, or rebuild it when the vendor changes the formula.

nema stores evidence instead. A receipt says that this site ran this activity
with this grader and the learner produced this result, signed by the site that
watched it happen. The vault recomputes state from the receipts on every read.
Evidence decays, because a passing answer from a year ago is not a claim about
today.

## The agent manages, it does not explain

Skycak's point about AI tutoring is that the hard part is learning management
rather than text generation: what to study now, what you are not ready for, and
what you have forgotten. Models are good at explaining. Explaining was never the
scarce thing.

So the model lives in the vault. The agent reads manifests, carries signed
tokens between origins, and works from the vault's `LearningNeed` list, which
arrives with the rubric attached so it does not invent the standard.

It cannot write your record. There is no `set_mastery` tool and no provider tool
that submits an answer for you. The one write an agent can originate is stamped
`agent-assessed`, weighted 0.6, and badged in the ledger. That rule is enforced
by a missing function rather than by a written policy, and a policy can be
argued with in a way a missing function cannot.

## Effort is not learning, but it is not the enemy

Technology should remove wasted effort and leave productive effort alone.
Skipping three lessons your vault already vouches for is waste removed. Skipping
the retrieval question because it is uncomfortable is not, and nema will not do
it. Good practice feels worse than rereading and works better, which is most of
why these ideas are old and still rare.

One limit, plainly. nema manages learning. It does not replace a teacher, a
mentor, or the work. Competence is what drives motivation, and nothing here
produces it for you.

## What nema refuses to do

- No global learner id. Each provider sees a different `learnerKeyId`, derived
  from the vault key and that provider's origin.
- No history. An assertion carries the concepts asked for: no dates, no attempt
  counts, no other subjects.
- No pulling. Sites ask, and only the human answers.
- No ranking, no scoring, no selling the ledger.
- No unsigned provider evidence. An unknown issuer lands in the ledger as
  `pending` and changes nothing, in plain sight.

## Why this belongs on the open web

Somebody wrote the answer that unblocked you last Tuesday, and it was a blog
post or notes from a course that ran once in 2019. A protocol only platforms can
implement is another platform, so the install had to be small enough for those
people: one manifest tag, one script tag, no backend, no permission from anyone.

WebMCP is what makes that possible. A site declares what it can do as tools on
the page it already serves, and an agent calls them while the person watches.
The agent can plan a path across five manifests. Only the human can learn the
thing, and only the human should decide what a site may know.
