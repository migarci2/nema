# Philosophy

> The web teaches. Your vault remembers. Your agent connects the two.

nema starts from one observation. The web is full of teaching. Almost none of
it remembers you, and the parts that do remember you keep the memory for
themselves.

## Learning state belongs to the learner

Every course platform builds a model of you. Which lessons you opened, which
questions you answered, which ones you failed twice. That model is the most
valuable thing produced by your study, and it is the one thing you cannot take
with you. Cancel the subscription and it is gone. Open a second site and you
start at zero, watching a video about a topic you already applied at work last
month.

The fix is not a bigger platform. It is moving the state. In nema the learner
holds a vault. The vault is a page on an origin the learner controls, storing
signed evidence and deriving state from it. Sites ask the vault questions. The
vault answers with the smallest true answer, after the learner approves it.
Nothing else leaves.

That is the whole shape of the idea.

> Any website can teach you. Any agent can coach you. Your learning state stays
> local, portable and yours.

## Everyone teaches on the web

The word "provider" makes it sound like there is a class of companies who teach
and a class of people who learn. That is not what the web looks like. Somebody
wrote the answer that unblocked you last Tuesday, and it was a blog post, or a
forum reply, or a page of notes from a course that ran once in 2019. Most of
what any of us knows came from people who were not running an education
business, who taught something because they knew it and wrote it down, and who
will never find out whether it worked.

nema is built for those people first. The protocol is small enough that a
personal site can implement it with one manifest tag and one script tag, no
backend, no account, and no permission from anyone: keep your page, your voice
and your design, and a reader who arrives with a vault leaves with a signed note
of what they actually did. That is what makes the network worth anything. Two
course sites that recognise each other is a demo. A blog, a documentation page,
a workshop handout and a course all issuing evidence a reader can carry is a
web that teaches better than the sum of its pages, because the parts finally
stop forgetting.

## Evidence, not mastery

A number called "mastery: 78%" is a claim with no author. You cannot check it,
you cannot dispute it, and you cannot rebuild it if the vendor changes the
formula.

nema stores evidence instead. An `EvidenceReceipt` says: this provider, at this
time, ran this activity with this grader, and the learner produced this result.
It is signed by the provider that observed it. The vault keeps receipts and
recomputes state from them on every read. Delete the derivation code and you
lose nothing, because the ledger is the truth and the state is a function of it.

This has consequences the demo makes visible. Evidence is weighted by how it
was produced: a deterministic grader counts 1.0, a provider rubric 0.8, an
agent assessment 0.6, a self report 0.3, mere exposure 0.1. Evidence decays,
because a passing answer from a year ago is not a claim about today. And an
assertion the vault signs is not a score. It is a band, `verified`, `uncertain`
or `missing`, bound to one audience and one purpose, valid for thirty minutes.

## The agent is a broker, not an authority

An agent that can write mastery into your record is an agent that can lie about
you, cheaply, at scale. So nema gives it no way to do that.

The vault has no `set_mastery` tool. Providers have no tool that submits an
answer. The only way state moves is a signed receipt from a provider that
graded work the human did, or an explicit `record_agent_assessment` that is
stamped `agent-assessed`, weighted 0.6, and shown in the ledger with its own
badge. The agent reads manifests, explains what a site is asking for, carries
tokens between origins, and works from the vault's `LearningNeed` list. It is
whichever agent the learner already uses, and nothing here depends on which one:
every flow also works with no agent at all, by copying one token. The human
answers every question and approves every disclosure.

This is not a policy written in a prompt. It is the absence of a tool. Prompts
can be argued with. Missing functions cannot.

## Content stays where it is

nema does not want your course catalogue. Providers keep their content, their
pedagogy, their pricing and their brand. What they publish is a
`LearningManifest`: what this unit teaches, what it assumes, what evidence each
activity can produce. The protocol carries the shape of the learning, never the
learning material.

The two example providers in this repository teach cooking, on purpose. Knife
skills, heat control, ratios, emulsions, food safety, service timing. Nothing
in the protocol is specific to a subject, and a demo that taught the reader
about agents would have been read as a description of nema rather than as an
example of it. A pan sauce is a better test anyway: it is a real skill, it has
a right answer you can taste, and nobody confuses it with a protocol.

The payoff shows up the first time two unrelated sites meet. In the demo one
cooking site teaches pan sauces and another runs a service line, they have
never heard of each other, and the second one still skips its own introductory
lessons because the learner's vault says those prerequisites are already held.
No partnership, no shared account, no back channel API. One signed object, one
audience, one learner who said yes.

## What nema refuses to do

- It will not store a global learner id. Each provider sees a different
  `learnerKeyId`, derived from the vault key and that provider's origin.
- It will not send history. An assertion carries the concepts that were asked
  for and nothing else. No dates, no attempt counts, no other subjects.
- It will not let a site pull. Sites can only ask, and only the human can
  answer.
- It will not rank learners, score them or sell the ledger.
- It will not accept unsigned evidence from a provider. An unknown issuer lands
  in the ledger as `pending` and changes no state, so the learner can see the
  attempt. There is exactly one unsigned path, the agent assessment, and it is
  labelled in the ledger and weighted 0.6.

## Why this belongs on the open web

WebMCP puts humans and agents on the same page, literally. A site declares its
capabilities as tools, and the agent in the browser can call them while the
person watches the page change. That is the right substrate for this idea,
because learning needs both parties. The agent is good at reading five
manifests and planning a path. Only the human can actually learn something, and
only the human should decide what a site is allowed to know about them.

So nema is built as pages, not as a service. Five origins, no shared database,
no accounts, no keys to exchange. Every capability is a tool the browser can
see, every disclosure is a modal the human clicks, and every claim is a token
anyone can verify with a public key.
